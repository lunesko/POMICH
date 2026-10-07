from bot.services import lifecycle as lifecycle_service
from bot.services import matching as matching_service
from bot.services import customer_profiles as customer_profiles_service
from bot.services import provider_profiles as provider_profiles_service
from bot.services import order_queries as order_queries_service
from bot.services import reviews as reviews_service
from bot.domain.order_rules import ACTIVE_ORDER_STATUSES, MAP_REQUEST_PIN_STATUSES, ORDER_STATUSES, ORDER_STATUS_ALIASES, ORDER_TRANSITIONS, TERMINAL_ORDER_STATUSES, _normalize_proposed_price, _valid_point, haversine_distance_km, is_map_request_order, normalize_order_status, normalize_service, peek_order_status
import json
import math
import os
import threading
import uuid
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from bot.field_encryption import decrypt_customer_profile, decrypt_field, encrypt_customer_profile, is_encrypted_value
from bot.runtime_store import (
    SqlDispatchConflict,
    load_collection,
    save_collection,
    sql_accept_offer,
    sql_candidate_providers_for_order,
    sql_customers_by_phone_lookup,
    sql_decline_offer,
    sql_expire_pending_offers,
    sql_get_customer,
    sql_upsert_customer,
    sql_get_order,
    sql_upsert_order,
    sql_get_provider,
    sql_commit_dispatch_wave,
    sql_commit_order_snapshot,
    sql_invalidate_order_offers,
    sql_map_providers,
    sql_offers_for_order,
    sql_offers_for_orders,
    sql_orders_by_status,
    sql_searching_orders_near_provider,
    sql_orders_for_provider,
    sql_pending_offers_for_provider,
    sql_providers_by_phone_lookup,
    sql_storage_enabled,
    sql_upsert_offer,
    sql_upsert_provider,
)
from bot.ukraine_plate import is_valid_ukraine_plate, normalize_ukraine_plate
from bot.dispatch_config import (
    DISPATCH_MAX_CONCURRENT_OFFERS,
    DISPATCH_WAVE_WAIT_SECONDS,
    DISPATCH_WAVE1_SIZE,
    DISPATCH_WAVE2_SIZE,
    initial_radius_km_for_service,
    search_radius_steps_for_service,
    wave_batch_size,
)

PROVIDER_PRESENCE_TTL_SECONDS = 60
PROVIDER_ACTIVE_STATUSES = {"online", "busy"}
PROVIDER_STATUSES = {"online", "busy", "offline"}
PROVIDER_SPECIALTIES = {"tow", "battery", "wheel", "fuel", "lockout", "mechanic"}
VERIFICATION_STATUSES = {"unverified", "pending", "verified", "rejected"}
# Legacy alias — prefer search_radius_steps_for_service(service) for new dispatch.
DISPATCH_SEARCH_RADIUS_STEPS_KM = [
    int(value) for value in os.getenv("SEARCH_RADIUS_STEPS_KM", "5,10,20,40").split(",") if value.strip().isdigit()
] or [5, 10, 20, 40]
MAX_PROVIDER_OFFERS = int(os.getenv("MAX_PROVIDER_OFFERS", str(DISPATCH_MAX_CONCURRENT_OFFERS)) or str(DISPATCH_MAX_CONCURRENT_OFFERS))
# Partners need time to read details, enter a price, and accept. 20s was too short in production.
OFFER_TIMEOUT_SECONDS = int(os.getenv("OFFER_TIMEOUT_SECONDS", "90"))
# After a partner accepts, customer must confirm price (and processing must continue).
# Idle accepted orders are cancelled (not hard-deleted) after this timeout.
ACCEPTED_IDLE_TIMEOUT_SECONDS = int(os.getenv("ACCEPTED_IDLE_TIMEOUT_SECONDS", "900"))
OFFER_STATUSES = {"pending", "accepted", "declined", "expired", "lost", "cancelled"}
STORE_LOCK = threading.RLock()
_EXPIRE_STALE_LOCK = threading.Lock()
_LAST_EXPIRE_STALE_MONOTONIC = 0.0
_EXPIRE_STALE_MIN_INTERVAL_SECONDS = float(os.getenv("POMICH_EXPIRE_MIN_INTERVAL_SECONDS", "15") or "15")



class InvalidStatusTransition(ValueError):
    def __init__(self, current_status: str, next_status: str) -> None:
        self.current_status = current_status
        self.next_status = next_status
        super().__init__(f"invalid order status transition: {current_status} -> {next_status}")


class DispatchConflict(ValueError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


def _default_store_path() -> Path:
    return Path(os.getenv("POMICH_ORDER_STORE_PATH") or Path(__file__).resolve().parent.parent / "data" / "orders.json")


def _default_session_store_path() -> Path:
    return Path(os.getenv("POMICH_SESSION_STORE_PATH") or Path(__file__).resolve().parent.parent / "data" / "telegram_sessions.json")


def _default_provider_store_path() -> Path:
    return Path(os.getenv("POMICH_PROVIDER_STORE_PATH") or Path(__file__).resolve().parent.parent / "data" / "providers.json")


def _default_customer_store_path() -> Path:
    return Path(os.getenv("POMICH_CUSTOMER_STORE_PATH") or Path(__file__).resolve().parent.parent / "data" / "customers.json")


def _default_offer_store_path() -> Path:
    return Path(os.getenv("POMICH_OFFER_STORE_PATH") or Path(__file__).resolve().parent.parent / "data" / "offers.json")


def _now_iso() -> str:
    return f"{datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec='seconds')}Z"


def _write_json_atomic(path: Path, data: Any) -> None:
    collection_name = _collection_name_for_default_path(path)
    if collection_name is not None:
        save_collection(collection_name, data)
        return

    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
    with temp_path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
    temp_path.replace(path)


def _should_use_sql_store(path: Optional[Path], default_path_factory) -> bool:
    """Prefer SQL/PostGIS when DATABASE_URL is set (production path).

    JSON file paths are the local/dev and pytest fallback: they are used when
    DATABASE_URL is unset, POMICH_STORAGE_BACKEND=json, or an explicit non-default
    store path is passed (tests). Production rejects JSON backend unless
    POMICH_ALLOW_JSON_STORE_IN_PRODUCTION=true.
    """
    if not sql_storage_enabled():
        return False
    if path is None:
        return True
    return Path(path) == default_path_factory()


def _should_use_sql_runtime(
    order_store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
    offer_store_path: Optional[Path] = None,
) -> bool:
    return (
        _should_use_sql_store(order_store_path, _default_store_path)
        and _should_use_sql_store(provider_store_path, _default_provider_store_path)
        and _should_use_sql_store(offer_store_path, _default_offer_store_path)
    )


def _collection_name_for_default_path(path: Path) -> Optional[str]:
    if not sql_storage_enabled():
        return None

    path = Path(path)
    path_map = {
        "orders": _default_store_path(),
        "telegram_sessions": _default_session_store_path(),
        "providers": _default_provider_store_path(),
        "customers": _default_customer_store_path(),
        "offers": _default_offer_store_path(),
    }
    for collection_name, default_path in path_map.items():
        if path == default_path:
            return collection_name
    return None


def _parse_iso(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.replace(tzinfo=None)
    except ValueError:
        return None




def _order_accepted_at(order: Dict[str, Any]) -> Optional[datetime]:
    return lifecycle_service._order_accepted_at(_lifecycle_dependencies(), order)








def confirm_order_price(
    order_id: str,
    order_store_path: Optional[Path] = None,
    offer_store_path: Optional[Path] = None,
) -> Dict[str, Any]:
    return lifecycle_service.confirm_order_price(_lifecycle_dependencies(), order_id, order_store_path, offer_store_path)


def apply_provider_presence_ttl(providers: List[Dict[str, Any]], now: Optional[datetime] = None) -> List[Dict[str, Any]]:
    return provider_profiles_service.apply_provider_presence_ttl(_provider_profiles_dependencies(), providers, now)


def _clean_provider_specialties(value: Any) -> List[str]:
    return provider_profiles_service._clean_provider_specialties(_provider_profiles_dependencies(), value)


def normalize_verification_status(status: Any, default: str = "unverified") -> str:
    return provider_profiles_service.normalize_verification_status(_provider_profiles_dependencies(), status, default)


def _truthy_flag(value: Any) -> bool:
    return provider_profiles_service._truthy_flag(_provider_profiles_dependencies(), value)


def _verification_badges(status: str, role: str) -> List[str]:
    return provider_profiles_service._verification_badges(_provider_profiles_dependencies(), status, role)


def _default_provider_verification(status: str, timestamp: str | None = None) -> Dict[str, Any]:
    return provider_profiles_service._default_provider_verification(_provider_profiles_dependencies(), status, timestamp)


def _normalize_provider_trust(provider: Dict[str, Any], default_status: str = "unverified") -> Dict[str, Any]:
    return provider_profiles_service._normalize_provider_trust(_provider_profiles_dependencies(), provider, default_status)


def is_provider_verified(provider: Dict[str, Any]) -> bool:
    return provider_profiles_service.is_provider_verified(_provider_profiles_dependencies(), provider)


def verify_provider_phone_otp(provider_id: str, store_path: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    return provider_profiles_service.verify_provider_phone_otp(_provider_profiles_dependencies(), provider_id, store_path)



def _default_customer_profile(customer_id: str, timestamp: str | None = None) -> Dict[str, Any]:
    return customer_profiles_service._default_customer_profile(_customer_profiles_dependencies(), customer_id, timestamp)


def _customer_profile_completeness(profile: Dict[str, Any]) -> int:
    return customer_profiles_service._customer_profile_completeness(_customer_profiles_dependencies(), profile)


def _normalize_customer_profile(profile: Dict[str, Any]) -> Dict[str, Any]:
    return customer_profiles_service._normalize_customer_profile(_customer_profiles_dependencies(), profile)








def _append_order_event(order: Dict[str, Any], event_type: str, at: Optional[str] = None, extra: Optional[Dict[str, Any]] = None) -> None:
    events = order.get("dispatchEvents")
    if not isinstance(events, list):
        events = []
    payload = {"type": event_type, "at": at or _now_iso()}
    if extra:
        payload.update(extra)
    events.append(payload)
    order["dispatchEvents"] = events


def load_offers(store_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    if _should_use_sql_store(store_path, _default_offer_store_path):
        found, data = load_collection("offers")
        return data if found and isinstance(data, list) else []

    path = store_path or _default_offer_store_path()
    if not path.exists():
        return []
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
            return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []


def save_offers(offers: List[Dict[str, Any]], store_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    with STORE_LOCK:
        path = store_path or _default_offer_store_path()
        _write_json_atomic(path, offers)
        return offers


def _default_providers() -> List[Dict[str, Any]]:
    return provider_profiles_service._default_providers(_provider_profiles_dependencies())


def load_orders(store_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    if _should_use_sql_store(store_path, _default_store_path):
        found, data = load_collection("orders")
        return data if found and isinstance(data, list) else []

    path = store_path or _default_store_path()
    if not path.exists():
        return []
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
            return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []


def _normalize_customer_comment(order: Dict[str, Any]) -> Optional[str]:
    raw = order.get("customerComment")
    if raw is None:
        raw = order.get("comment")
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    return text[:500]


def save_order(order: Dict[str, Any], store_path: Optional[Path] = None) -> Dict[str, Any]:
    with STORE_LOCK:
        path = store_path or _default_store_path()
        payload = dict(order)
        comment = _normalize_customer_comment(payload)
        if comment:
            payload["customerComment"] = comment
        else:
            payload.pop("customerComment", None)
        payload.pop("comment", None)
        payload["id"] = payload.get("id") or f"PM-{datetime.now(timezone.utc).replace(tzinfo=None).strftime('%Y%m%d%H%M%S%f')}"
        payload["createdAt"] = payload.get("createdAt") or _now_iso()
        payload["updatedAt"] = payload.get("updatedAt") or payload["createdAt"]
        payload["status"] = normalize_order_status(payload.get("status") or "searching")
        payload["statusHistory"] = payload.get("statusHistory") or [
            {"status": payload["status"], "at": payload["createdAt"]}
        ]
        payload["dispatchEvents"] = payload.get("dispatchEvents") or [
            {"type": "ORDER_CREATED", "at": payload["createdAt"]}
        ]
        if _should_use_sql_store(path, _default_store_path):
            return sql_upsert_order(payload)
        orders = load_orders(path)
        orders.append(payload)
        _write_json_atomic(path, orders)
        return payload


def resolve_provider_telegram_user_id(provider_id: str, provider_store_path: Optional[Path] = None, customer_store_path: Optional[Path] = None) -> Optional[str]:
    return order_queries_service.resolve_provider_telegram_user_id(_order_queries_dependencies(), provider_id, provider_store_path, customer_store_path)


def partner_provider_ids_for_order(
    order_id: str,
    order: Optional[Dict[str, Any]] = None,
    offer_store_path: Optional[Path] = None,
) -> List[str]:
    return order_queries_service.partner_provider_ids_for_order(_order_queries_dependencies(), order_id, order, offer_store_path)


def partner_telegram_user_ids_for_order(
    order_id: str,
    order: Optional[Dict[str, Any]] = None,
    provider_store_path: Optional[Path] = None,
    customer_store_path: Optional[Path] = None,
    offer_store_path: Optional[Path] = None,
) -> List[str]:
    return order_queries_service.partner_telegram_user_ids_for_order(_order_queries_dependencies(), order_id, order, provider_store_path, customer_store_path, offer_store_path)


def enrich_order_for_client(
    order: Dict[str, Any],
    provider_store_path: Optional[Path] = None,
    customer_store_path: Optional[Path] = None,
) -> Dict[str, Any]:
    return order_queries_service.enrich_order_for_client(_order_queries_dependencies(), order, provider_store_path, customer_store_path)


def get_order(order_id: str, store_path: Optional[Path] = None, provider_store_path: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    return order_queries_service.get_order(_order_queries_dependencies(), order_id, store_path, provider_store_path)


def update_order_status(
    order_id: str,
    status: str,
    store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
    offer_store_path: Optional[Path] = None,
) -> Optional[Dict[str, Any]]:
    return lifecycle_service.update_order_status(_lifecycle_dependencies(), order_id, status, store_path, provider_store_path, offer_store_path)


def load_telegram_sessions(store_path: Optional[Path] = None) -> Dict[str, Dict[str, Any]]:
    if _should_use_sql_store(store_path, _default_session_store_path):
        found, data = load_collection("telegram_sessions")
        return data if found and isinstance(data, dict) else {}

    path = store_path or _default_session_store_path()
    if not path.exists():
        return {}
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
            return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def save_telegram_session(chat_id: str, data: Dict[str, Any], store_path: Optional[Path] = None) -> Dict[str, Any]:
    with STORE_LOCK:
        path = store_path or _default_session_store_path()
        sessions = load_telegram_sessions(path)
        existing = sessions.get(str(chat_id), {})
        payload = {**existing, **data, "chatId": str(chat_id), "updatedAt": _now_iso()}
        sessions[str(chat_id)] = payload
        _write_json_atomic(path, sessions)
        return payload


def get_telegram_session(chat_id: str, store_path: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    sessions = load_telegram_sessions(store_path)
    session = sessions.get(str(chat_id))
    return session if isinstance(session, dict) else None


def merge_directory_providers(
    incoming: List[Dict[str, Any]],
    store_path: Optional[Path] = None,
) -> Dict[str, Any]:
    'Merge directory providers by id; keep dispatch partners unchanged.'
    return provider_profiles_service.merge_directory_providers(_provider_profiles_dependencies(), incoming, store_path)


def nearby_searching_orders(
    lat: float,
    lng: float,
    *,
    radius_km: float = 20.0,
    service: Optional[str] = None,
    order_store_path: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    return order_queries_service.nearby_searching_orders(_order_queries_dependencies(), lat, lng, radius_km=radius_km, service=service, order_store_path=order_store_path)


def load_providers(store_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    return provider_profiles_service.load_providers(_provider_profiles_dependencies(), store_path)


def save_providers(providers: List[Dict[str, Any]], store_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    return provider_profiles_service.save_providers(_provider_profiles_dependencies(), providers, store_path)


def get_provider_profile(provider_id: str, store_path: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    return provider_profiles_service.get_provider_profile(_provider_profiles_dependencies(), provider_id, store_path)


def build_empty_provider_profile_shell(provider_id: str, store_path: Optional[Path] = None) -> Dict[str, Any]:
    'Minimal provider row for linked partners who have not saved a profile yet.'
    return provider_profiles_service.build_empty_provider_profile_shell(_provider_profiles_dependencies(), provider_id, store_path)


def ensure_linked_provider_profile(
    customer_id: str,
    store_path: Optional[Path] = None,
    customer_store_path: Optional[Path] = None,
) -> Optional[Dict[str, Any]]:
    'Persist a linked partner row from the customer account so Mini App duty/go-online works.\n\nReturning verified customers often have linkedProviderId but a missing SQL provider row.\nWithout a persisted profile, the UI falls into empty registration or a blank map.'
    return provider_profiles_service.ensure_linked_provider_profile(_provider_profiles_dependencies(), customer_id, store_path, customer_store_path)


def submit_provider_verification(provider_id: str, data: Dict[str, Any], store_path: Optional[Path] = None) -> Dict[str, Any]:
    return provider_profiles_service.submit_provider_verification(_provider_profiles_dependencies(), provider_id, data, store_path)


def review_provider_verification(provider_id: str, data: Dict[str, Any], store_path: Optional[Path] = None) -> Dict[str, Any]:
    return provider_profiles_service.review_provider_verification(_provider_profiles_dependencies(), provider_id, data, store_path)


def _decrypt_customer_record(profile: Dict[str, Any]) -> Dict[str, Any]:
    return customer_profiles_service._decrypt_customer_record(_customer_profiles_dependencies(), profile)


def _encrypt_customer_record(profile: Dict[str, Any]) -> Dict[str, Any]:
    return customer_profiles_service._encrypt_customer_record(_customer_profiles_dependencies(), profile)


def load_customer_profiles(store_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    return customer_profiles_service.load_customer_profiles(_customer_profiles_dependencies(), store_path)


def save_customer_profiles(profiles: List[Dict[str, Any]], store_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    return customer_profiles_service.save_customer_profiles(_customer_profiles_dependencies(), profiles, store_path)


def get_customer_profile(customer_id: str, store_path: Optional[Path] = None) -> Dict[str, Any]:
    return customer_profiles_service.get_customer_profile(_customer_profiles_dependencies(), customer_id, store_path)


def customer_profile_exists(customer_id: str, store_path: Optional[Path] = None) -> bool:
    'True only when a row was actually persisted — unlike get_customer_profile, which synthesizes defaults.'
    return customer_profiles_service.customer_profile_exists(_customer_profiles_dependencies(), customer_id, store_path)


def update_customer_profile(customer_id: str, data: Dict[str, Any], store_path: Optional[Path] = None) -> Dict[str, Any]:
    return customer_profiles_service.update_customer_profile(_customer_profiles_dependencies(), customer_id, data, store_path)


def upsert_telegram_customer_profile(
    user: Dict[str, Any],
    store_path: Optional[Path] = None,
    *,
    bot_kind: str | None = None,
) -> Dict[str, Any]:
    # Links Telegram user to tg-{id} customer row shared by bot and web app.
    return customer_profiles_service.upsert_telegram_customer_profile(_customer_profiles_dependencies(), user, store_path, bot_kind=bot_kind)


def _customer_display_name(profile: Dict[str, Any]) -> str:
    return customer_profiles_service._customer_display_name(_customer_profiles_dependencies(), profile)


def is_guest_customer_id(customer_id: str) -> bool:
    return customer_profiles_service.is_guest_customer_id(_customer_profiles_dependencies(), customer_id)


def is_real_customer_profile(profile: Dict[str, Any]) -> bool:
    return customer_profiles_service.is_real_customer_profile(_customer_profiles_dependencies(), profile)


def customer_admin_display_name(profile: Dict[str, Any]) -> str:
    return customer_profiles_service.customer_admin_display_name(_customer_profiles_dependencies(), profile)


def prepare_customer_profile_for_admin(profile: Dict[str, Any]) -> Dict[str, Any]:
    return customer_profiles_service.prepare_customer_profile_for_admin(_customer_profiles_dependencies(), profile)


def list_admin_customer_profiles(
    include_guests: bool = False,
    query: str | None = None,
    store_path: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    return customer_profiles_service.list_admin_customer_profiles(_customer_profiles_dependencies(), include_guests, query, store_path)


def _profile_is_older_than(profile: Dict[str, Any], threshold: datetime) -> bool:
    return customer_profiles_service._profile_is_older_than(_customer_profiles_dependencies(), profile, threshold)


def purge_stale_guest_customers(
    days: int = 7,
    store_path: Optional[Path] = None,
    order_store_path: Optional[Path] = None,
) -> Dict[str, Any]:
    return customer_profiles_service.purge_stale_guest_customers(_customer_profiles_dependencies(), days, store_path, order_store_path)


def is_customer_client_registered(profile: Dict[str, Any]) -> bool:
    return customer_profiles_service.is_customer_client_registered(_customer_profiles_dependencies(), profile)


def _normalize_ukraine_phone_digits(phone: str) -> str:
    return customer_profiles_service._normalize_ukraine_phone_digits(_customer_profiles_dependencies(), phone)


def _customer_profile_phone_digits(profile: Dict[str, Any]) -> str:
    return customer_profiles_service._customer_profile_phone_digits(_customer_profiles_dependencies(), profile)


def find_telegram_user_id_by_phone(phone: str, store_path: Optional[Path] = None) -> Optional[str]:
    'Resolve Telegram user id from a tg-{id} profile or registered provider with the same phone.'
    return customer_profiles_service.find_telegram_user_id_by_phone(_customer_profiles_dependencies(), phone, store_path)


def find_verified_customer_by_phone(
    phone: str,
    *,
    exclude_id: str | None = None,
    store_path: Optional[Path] = None,
) -> Optional[Dict[str, Any]]:
    'Find a verified customer profile with the same phone (prefers tg-* canonical rows).'
    return customer_profiles_service.find_verified_customer_by_phone(_customer_profiles_dependencies(), phone, exclude_id=exclude_id, store_path=store_path)


PHONE_ALREADY_REGISTERED = "phone_already_registered"
PHONE_ALREADY_REGISTERED_UA = "Цей номер уже зареєстровано"


def _customer_phone_alias_ids(customer_id: str, profiles: List[Dict[str, Any]]) -> set[str]:
    'All customer rows that share the same phone as this profile (guest/tg duplicates).'
    return customer_profiles_service._customer_phone_alias_ids(_customer_profiles_dependencies(), customer_id, profiles)


def find_registered_customer_by_phone(
    phone: str,
    *,
    exclude_id: str | None = None,
    exclude_ids: set[str] | None = None,
    store_path: Optional[Path] = None,
    profiles: Optional[List[Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    'Find a registered customer profile with the same phone (prefers tg-* canonical rows).'
    return customer_profiles_service.find_registered_customer_by_phone(_customer_profiles_dependencies(), phone, exclude_id=exclude_id, exclude_ids=exclude_ids, store_path=store_path, profiles=profiles)


def resolve_customer_id_for_provider(provider_id: str, store_path: Optional[Path] = None) -> str:
    'Map provider-{customerId} (or linkedProviderId reverse lookup) back to the owning customer.'
    return provider_profiles_service.resolve_customer_id_for_provider(_provider_profiles_dependencies(), provider_id, store_path)


def find_registered_provider_by_phone(
    phone: str,
    *,
    exclude_id: str | None = None,
    store_path: Optional[Path] = None,
    providers: Optional[List[Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    'Find another registered provider that already uses this phone.'
    return provider_profiles_service.find_registered_provider_by_phone(_provider_profiles_dependencies(), phone, exclude_id=exclude_id, store_path=store_path, providers=providers)


def _profiles_share_account(
    customer_id_a: str,
    customer_id_b: str,
    profiles: List[Dict[str, Any]],
) -> bool:
    'True when two customer rows represent the same user (guest/tg/provider link).'
    return customer_profiles_service._profiles_share_account(_customer_profiles_dependencies(), customer_id_a, customer_id_b, profiles)


def _customer_phone_exclude_ids(
    customer_id: str,
    phone: str,
    profiles: List[Dict[str, Any]],
) -> set[str]:
    'Customer rows that may reuse this phone for the same authenticated account.'
    return customer_profiles_service._customer_phone_exclude_ids(_customer_profiles_dependencies(), customer_id, phone, profiles)


def _companion_provider_store_path(customer_store_path: Optional[Path]) -> Optional[Path]:
    return customer_profiles_service._companion_provider_store_path(_customer_profiles_dependencies(), customer_store_path)


def _ensure_customer_phone_available(
    customer_id: str,
    phone: str,
    profiles: List[Dict[str, Any]],
    store_path: Optional[Path] = None,
) -> None:
    return customer_profiles_service._ensure_customer_phone_available(_customer_profiles_dependencies(), customer_id, phone, profiles, store_path)


def _ensure_provider_phone_available(
    provider_id: str,
    phone: str,
    providers: Optional[List[Dict[str, Any]]] = None,
    *,
    customer_store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
) -> None:
    return provider_profiles_service._ensure_provider_phone_available(_provider_profiles_dependencies(), provider_id, phone, providers, customer_store_path=customer_store_path, provider_store_path=provider_store_path)


def sync_linked_provider_phone_verification_from_customer(
    provider_id: str,
    store_path: Optional[Path] = None,
    customer_store_path: Optional[Path] = None,
) -> Optional[Dict[str, Any]]:
    'Mirror verified client phone onto the linked partner cabinet without re-OTP.'
    return provider_profiles_service.sync_linked_provider_phone_verification_from_customer(_provider_profiles_dependencies(), provider_id, store_path, customer_store_path)


def _mark_profile_phone_verified(
    profile: Dict[str, Any],
    *,
    source_verification: Optional[Dict[str, Any]] = None,
    linked_provider_id: str = "",
) -> Dict[str, Any]:
    return customer_profiles_service._mark_profile_phone_verified(_customer_profiles_dependencies(), profile, source_verification=source_verification, linked_provider_id=linked_provider_id)


def _sync_phone_linked_verification(
    profile: Dict[str, Any],
    store_path: Optional[Path] = None,
) -> Dict[str, Any]:
    'Inherit verified status from another profile/provider with the same phone or linked cabinet.'
    return customer_profiles_service._sync_phone_linked_verification(_customer_profiles_dependencies(), profile, store_path)


def _maybe_persist_phone_linked_verification(
    profile: Dict[str, Any],
    store_path: Optional[Path] = None,
) -> Dict[str, Any]:
    return customer_profiles_service._maybe_persist_phone_linked_verification(_customer_profiles_dependencies(), profile, store_path)


def _is_valid_ukraine_mobile_phone(phone: str) -> bool:
    return customer_profiles_service._is_valid_ukraine_mobile_phone(_customer_profiles_dependencies(), phone)


def resolve_linked_provider_id(customer_id: str, profile: Dict[str, Any] | None = None) -> str:
    return customer_profiles_service.resolve_linked_provider_id(_customer_profiles_dependencies(), customer_id, profile)


def is_provider_profile_complete(provider: Optional[Dict[str, Any]]) -> bool:
    'True when partner has name, phone, vehicle, valid plate, specialties, and registeredAt.'
    return provider_profiles_service.is_provider_profile_complete(_provider_profiles_dependencies(), provider)


def is_customer_provider_registered(customer_id: str, store_path: Optional[Path] = None) -> bool:
    return customer_profiles_service.is_customer_provider_registered(_customer_profiles_dependencies(), customer_id, store_path)


def build_user_account_status(customer_id: str, store_path: Optional[Path] = None) -> Dict[str, Any]:
    return customer_profiles_service.build_user_account_status(_customer_profiles_dependencies(), customer_id, store_path)


def ensure_customer_client_from_linked_provider(
    customer_id: str,
    store_path: Optional[Path] = None,
) -> Dict[str, Any]:
    'Hydrate customer name/phone from linked partner so role switch does not re-ask registration.'
    return customer_profiles_service.ensure_customer_client_from_linked_provider(_customer_profiles_dependencies(), customer_id, store_path)


def set_user_preferred_role(customer_id: str, role: str, store_path: Optional[Path] = None) -> Dict[str, Any]:
    return customer_profiles_service.set_user_preferred_role(_customer_profiles_dependencies(), customer_id, role, store_path)


def mark_user_role_registered(customer_id: str, role: str, store_path: Optional[Path] = None) -> Dict[str, Any]:
    return customer_profiles_service.mark_user_role_registered(_customer_profiles_dependencies(), customer_id, role, store_path)


def submit_customer_verification(customer_id: str, data: Dict[str, Any], store_path: Optional[Path] = None) -> Dict[str, Any]:
    return customer_profiles_service.submit_customer_verification(_customer_profiles_dependencies(), customer_id, data, store_path)


def review_customer_verification(customer_id: str, data: Dict[str, Any], store_path: Optional[Path] = None) -> Dict[str, Any]:
    return customer_profiles_service.review_customer_verification(_customer_profiles_dependencies(), customer_id, data, store_path)


def update_provider_profile(provider_id: str, data: Dict[str, Any], store_path: Optional[Path] = None) -> Dict[str, Any]:
    return provider_profiles_service.update_provider_profile(_provider_profiles_dependencies(), provider_id, data, store_path)


def update_provider_presence(provider_id: str, data: Dict[str, Any], store_path: Optional[Path] = None) -> Dict[str, Any]:
    return provider_profiles_service.update_provider_presence(_provider_profiles_dependencies(), provider_id, data, store_path)


def _pending_offer_count_for_order(offers: List[Dict[str, Any]], order_id: str) -> int:
    return matching_service._pending_offer_count_for_order(_matching_dependencies(), offers, order_id)


def _try_offer_order_to_provider(
    order: Dict[str, Any],
    provider: Dict[str, Any],
    offers: List[Dict[str, Any]],
    now: Optional[datetime] = None,
) -> bool:
    'Create a pending offer for one eligible provider. Returns True when a new offer is added.'
    return matching_service._try_offer_order_to_provider(_matching_dependencies(), order, provider, offers, now)


def redispatch_searching_orders_for_provider(
    provider_id: str,
    order_store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
    offer_store_path: Optional[Path] = None,
) -> List[str]:
    'Offer nearby searching orders directly to a provider who is online. Returns order IDs with new offers.'
    return matching_service.redispatch_searching_orders_for_provider(_matching_dependencies(), provider_id, order_store_path, provider_store_path, offer_store_path)


def _offer_error_for_status(status: str) -> DispatchConflict:
    return matching_service._offer_error_for_status(_matching_dependencies(), status)


# Providers blocked from receiving another offer for the same order (expired may be re-offered).
DISPATCH_BLOCK_REOFFER_STATUSES = {"pending", "declined", "lost", "accepted", "cancelled"}


def _providers_blocked_for_order(offers: List[Dict[str, Any]], order_id: str) -> set[str]:
    return matching_service._providers_blocked_for_order(_matching_dependencies(), offers, order_id)


def _provider_should_skip_order(offers: List[Dict[str, Any]], provider_id: str, order_id: str) -> bool:
    return matching_service._provider_should_skip_order(_matching_dependencies(), offers, provider_id, order_id)


def _expire_offers_in_memory(offers: List[Dict[str, Any]], orders: List[Dict[str, Any]], now: Optional[datetime] = None) -> bool:
    return lifecycle_service._expire_offers_in_memory(_lifecycle_dependencies(), offers, orders, now)


def _cancel_idle_accepted_orders_in_memory(
    orders: List[Dict[str, Any]],
    offers: List[Dict[str, Any]],
    now: Optional[datetime] = None,
) -> List[Dict[str, Any]]:
    'Cancel accepted orders idle longer than ACCEPTED_IDLE_TIMEOUT_SECONDS. Mutates orders/offers.'
    return lifecycle_service._cancel_idle_accepted_orders_in_memory(_lifecycle_dependencies(), orders, offers, now)


def _free_providers_after_idle_cancel(
    cancelled_orders: List[Dict[str, Any]],
    provider_store_path: Optional[Path] = None,
) -> bool:
    return lifecycle_service._free_providers_after_idle_cancel(_lifecycle_dependencies(), cancelled_orders, provider_store_path)


MAX_DISPATCH_AUTO_RETRIES = 2


def expire_stale_dispatch(
    order_store_path: Optional[Path] = None,
    offer_store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    'Expire pending offers and cancel idle accepted orders. Returns cancelled (enriched) orders.'
    return lifecycle_service.expire_stale_dispatch(_lifecycle_dependencies(), order_store_path, offer_store_path, provider_store_path)


def expire_stale_and_notify(
    order_store_path: Optional[Path] = None,
    offer_store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
    *,
    force: bool = False,
) -> List[Dict[str, Any]]:
    """Expire stale dispatch state and notify parties about idle-accepted cancellations."""
    global _LAST_EXPIRE_STALE_MONOTONIC
    import time

    if not force and _EXPIRE_STALE_MIN_INTERVAL_SECONDS > 0:
        now_mono = time.monotonic()
        with _EXPIRE_STALE_LOCK:
            if (now_mono - _LAST_EXPIRE_STALE_MONOTONIC) < _EXPIRE_STALE_MIN_INTERVAL_SECONDS:
                return []
            _LAST_EXPIRE_STALE_MONOTONIC = now_mono

    cancelled = expire_stale_dispatch(
        order_store_path=order_store_path,
        offer_store_path=offer_store_path,
        provider_store_path=provider_store_path,
    )
    if not cancelled:
        return cancelled
    from bot.realtime import publish_order_event, publish_provider_event
    from bot.telegram_bot import notify_order_cancelled

    for order in cancelled:
        notify_order_cancelled(order)
        publish_order_event(order, "order.cancelled")
        provider_id = str(order.get("assignedProviderId") or order.get("partnerId") or "").strip()
        if provider_id:
            publish_provider_event(
                provider_id,
                "offers.changed",
                {"orderId": order.get("id"), "action": "terminal", "reason": "accepted_idle_timeout"},
            )
    return cancelled


def expire_offers(order_store_path: Optional[Path] = None, offer_store_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    return lifecycle_service.expire_offers(_lifecycle_dependencies(), order_store_path, offer_store_path)

def invalidate_order_offers(order_id: str, status: str = "cancelled", offer_store_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    return lifecycle_service.invalidate_order_offers(_lifecycle_dependencies(), order_id, status, offer_store_path)


def _set_provider_status(provider_id: str, status: str, assigned_order_id: Optional[str] = None, provider_store_path: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    return lifecycle_service._set_provider_status(_lifecycle_dependencies(), provider_id, status, assigned_order_id, provider_store_path)


def _provider_is_recent(provider: Dict[str, Any], now: Optional[datetime] = None) -> bool:
    return matching_service._provider_is_recent(_matching_dependencies(), provider, now)


def eligible_providers_for_order(
    order: Dict[str, Any],
    providers: Optional[List[Dict[str, Any]]] = None,
    already_offered_provider_ids: Optional[set[str]] = None,
    now: Optional[datetime] = None,
) -> List[Dict[str, Any]]:
    return matching_service.eligible_providers_for_order(_matching_dependencies(), order, providers, already_offered_provider_ids, now)


def _public_offer_payload(offer: Dict[str, Any], order: Dict[str, Any]) -> Dict[str, Any]:
    return matching_service._public_offer_payload(_matching_dependencies(), offer, order)


def dispatch_order(
    order_id: str,
    order_store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
    offer_store_path: Optional[Path] = None,
    *,
    reset_auto_retry: bool = False,
    force_wave: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    return matching_service.dispatch_order(_matching_dependencies(), order_id, order_store_path, provider_store_path, offer_store_path, reset_auto_retry=reset_auto_retry, force_wave=force_wave)


def _dispatch_order_sql(
    order_id: str,
    *,
    reset_auto_retry: bool = False,
    force_wave: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    'Row-level SQL dispatch: no full-table rewrite of orders/offers/providers.'
    return matching_service._dispatch_order_sql(_matching_dependencies(), order_id, reset_auto_retry=reset_auto_retry, force_wave=force_wave)


def attach_dispatch_to_order(order: Dict[str, Any], offers: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    return matching_service.attach_dispatch_to_order(_matching_dependencies(), order, offers)


def attach_dispatch_to_orders(orders: List[Dict[str, Any]], offers: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
    return matching_service.attach_dispatch_to_orders(_matching_dependencies(), orders, offers)


def get_provider_offers(
    provider_id: str,
    order_store_path: Optional[Path] = None,
    offer_store_path: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    # Always expire before listing — do not use throttled expire_stale_and_notify here,
    # or recently-expired offers stay visible between throttle windows.
    return matching_service.get_provider_offers(_matching_dependencies(), provider_id, order_store_path, offer_store_path)


def accept_offer(
    offer_id: str,
    provider_id: str,
    order_store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
    offer_store_path: Optional[Path] = None,
    proposed_price: Optional[float] = None,
    price_note: Optional[str] = None,
) -> Dict[str, Any]:
    return lifecycle_service.accept_offer(_lifecycle_dependencies(), offer_id, provider_id, order_store_path, provider_store_path, offer_store_path, proposed_price, price_note)


def decline_offer(
    offer_id: str,
    provider_id: str,
    order_store_path: Optional[Path] = None,
    offer_store_path: Optional[Path] = None,
) -> Dict[str, Any]:
    return lifecycle_service.decline_offer(_lifecycle_dependencies(), offer_id, provider_id, order_store_path, offer_store_path)


def update_provider_order_status(
    provider_id: str,
    order_id: str,
    status: str,
    order_store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
    offer_store_path: Optional[Path] = None,
) -> Dict[str, Any]:
    return lifecycle_service.update_provider_order_status(_lifecycle_dependencies(), provider_id, order_id, status, order_store_path, provider_store_path, offer_store_path)


def build_admin_stats(
    order_store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
    customer_store_path: Optional[Path] = None,
) -> Dict[str, Any]:
    return order_queries_service.build_admin_stats(_order_queries_dependencies(), order_store_path, provider_store_path, customer_store_path)


def build_admin_activity_feed(limit: int = 20, order_store_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    return order_queries_service.build_admin_activity_feed(_order_queries_dependencies(), limit, order_store_path)


def admin_update_customer_profile(customer_id: str, data: Dict[str, Any], store_path: Optional[Path] = None) -> Dict[str, Any]:
    return customer_profiles_service.admin_update_customer_profile(_customer_profiles_dependencies(), customer_id, data, store_path)


def admin_update_provider_profile(provider_id: str, data: Dict[str, Any], store_path: Optional[Path] = None) -> Dict[str, Any]:
    return provider_profiles_service.admin_update_provider_profile(_provider_profiles_dependencies(), provider_id, data, store_path)


def admin_delete_provider(provider_id: str, store_path: Optional[Path] = None) -> Dict[str, Any]:
    return provider_profiles_service.admin_delete_provider(_provider_profiles_dependencies(), provider_id, store_path)


def _order_belongs_to_customer(order: Dict[str, Any], customer_id: str) -> bool:
    return order_queries_service._order_belongs_to_customer(_order_queries_dependencies(), order, customer_id)


def _order_belongs_to_provider(order: Dict[str, Any], provider_id: str) -> bool:
    return order_queries_service._order_belongs_to_provider(_order_queries_dependencies(), order, provider_id)


def _customer_ids_for_order_history(
    customer_id: str,
    customer_store_path: Optional[Path] = None,
) -> set[str]:
    'Include phone-linked guest/tg aliases so cabinet history is not empty after re-login.'
    return order_queries_service._customer_ids_for_order_history(_order_queries_dependencies(), customer_id, customer_store_path)


def rebind_customer_orders(
    from_customer_ids: set[str] | list[str],
    to_customer_id: str,
    store_path: Optional[Path] = None,
) -> int:
    'Rewrite order customerId from legacy guest/alias rows onto the canonical account.'
    return order_queries_service.rebind_customer_orders(_order_queries_dependencies(), from_customer_ids, to_customer_id, store_path)


def _clear_customer_phone(customer_id: str, store_path: Optional[Path] = None) -> None:
    'Clear phone on a conflicting guest/alias row so the canonical profile can claim it.'
    return customer_profiles_service._clear_customer_phone(_customer_profiles_dependencies(), customer_id, store_path)


def _claim_conflicting_guest_phone(
    customer_id: str,
    phone: str,
    store_path: Optional[Path] = None,
) -> bool:
    'If phone is held by a guest/non-tg row, clear it, rebind orders, return True when claimed.'
    return customer_profiles_service._claim_conflicting_guest_phone(_customer_profiles_dependencies(), customer_id, phone, store_path)


def list_orders_for_customer(
    customer_id: str,
    store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
    customer_store_path: Optional[Path] = None,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    return order_queries_service.list_orders_for_customer(_order_queries_dependencies(), customer_id, store_path, provider_store_path, customer_store_path, limit)


def list_orders_for_provider(
    provider_id: str,
    store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    return order_queries_service.list_orders_for_provider(_order_queries_dependencies(), provider_id, store_path, provider_store_path, limit)


def list_provider_public_reviews(
    provider_id: str,
    store_path: Optional[Path] = None,
    limit: int = 20,
) -> List[Dict[str, Any]]:
    'Customer reviews left for a provider after completed orders (public, sanitized).'
    return order_queries_service.list_provider_public_reviews(_order_queries_dependencies(), provider_id, store_path, limit)


def get_provider_public_card(
    provider_id: str,
    *,
    store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
    limit: int = 20,
) -> Optional[Dict[str, Any]]:
    'Public partner card for map clients: profile summary + reviews (no auth).\n\nContacts and exact coordinates stay private until assignment — same privacy bar\nas ``/map/providers`` pins. Directory businesses may keep a public street address.'
    return order_queries_service.get_provider_public_card(_order_queries_dependencies(), provider_id, store_path=store_path, provider_store_path=provider_store_path, limit=limit)


def _increment_provider_orders_completed(provider_id: str, provider_store_path: Optional[Path] = None) -> None:
    return reviews_service._increment_provider_orders_completed(_reviews_dependencies(), provider_id, provider_store_path)


def _increment_customer_orders_completed(customer_id: str, customer_store_path: Optional[Path] = None) -> None:
    return reviews_service._increment_customer_orders_completed(_reviews_dependencies(), customer_id, customer_store_path)


def _apply_star_rating(target: Dict[str, Any], stars: int) -> None:
    return reviews_service._apply_star_rating(_reviews_dependencies(), target, stars)


def submit_order_review(
    order_id: str,
    *,
    author_role: str,
    rating: int,
    comment: str = "",
    author_id: str = "",
    store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
    customer_store_path: Optional[Path] = None,
) -> Dict[str, Any]:
    return reviews_service.submit_order_review(_reviews_dependencies(), order_id, author_role=author_role, rating=rating, comment=comment, author_id=author_id, store_path=store_path, provider_store_path=provider_store_path, customer_store_path=customer_store_path)


def _lifecycle_dependencies() -> lifecycle_service.Dependencies:
    return lifecycle_service.Dependencies(
        ACCEPTED_IDLE_TIMEOUT_SECONDS=ACCEPTED_IDLE_TIMEOUT_SECONDS,
        DispatchConflict=DispatchConflict,
        InvalidStatusTransition=InvalidStatusTransition,
        MAX_DISPATCH_AUTO_RETRIES=MAX_DISPATCH_AUTO_RETRIES,
        ORDER_TRANSITIONS=ORDER_TRANSITIONS,
        STORE_LOCK=STORE_LOCK,
        SqlDispatchConflict=SqlDispatchConflict,
        TERMINAL_ORDER_STATUSES=TERMINAL_ORDER_STATUSES,
        _append_order_event=_append_order_event,
        _cancel_idle_accepted_orders_in_memory=_cancel_idle_accepted_orders_in_memory,
        _default_offer_store_path=_default_offer_store_path,
        _default_provider_store_path=_default_provider_store_path,
        _default_store_path=_default_store_path,
        _expire_offers_in_memory=_expire_offers_in_memory,
        _free_providers_after_idle_cancel=_free_providers_after_idle_cancel,
        _increment_customer_orders_completed=_increment_customer_orders_completed,
        _increment_provider_orders_completed=_increment_provider_orders_completed,
        _normalize_proposed_price=_normalize_proposed_price,
        _now_iso=_now_iso,
        _offer_error_for_status=_offer_error_for_status,
        _order_accepted_at=_order_accepted_at,
        _parse_iso=_parse_iso,
        _set_provider_status=_set_provider_status,
        _should_use_sql_runtime=_should_use_sql_runtime,
        _should_use_sql_store=_should_use_sql_store,
        _write_json_atomic=_write_json_atomic,
        attach_dispatch_to_order=attach_dispatch_to_order,
        dispatch_order=dispatch_order,
        enrich_order_for_client=enrich_order_for_client,
        expire_stale_and_notify=expire_stale_and_notify,
        expire_stale_dispatch=expire_stale_dispatch,
        get_order=get_order,
        get_provider_profile=get_provider_profile,
        invalidate_order_offers=invalidate_order_offers,
        is_provider_verified=is_provider_verified,
        load_offers=load_offers,
        load_orders=load_orders,
        load_providers=load_providers,
        normalize_order_status=normalize_order_status,
        peek_order_status=peek_order_status,
        save_offers=save_offers,
        save_providers=save_providers,
        sql_accept_offer=sql_accept_offer,
        sql_commit_order_snapshot=sql_commit_order_snapshot,
        sql_decline_offer=sql_decline_offer,
        sql_expire_pending_offers=sql_expire_pending_offers,
        sql_get_order=sql_get_order,
        sql_invalidate_order_offers=sql_invalidate_order_offers,
        sql_offers_for_order=sql_offers_for_order,
        sql_offers_for_orders=sql_offers_for_orders,
        sql_orders_by_status=sql_orders_by_status,
        sql_upsert_order=sql_upsert_order,
        sql_upsert_provider=sql_upsert_provider,
        update_order_status=update_order_status,
    )


def _matching_dependencies() -> matching_service.Dependencies:
    return matching_service.Dependencies(
        DISPATCH_BLOCK_REOFFER_STATUSES=DISPATCH_BLOCK_REOFFER_STATUSES,
        DISPATCH_SEARCH_RADIUS_STEPS_KM=DISPATCH_SEARCH_RADIUS_STEPS_KM,
        DISPATCH_WAVE1_SIZE=DISPATCH_WAVE1_SIZE,
        DISPATCH_WAVE2_SIZE=DISPATCH_WAVE2_SIZE,
        DISPATCH_WAVE_WAIT_SECONDS=DISPATCH_WAVE_WAIT_SECONDS,
        DispatchConflict=DispatchConflict,
        MAX_PROVIDER_OFFERS=MAX_PROVIDER_OFFERS,
        OFFER_TIMEOUT_SECONDS=OFFER_TIMEOUT_SECONDS,
        PROVIDER_PRESENCE_TTL_SECONDS=PROVIDER_PRESENCE_TTL_SECONDS,
        PROVIDER_SPECIALTIES=PROVIDER_SPECIALTIES,
        STORE_LOCK=STORE_LOCK,
        _append_order_event=_append_order_event,
        _clean_provider_specialties=_clean_provider_specialties,
        _default_offer_store_path=_default_offer_store_path,
        _default_provider_store_path=_default_provider_store_path,
        _default_store_path=_default_store_path,
        _dispatch_order_sql=_dispatch_order_sql,
        _expire_offers_in_memory=_expire_offers_in_memory,
        _now_iso=_now_iso,
        _parse_iso=_parse_iso,
        _pending_offer_count_for_order=_pending_offer_count_for_order,
        _provider_is_recent=_provider_is_recent,
        _provider_should_skip_order=_provider_should_skip_order,
        _providers_blocked_for_order=_providers_blocked_for_order,
        _public_offer_payload=_public_offer_payload,
        _should_use_sql_runtime=_should_use_sql_runtime,
        _should_use_sql_store=_should_use_sql_store,
        _try_offer_order_to_provider=_try_offer_order_to_provider,
        _valid_point=_valid_point,
        _write_json_atomic=_write_json_atomic,
        attach_dispatch_to_order=attach_dispatch_to_order,
        eligible_providers_for_order=eligible_providers_for_order,
        enrich_order_for_client=enrich_order_for_client,
        expire_stale_dispatch=expire_stale_dispatch,
        get_provider_profile=get_provider_profile,
        haversine_distance_km=haversine_distance_km,
        initial_radius_km_for_service=initial_radius_km_for_service,
        is_provider_verified=is_provider_verified,
        load_offers=load_offers,
        load_orders=load_orders,
        load_providers=load_providers,
        normalize_order_status=normalize_order_status,
        normalize_service=normalize_service,
        peek_order_status=peek_order_status,
        save_offers=save_offers,
        search_radius_steps_for_service=search_radius_steps_for_service,
        sql_candidate_providers_for_order=sql_candidate_providers_for_order,
        sql_commit_dispatch_wave=sql_commit_dispatch_wave,
        sql_expire_pending_offers=sql_expire_pending_offers,
        sql_get_order=sql_get_order,
        sql_offers_for_order=sql_offers_for_order,
        sql_pending_offers_for_provider=sql_pending_offers_for_provider,
        sql_searching_orders_near_provider=sql_searching_orders_near_provider,
        sql_upsert_order=sql_upsert_order,
        wave_batch_size=wave_batch_size,
    )


def _customer_profiles_dependencies() -> customer_profiles_service.Dependencies:
    return customer_profiles_service.Dependencies(
        PHONE_ALREADY_REGISTERED=PHONE_ALREADY_REGISTERED,
        STORE_LOCK=STORE_LOCK,
        VERIFICATION_STATUSES=VERIFICATION_STATUSES,
        _claim_conflicting_guest_phone=_claim_conflicting_guest_phone,
        _clean_provider_specialties=_clean_provider_specialties,
        _clear_customer_phone=_clear_customer_phone,
        _companion_provider_store_path=_companion_provider_store_path,
        _customer_display_name=_customer_display_name,
        _customer_phone_alias_ids=_customer_phone_alias_ids,
        _customer_phone_exclude_ids=_customer_phone_exclude_ids,
        _customer_profile_completeness=_customer_profile_completeness,
        _customer_profile_phone_digits=_customer_profile_phone_digits,
        _decrypt_customer_record=_decrypt_customer_record,
        _default_customer_profile=_default_customer_profile,
        _default_customer_store_path=_default_customer_store_path,
        _encrypt_customer_record=_encrypt_customer_record,
        _ensure_customer_phone_available=_ensure_customer_phone_available,
        _mark_profile_phone_verified=_mark_profile_phone_verified,
        _maybe_persist_phone_linked_verification=_maybe_persist_phone_linked_verification,
        _normalize_customer_profile=_normalize_customer_profile,
        _normalize_ukraine_phone_digits=_normalize_ukraine_phone_digits,
        _now_iso=_now_iso,
        _profile_is_older_than=_profile_is_older_than,
        _profiles_share_account=_profiles_share_account,
        _should_use_sql_store=_should_use_sql_store,
        _sync_phone_linked_verification=_sync_phone_linked_verification,
        _truthy_flag=_truthy_flag,
        _verification_badges=_verification_badges,
        _write_json_atomic=_write_json_atomic,
        build_user_account_status=build_user_account_status,
        customer_admin_display_name=customer_admin_display_name,
        decrypt_customer_profile=decrypt_customer_profile,
        decrypt_field=decrypt_field,
        encrypt_customer_profile=encrypt_customer_profile,
        ensure_customer_client_from_linked_provider=ensure_customer_client_from_linked_provider,
        find_registered_customer_by_phone=find_registered_customer_by_phone,
        find_registered_provider_by_phone=find_registered_provider_by_phone,
        find_verified_customer_by_phone=find_verified_customer_by_phone,
        get_customer_profile=get_customer_profile,
        get_provider_profile=get_provider_profile,
        is_customer_client_registered=is_customer_client_registered,
        is_customer_provider_registered=is_customer_provider_registered,
        is_encrypted_value=is_encrypted_value,
        is_guest_customer_id=is_guest_customer_id,
        is_provider_verified=is_provider_verified,
        is_real_customer_profile=is_real_customer_profile,
        load_collection=load_collection,
        load_customer_profiles=load_customer_profiles,
        load_orders=load_orders,
        mark_user_role_registered=mark_user_role_registered,
        normalize_verification_status=normalize_verification_status,
        prepare_customer_profile_for_admin=prepare_customer_profile_for_admin,
        rebind_customer_orders=rebind_customer_orders,
        resolve_customer_id_for_provider=resolve_customer_id_for_provider,
        resolve_linked_provider_id=resolve_linked_provider_id,
        resolve_provider_telegram_user_id=resolve_provider_telegram_user_id,
        save_customer_profiles=save_customer_profiles,
        sql_customers_by_phone_lookup=sql_customers_by_phone_lookup,
        sql_get_customer=sql_get_customer,
        sql_upsert_customer=sql_upsert_customer,
        submit_customer_verification=submit_customer_verification,
        update_customer_profile=update_customer_profile,
    )


def _provider_profiles_dependencies() -> provider_profiles_service.Dependencies:
    return provider_profiles_service.Dependencies(
        PHONE_ALREADY_REGISTERED=PHONE_ALREADY_REGISTERED,
        PROVIDER_ACTIVE_STATUSES=PROVIDER_ACTIVE_STATUSES,
        PROVIDER_PRESENCE_TTL_SECONDS=PROVIDER_PRESENCE_TTL_SECONDS,
        PROVIDER_SPECIALTIES=PROVIDER_SPECIALTIES,
        PROVIDER_STATUSES=PROVIDER_STATUSES,
        STORE_LOCK=STORE_LOCK,
        VERIFICATION_STATUSES=VERIFICATION_STATUSES,
        _clean_provider_specialties=_clean_provider_specialties,
        _customer_profile_completeness=_customer_profile_completeness,
        _customer_profile_phone_digits=_customer_profile_phone_digits,
        _decrypt_customer_record=_decrypt_customer_record,
        _default_customer_profile=_default_customer_profile,
        _default_customer_store_path=_default_customer_store_path,
        _default_provider_store_path=_default_provider_store_path,
        _default_provider_verification=_default_provider_verification,
        _default_providers=_default_providers,
        _encrypt_customer_record=_encrypt_customer_record,
        _ensure_provider_phone_available=_ensure_provider_phone_available,
        _normalize_customer_profile=_normalize_customer_profile,
        _normalize_provider_trust=_normalize_provider_trust,
        _normalize_ukraine_phone_digits=_normalize_ukraine_phone_digits,
        _now_iso=_now_iso,
        _parse_iso=_parse_iso,
        _profiles_share_account=_profiles_share_account,
        _should_use_sql_store=_should_use_sql_store,
        _truthy_flag=_truthy_flag,
        _verification_badges=_verification_badges,
        _write_json_atomic=_write_json_atomic,
        apply_provider_presence_ttl=apply_provider_presence_ttl,
        build_empty_provider_profile_shell=build_empty_provider_profile_shell,
        ensure_linked_provider_profile=ensure_linked_provider_profile,
        find_registered_provider_by_phone=find_registered_provider_by_phone,
        get_customer_profile=get_customer_profile,
        get_provider_profile=get_provider_profile,
        is_customer_client_registered=is_customer_client_registered,
        is_provider_profile_complete=is_provider_profile_complete,
        is_provider_verified=is_provider_verified,
        is_valid_ukraine_plate=is_valid_ukraine_plate,
        load_collection=load_collection,
        load_customer_profiles=load_customer_profiles,
        load_providers=load_providers,
        mark_user_role_registered=mark_user_role_registered,
        normalize_ukraine_plate=normalize_ukraine_plate,
        normalize_verification_status=normalize_verification_status,
        redispatch_searching_orders_for_provider=redispatch_searching_orders_for_provider,
        resolve_customer_id_for_provider=resolve_customer_id_for_provider,
        resolve_linked_provider_id=resolve_linked_provider_id,
        save_providers=save_providers,
        sql_get_customer=sql_get_customer,
        sql_providers_by_phone_lookup=sql_providers_by_phone_lookup,
        sql_upsert_customer=sql_upsert_customer,
        sql_upsert_provider=sql_upsert_provider,
        sync_linked_provider_phone_verification_from_customer=sync_linked_provider_phone_verification_from_customer,
        update_customer_profile=update_customer_profile,
        verify_provider_phone_otp=verify_provider_phone_otp,
    )


def _order_queries_dependencies() -> order_queries_service.Dependencies:
    return order_queries_service.Dependencies(
        ACCEPTED_IDLE_TIMEOUT_SECONDS=ACCEPTED_IDLE_TIMEOUT_SECONDS,
        STORE_LOCK=STORE_LOCK,
        _customer_ids_for_order_history=_customer_ids_for_order_history,
        _customer_profile_phone_digits=_customer_profile_phone_digits,
        _default_store_path=_default_store_path,
        _normalize_ukraine_phone_digits=_normalize_ukraine_phone_digits,
        _now_iso=_now_iso,
        _order_accepted_at=_order_accepted_at,
        _order_belongs_to_customer=_order_belongs_to_customer,
        _order_belongs_to_provider=_order_belongs_to_provider,
        _should_use_sql_store=_should_use_sql_store,
        _valid_point=_valid_point,
        _write_json_atomic=_write_json_atomic,
        enrich_order_for_client=enrich_order_for_client,
        get_customer_profile=get_customer_profile,
        get_order=get_order,
        get_provider_profile=get_provider_profile,
        haversine_distance_km=haversine_distance_km,
        is_customer_client_registered=is_customer_client_registered,
        is_map_request_order=is_map_request_order,
        list_provider_public_reviews=list_provider_public_reviews,
        load_customer_profiles=load_customer_profiles,
        load_offers=load_offers,
        load_orders=load_orders,
        load_providers=load_providers,
        normalize_order_status=normalize_order_status,
        normalize_service=normalize_service,
        normalize_verification_status=normalize_verification_status,
        partner_provider_ids_for_order=partner_provider_ids_for_order,
        peek_order_status=peek_order_status,
        resolve_linked_provider_id=resolve_linked_provider_id,
        resolve_provider_telegram_user_id=resolve_provider_telegram_user_id,
        sql_get_order=sql_get_order,
        sql_orders_for_provider=sql_orders_for_provider,
        sql_upsert_order=sql_upsert_order,
    )


def _reviews_dependencies() -> reviews_service.Dependencies:
    return reviews_service.Dependencies(
        DispatchConflict=DispatchConflict,
        STORE_LOCK=STORE_LOCK,
        _append_order_event=_append_order_event,
        _apply_star_rating=_apply_star_rating,
        _customer_ids_for_order_history=_customer_ids_for_order_history,
        _decrypt_customer_record=_decrypt_customer_record,
        _default_customer_store_path=_default_customer_store_path,
        _default_provider_store_path=_default_provider_store_path,
        _default_store_path=_default_store_path,
        _encrypt_customer_record=_encrypt_customer_record,
        _now_iso=_now_iso,
        _order_belongs_to_customer=_order_belongs_to_customer,
        _should_use_sql_store=_should_use_sql_store,
        _write_json_atomic=_write_json_atomic,
        enrich_order_for_client=enrich_order_for_client,
        get_provider_profile=get_provider_profile,
        load_customer_profiles=load_customer_profiles,
        load_orders=load_orders,
        load_providers=load_providers,
        normalize_order_status=normalize_order_status,
        save_customer_profiles=save_customer_profiles,
        save_providers=save_providers,
        sql_get_customer=sql_get_customer,
        sql_get_order=sql_get_order,
        sql_upsert_customer=sql_upsert_customer,
        sql_upsert_order=sql_upsert_order,
        sql_upsert_provider=sql_upsert_provider,
    )
