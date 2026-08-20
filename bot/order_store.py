import json
import math
import os
import threading
import uuid
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
    sql_get_customer,
    sql_upsert_customer,
    sql_get_order,
    sql_upsert_order,
    sql_get_provider,
    sql_offers_for_order,
    sql_orders_for_provider,
    sql_pending_offers_for_provider,
    sql_providers_by_phone_lookup,
    sql_storage_enabled,
    sql_upsert_provider,
)
from bot.ukraine_plate import is_valid_ukraine_plate, normalize_ukraine_plate

PROVIDER_PRESENCE_TTL_SECONDS = 60
PROVIDER_ACTIVE_STATUSES = {"online", "busy"}
PROVIDER_STATUSES = {"online", "busy", "offline"}
PROVIDER_SPECIALTIES = {"tow", "battery", "wheel", "fuel", "lockout", "mechanic"}
VERIFICATION_STATUSES = {"unverified", "pending", "verified", "rejected"}
DISPATCH_SEARCH_RADIUS_STEPS_KM = [int(value) for value in os.getenv("SEARCH_RADIUS_STEPS_KM", "5,10,20,40").split(",") if value.strip().isdigit()]
MAX_PROVIDER_OFFERS = int(os.getenv("MAX_PROVIDER_OFFERS", "5"))
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

ORDER_STATUS_ALIASES = {
    "created": "searching",
    "matching": "searching",
    "tracking": "en_route",
    "pending": "searching",
}
ORDER_STATUSES = {
    "draft",
    "searching",
    "accepted",
    "price_confirmed",
    "assigned",
    "en_route",
    "arrived",
    "in_progress",
    "completed",
    "cancelled",
}
ACTIVE_ORDER_STATUSES = {
    "searching",
    "accepted",
    "price_confirmed",
    "assigned",
    "en_route",
    "arrived",
    "in_progress",
}
TERMINAL_ORDER_STATUSES = {"completed", "cancelled"}
MAP_REQUEST_PIN_STATUSES = {"searching"}
ORDER_TRANSITIONS = {
    "draft": {"searching", "cancelled"},
    "searching": {"accepted", "cancelled"},
    "accepted": {"price_confirmed", "cancelled"},
    "price_confirmed": {"en_route", "cancelled"},
    "assigned": {"price_confirmed", "en_route", "cancelled"},
    "en_route": {"arrived", "cancelled"},
    "arrived": {"in_progress", "cancelled"},
    "in_progress": {"completed", "cancelled"},
    "completed": set(),
    "cancelled": set(),
}


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


def peek_order_status(status: Any) -> Optional[str]:
    """Map-safe status: missing/unknown is None, never silently becomes searching."""
    raw = str(status or "").strip().lower()
    if not raw:
        return None
    raw = ORDER_STATUS_ALIASES.get(raw, raw)
    if raw not in ORDER_STATUSES:
        return None
    return raw


def _order_accepted_at(order: Dict[str, Any]) -> Optional[datetime]:
    parsed = _parse_iso(order.get("acceptedAt"))
    if parsed is not None:
        return parsed
    history = order.get("statusHistory")
    if isinstance(history, list):
        for entry in reversed(history):
            if not isinstance(entry, dict):
                continue
            if peek_order_status(entry.get("status")) == "accepted":
                at = _parse_iso(entry.get("at"))
                if at is not None:
                    return at
    return _parse_iso(order.get("updatedAt")) or _parse_iso(order.get("createdAt"))


def normalize_order_status(status: Any) -> str:
    normalized = str(status or "searching").strip().lower()
    normalized = ORDER_STATUS_ALIASES.get(normalized, normalized)
    if normalized not in ORDER_STATUSES:
        raise ValueError(f"unknown order status: {status}")
    return normalized


def is_map_request_order(order: Dict[str, Any]) -> bool:
    """Unassigned searching orders only — completed/cancelled never become map pins."""
    status = peek_order_status(order.get("status"))
    if status not in MAP_REQUEST_PIN_STATUSES:
        return False
    if order.get("assignedProviderId"):
        return False
    return True


def _normalize_proposed_price(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if parsed <= 0:
        return None
    return round(parsed, 2)


def confirm_order_price(
    order_id: str,
    order_store_path: Optional[Path] = None,
    offer_store_path: Optional[Path] = None,
) -> Dict[str, Any]:
    expire_stale_and_notify(order_store_path=order_store_path, offer_store_path=offer_store_path)
    with STORE_LOCK:
        path = order_store_path or _default_store_path()
        orders = load_orders(path)
        order = next((item for item in orders if str(item.get("id")) == str(order_id)), None)
        if order is None:
            raise DispatchConflict("ORDER_NOT_FOUND", "Order was not found.")

        current_status = normalize_order_status(order.get("status"))
        if current_status == "cancelled" and order.get("cancelReason") == "accepted_idle_timeout":
            raise DispatchConflict("ORDER_ACCEPTED_TIMEOUT", "Accepted order was cancelled after idle timeout.")
        if current_status not in {"accepted", "assigned"}:
            raise DispatchConflict("PRICE_NOT_PENDING", "Order is not waiting for price confirmation.")

        now = _now_iso()
        order["status"] = "price_confirmed"
        order["priceConfirmedAt"] = now
        order["updatedAt"] = now
        history = order.get("statusHistory") if isinstance(order.get("statusHistory"), list) else []
        history.append({"status": "price_confirmed", "at": now})
        order["statusHistory"] = history
        _append_order_event(order, "PRICE_CONFIRMED", now, {"price": order.get("partnerProposedPrice")})
        _write_json_atomic(path, orders)
        return attach_dispatch_to_order(order, load_offers(offer_store_path))


def apply_provider_presence_ttl(providers: List[Dict[str, Any]], now: Optional[datetime] = None) -> List[Dict[str, Any]]:
    checked_at = now or datetime.now(timezone.utc).replace(tzinfo=None)
    visible_providers: List[Dict[str, Any]] = []

    for provider in providers:
        payload = dict(provider)
        status = str(payload.get("status") or "offline")
        last_seen = _parse_iso(payload.get("lastSeenAt") or payload.get("updatedAt"))
        if status in PROVIDER_ACTIVE_STATUSES and (last_seen is None or checked_at - last_seen > timedelta(seconds=PROVIDER_PRESENCE_TTL_SECONDS)):
            payload["status"] = "offline"
            payload["stale"] = True
        visible_providers.append(payload)

    return visible_providers


def _clean_provider_specialties(value: Any) -> List[str]:
    if not isinstance(value, list):
        return []
    cleaned: List[str] = []
    for item in value:
        specialty = str(item).strip()
        if specialty in PROVIDER_SPECIALTIES and specialty not in cleaned:
            cleaned.append(specialty)
    return cleaned


def normalize_verification_status(status: Any, default: str = "unverified") -> str:
    normalized = str(status or default).strip().lower()
    return normalized if normalized in VERIFICATION_STATUSES else default


def _truthy_flag(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    return bool(value)


def _verification_badges(status: str, role: str) -> List[str]:
    if status == "verified":
        return ["Перевірено POMICH", "Документи перевірено"] if role == "provider" else ["Профіль заповнено", "Телефон збережено"]
    if status == "pending":
        return ["На перевірці"] if role == "provider" else ["Профіль заповнено"]
    if status == "rejected":
        return ["Потрібне оновлення документів"] if role == "provider" else ["Потрібне оновлення профілю"]
    return ["Потребує перевірки"] if role == "provider" else ["Заповніть профіль"]


def _default_provider_verification(status: str, timestamp: str | None = None) -> Dict[str, Any]:
    verified = status == "verified"
    return {
        "identityDocument": verified,
        "driverLicense": verified,
        "vehicleRegistration": verified,
        "serviceProof": verified,
        "selfieCheck": verified,
        "backgroundCheck": "passed" if verified else "not_started",
        "submittedAt": timestamp if verified else None,
        "reviewedAt": timestamp if verified else None,
        "reviewedBy": "seed" if verified else None,
        "reviewNote": "Seeded verified provider" if verified else "",
    }


def _normalize_provider_trust(provider: Dict[str, Any], default_status: str = "unverified") -> Dict[str, Any]:
    payload = dict(provider)
    status = normalize_verification_status(payload.get("verificationStatus") or payload.get("verification_status"), default_status)
    timestamp = str(payload.get("profileUpdatedAt") or payload.get("registeredAt") or payload.get("updatedAt") or _now_iso())
    existing = payload.get("verification") if isinstance(payload.get("verification"), dict) else {}
    verification = {**_default_provider_verification(status, timestamp), **existing}
    if status == "verified":
        for key in ["identityDocument", "driverLicense", "vehicleRegistration", "serviceProof", "selfieCheck"]:
            verification[key] = True
        verification["backgroundCheck"] = verification.get("backgroundCheck") or "passed"
    payload["verificationStatus"] = status
    payload["verification"] = verification
    badges = payload.get("trustedBadges") if isinstance(payload.get("trustedBadges"), list) else None
    payload["trustedBadges"] = badges or _verification_badges(status, "provider")
    payload.pop("verification_status", None)
    return payload


def is_provider_verified(provider: Dict[str, Any]) -> bool:
    status = normalize_verification_status(provider.get("verificationStatus"), "unverified")
    if status == "verified":
        return True
    verification = provider.get("verification") if isinstance(provider.get("verification"), dict) else {}
    return bool(verification.get("phone"))


def verify_provider_phone_otp(provider_id: str, store_path: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    now = _now_iso()
    if _should_use_sql_store(store_path, _default_provider_store_path):
        provider = get_provider_profile(provider_id, store_path)
        if provider is None:
            return None
        provider = _normalize_provider_trust(provider)
        verification = provider.get("verification") if isinstance(provider.get("verification"), dict) else {}
        verification["phone"] = True
        verification["reviewedAt"] = now
        verification["reviewedBy"] = "otp"
        verification["reviewNote"] = "Verified via Telegram OTP"
        provider["verificationStatus"] = "verified"
        provider["verification"] = verification
        provider["trustedBadges"] = _verification_badges("verified", "provider")
        provider["profileUpdatedAt"] = now
        provider["updatedAt"] = now
        persisted = sql_upsert_provider(dict(provider))
        persisted.pop("stale", None)
        return dict(persisted)

    providers = load_providers(store_path)
    updated: Optional[Dict[str, Any]] = None
    for index, provider in enumerate(providers):
        if str(provider.get("id")) != str(provider_id):
            continue
        provider = _normalize_provider_trust(provider)
        verification = provider.get("verification") if isinstance(provider.get("verification"), dict) else {}
        verification["phone"] = True
        verification["reviewedAt"] = now
        verification["reviewedBy"] = "otp"
        verification["reviewNote"] = "Verified via Telegram OTP"
        provider["verificationStatus"] = "verified"
        provider["verification"] = verification
        provider["trustedBadges"] = _verification_badges("verified", "provider")
        provider["profileUpdatedAt"] = now
        provider["updatedAt"] = now
        providers[index] = provider
        updated = provider
        break
    if updated is None:
        return None
    save_providers(providers, store_path)
    return dict(updated)



def _default_customer_profile(customer_id: str, timestamp: str | None = None) -> Dict[str, Any]:
    now = timestamp or _now_iso()
    return {
        "id": str(customer_id),
        "name": "Клієнт POMICH",
        "phone": "",
        "email": "",
        "telegram": "",
        "city": "",
        "vehicle": "",
        "avatarUrl": "",
        "bio": "",
        "preferredRole": "",
        "linkedProviderId": "",
        "rolesRegistered": [],
        "rating": 5.0,
        "ordersCompleted": 0,
        "verificationStatus": "unverified",
        "verification": {
            "phone": False,
            "email": False,
            "telegram": False,
            "identityDocument": False,
            "profilePhoto": False,
            "trustedContacts": False,
            "submittedAt": None,
            "reviewedAt": None,
            "reviewedBy": None,
            "reviewNote": "",
        },
        "trustedBadges": _verification_badges("unverified", "customer"),
        "createdAt": now,
        "updatedAt": now,
    }


def _customer_profile_completeness(profile: Dict[str, Any]) -> int:
    checks = [
        bool(str(profile.get("name") or "").strip()),
        bool(str(profile.get("phone") or "").strip()),
        bool(str(profile.get("email") or "").strip()),
        bool(str(profile.get("city") or "").strip()),
        bool(str(profile.get("telegram") or "").strip()),
    ]
    return round(sum(1 for item in checks if item) / len(checks) * 100)


def _normalize_customer_profile(profile: Dict[str, Any]) -> Dict[str, Any]:
    payload = {**_default_customer_profile(str(profile.get("id") or "customer-web")), **profile}
    status = normalize_verification_status(payload.get("verificationStatus"), "unverified")
    existing = payload.get("verification") if isinstance(payload.get("verification"), dict) else {}
    payload["verificationStatus"] = status
    payload["verification"] = {**_default_customer_profile(str(payload.get("id"))).get("verification", {}), **existing}
    payload["trustedBadges"] = payload.get("trustedBadges") if isinstance(payload.get("trustedBadges"), list) else _verification_badges(status, "customer")
    payload["profileCompleteness"] = _customer_profile_completeness(payload)
    roles = payload.get("rolesRegistered")
    payload["rolesRegistered"] = [str(item).strip() for item in roles if str(item).strip()] if isinstance(roles, list) else []
    payload["preferredRole"] = str(payload.get("preferredRole") or "").strip()
    payload["linkedProviderId"] = str(payload.get("linkedProviderId") or "").strip()
    bot_kind = str(payload.get("telegramBotKind") or "").strip()
    payload["telegramBotKind"] = bot_kind if bot_kind in {"customer", "provider"} else ""
    channel = str(payload.get("telegramNotificationChannel") or payload.get("telegramBotKind") or "").strip()
    payload["telegramNotificationChannel"] = channel if channel in {"customer", "provider"} else ""
    return payload


def normalize_service(value: Any) -> str:
    service = str(value or "").strip().lower()
    aliases = {
        "tow_truck": "tow",
        "towtruck": "tow",
        "battery_start": "battery",
        "wheel_help": "wheel",
        "fuel_delivery": "fuel",
        "mobile_mechanic": "mechanic",
    }
    return aliases.get(service, service)


def _valid_point(value: Any) -> Optional[Dict[str, float]]:
    if not isinstance(value, dict):
        return None
    try:
        lat = float(value.get("lat"))
        lng = float(value.get("lng"))
    except (TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return None
    return {"lat": lat, "lng": lng}


def haversine_distance_km(left: Dict[str, float], right: Dict[str, float]) -> float:
    earth_radius_km = 6371.0
    lat1 = math.radians(left["lat"])
    lat2 = math.radians(right["lat"])
    delta_lat = math.radians(right["lat"] - left["lat"])
    delta_lng = math.radians(right["lng"] - left["lng"])

    a = math.sin(delta_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lng / 2) ** 2
    return 2 * earth_radius_km * math.atan2(math.sqrt(a), math.sqrt(1 - a))


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
    now = _now_iso()
    return [
        _normalize_provider_trust({
            "id": "provider-oleksandr",
            "name": "Олександр",
            "rating": 4.9,
            "vehicle": "Volkswagen Transporter",
            "plate": "AO 1248 CH",
            "phone": "+380671112233",
            "telegram": "pomich_help_bot",
            "status": "online",
            "etaMinutes": 12,
            "location": {"lat": 48.632, "lng": 22.271},
            "specialties": ["tow", "battery", "wheel"],
            "serviceRadiusKm": 15,
            "registeredAt": now,
            "profileUpdatedAt": now,
            "lastSeenAt": now,
            "lastLocationAt": now,
            "updatedAt": now,
        }, "verified"),
        _normalize_provider_trust({
            "id": "provider-mykhailo",
            "name": "Михайло",
            "rating": 4.8,
            "vehicle": "Renault Master",
            "plate": "AO 4207 KM",
            "phone": "+380672224455",
            "telegram": "pomich_help_bot",
            "status": "online",
            "etaMinutes": 18,
            "location": {"lat": 48.612, "lng": 22.303},
            "specialties": ["mechanic", "lockout", "fuel"],
            "serviceRadiusKm": 8,
            "registeredAt": now,
            "profileUpdatedAt": now,
            "lastSeenAt": now,
            "lastLocationAt": now,
            "updatedAt": now,
        }, "verified"),
        _normalize_provider_trust({
            "id": "provider-taras",
            "name": "Тарас",
            "rating": 4.7,
            "vehicle": "Mercedes Sprinter",
            "plate": "AO 7719 BK",
            "phone": "+380673334455",
            "telegram": "pomich_help_bot",
            "status": "offline",
            "etaMinutes": 24,
            "location": {"lat": 48.625, "lng": 22.325},
            "specialties": ["tow", "mechanic"],
            "serviceRadiusKm": 10,
            "registeredAt": now,
            "profileUpdatedAt": now,
            "lastSeenAt": now,
            "lastLocationAt": now,
            "updatedAt": now,
        }, "verified"),
    ]


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
        orders = load_orders(path)
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
        orders.append(payload)
        _write_json_atomic(path, orders)
        return payload


def resolve_provider_telegram_user_id(provider_id: str, provider_store_path: Optional[Path] = None, customer_store_path: Optional[Path] = None) -> Optional[str]:
    normalized_provider_id = str(provider_id or "").strip()
    if not normalized_provider_id:
        return None

    if normalized_provider_id.startswith("provider-tg-"):
        return normalized_provider_id[len("provider-tg-"):]
    if normalized_provider_id.startswith("provider-"):
        suffix = normalized_provider_id[len("provider-"):]
        if suffix.startswith("tg-"):
            return suffix[3:]
        if suffix.isdigit():
            return suffix

    provider = get_provider_profile(normalized_provider_id, provider_store_path)
    if provider:
        direct_id = str(provider.get("telegramUserId") or provider.get("telegramChatId") or "").strip()
        if direct_id.isdigit():
            return direct_id

    for profile in load_customer_profiles(customer_store_path):
        if str(profile.get("linkedProviderId") or "").strip() != normalized_provider_id:
            continue
        customer_id = str(profile.get("id") or "").strip()
        if customer_id.startswith("tg-"):
            return customer_id[3:]
        verification = profile.get("verification") if isinstance(profile.get("verification"), dict) else {}
        telegram_user_id = str(verification.get("telegramUserId") or "").strip()
        if telegram_user_id:
            return telegram_user_id
    return None


def partner_provider_ids_for_order(
    order_id: str,
    order: Optional[Dict[str, Any]] = None,
    offer_store_path: Optional[Path] = None,
) -> List[str]:
    payload = order if isinstance(order, dict) else get_order(order_id)
    provider_ids: set[str] = set()
    if payload:
        assigned_provider_id = str(payload.get("assignedProviderId") or payload.get("partnerId") or "").strip()
        if assigned_provider_id:
            provider_ids.add(assigned_provider_id)

    for offer in load_offers(offer_store_path):
        if str(offer.get("orderId")) != str(order_id):
            continue
        if offer.get("status") not in {"pending", "accepted"}:
            continue
        provider_id = str(offer.get("providerId") or "").strip()
        if provider_id:
            provider_ids.add(provider_id)
    return sorted(provider_ids)


def partner_telegram_user_ids_for_order(
    order_id: str,
    order: Optional[Dict[str, Any]] = None,
    provider_store_path: Optional[Path] = None,
    customer_store_path: Optional[Path] = None,
    offer_store_path: Optional[Path] = None,
) -> List[str]:
    telegram_ids: List[str] = []
    seen: set[str] = set()
    for provider_id in partner_provider_ids_for_order(order_id, order, offer_store_path):
        telegram_user_id = resolve_provider_telegram_user_id(provider_id, provider_store_path, customer_store_path)
        if not telegram_user_id or telegram_user_id in seen:
            continue
        seen.add(telegram_user_id)
        telegram_ids.append(telegram_user_id)
    return telegram_ids


def enrich_order_for_client(
    order: Dict[str, Any],
    provider_store_path: Optional[Path] = None,
    customer_store_path: Optional[Path] = None,
) -> Dict[str, Any]:
    payload = dict(order)
    try:
        payload["status"] = normalize_order_status(payload.get("status"))
    except ValueError:
        payload["status"] = "searching"

    provider_id = str(payload.get("assignedProviderId") or payload.get("partnerId") or "").strip()
    assigned_provider = dict(payload.get("assignedProvider")) if isinstance(payload.get("assignedProvider"), dict) else {}

    if provider_id:
        provider = get_provider_profile(provider_id, provider_store_path)
        if provider:
            live_location = _valid_point(provider.get("location")) or _valid_point(assigned_provider.get("location"))
            pickup = _valid_point(payload.get("customerCoordinates"))
            distance_km = assigned_provider.get("distanceKm")
            eta_minutes = assigned_provider.get("etaMinutes") or provider.get("etaMinutes")
            if live_location and pickup:
                distance_km = round(haversine_distance_km(live_location, pickup), 2)
                eta_minutes = max(1, math.ceil(float(distance_km) * 4))
            assigned_provider = {
                "id": provider.get("id") or assigned_provider.get("id"),
                "name": provider.get("name") or assigned_provider.get("name"),
                "rating": provider.get("rating") if provider.get("rating") is not None else assigned_provider.get("rating"),
                "vehicle": provider.get("vehicle") or assigned_provider.get("vehicle"),
                "plate": provider.get("plate") or assigned_provider.get("plate"),
                "phone": provider.get("phone") or assigned_provider.get("phone"),
                "telegram": provider.get("telegram") or assigned_provider.get("telegram"),
                "location": live_location,
                "verificationStatus": provider.get("verificationStatus") or assigned_provider.get("verificationStatus"),
                "trustedBadges": provider.get("trustedBadges") or assigned_provider.get("trustedBadges"),
                "distanceKm": distance_km,
                "etaMinutes": eta_minutes,
            }

    if assigned_provider:
        payload["assignedProvider"] = assigned_provider
        if assigned_provider.get("name"):
            payload["providerName"] = assigned_provider.get("name")
        if assigned_provider.get("etaMinutes") is not None:
            payload["etaMinutes"] = assigned_provider.get("etaMinutes")

    if payload.get("partnerProposedPrice") is None and payload.get("proposedPrice") is not None:
        payload["partnerProposedPrice"] = payload.get("proposedPrice")

    if payload.get("status") == "accepted":
        payload["acceptedIdleTimeoutSeconds"] = ACCEPTED_IDLE_TIMEOUT_SECONDS
        accepted_at = _order_accepted_at(payload)
        if accepted_at is not None:
            expires_at = accepted_at + timedelta(seconds=ACCEPTED_IDLE_TIMEOUT_SECONDS)
            payload["acceptedIdleExpiresAt"] = f"{expires_at.isoformat(timespec='seconds')}Z"

    customer_id = str(payload.get("customerId") or "").strip()
    if customer_id and not str(payload.get("customerName") or "").strip():
        try:
            customer = get_customer_profile(customer_id, customer_store_path)
            name = str(customer.get("name") or customer.get("displayName") or "").strip()
            if name:
                payload["customerName"] = name
        except Exception:
            pass

    return payload


def get_order(order_id: str, store_path: Optional[Path] = None, provider_store_path: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    if _should_use_sql_store(store_path, _default_store_path):
        found = sql_get_order(str(order_id))
        if found is None:
            return None
        return enrich_order_for_client(found, provider_store_path)
    for order in load_orders(store_path):
        if str(order.get("id")) == str(order_id):
            return enrich_order_for_client(order, provider_store_path)
    return None


def update_order_status(
    order_id: str,
    status: str,
    store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
    offer_store_path: Optional[Path] = None,
) -> Optional[Dict[str, Any]]:
    with STORE_LOCK:
        now = _now_iso()
        next_status = normalize_order_status(status)
        use_sql = _should_use_sql_store(store_path, _default_store_path)

        if use_sql:
            order = sql_get_order(str(order_id))
            if order is None:
                return None
            current_status = normalize_order_status(order.get("status"))
            if next_status == current_status:
                return enrich_order_for_client(order, provider_store_path)
            if next_status not in ORDER_TRANSITIONS[current_status]:
                raise InvalidStatusTransition(current_status, next_status)

            order["status"] = next_status
            order["updatedAt"] = now
            history = order.get("statusHistory")
            if not isinstance(history, list):
                history = []
            history.append({"status": next_status, "at": now})
            order["statusHistory"] = history
            _append_order_event(order, f"ORDER_{next_status.upper()}", now)
            sql_upsert_order(order)
            updated_order = order
        else:
            path = store_path or _default_store_path()
            orders = load_orders(path)
            updated_order = None

            for order in orders:
                if str(order.get("id")) != str(order_id):
                    continue
                current_status = normalize_order_status(order.get("status"))
                if next_status == current_status:
                    updated_order = order
                    break
                if next_status not in ORDER_TRANSITIONS[current_status]:
                    raise InvalidStatusTransition(current_status, next_status)

                order["status"] = next_status
                order["updatedAt"] = now
                history = order.get("statusHistory")
                if not isinstance(history, list):
                    history = []
                history.append({"status": next_status, "at": now})
                order["statusHistory"] = history
                _append_order_event(order, f"ORDER_{next_status.upper()}", now)
                updated_order = order
                break

            if updated_order is None:
                return None

            _write_json_atomic(path, orders)

        if next_status == "cancelled":
            invalidate_order_offers(order_id, "cancelled", offer_store_path)
            if updated_order.get("assignedProviderId"):
                _set_provider_status(str(updated_order.get("assignedProviderId")), "online", provider_store_path=provider_store_path)
        elif next_status == "completed":
            invalidate_order_offers(order_id, "lost", offer_store_path)
            if updated_order.get("assignedProviderId"):
                provider_id = str(updated_order.get("assignedProviderId"))
                _set_provider_status(provider_id, "online", provider_store_path=provider_store_path)
                _increment_provider_orders_completed(provider_id, provider_store_path=provider_store_path)
                customer_id = str(updated_order.get("customerId") or "").strip()
                if customer_id:
                    _increment_customer_orders_completed(customer_id)
        if updated_order is not None:
            updated_order = enrich_order_for_client(updated_order, provider_store_path)
        return updated_order


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
    """Merge directory providers by id; keep dispatch partners unchanged."""
    with STORE_LOCK:
        path = store_path or _default_provider_store_path()
        existing = load_providers(path)
        by_id = {str(provider.get("id")): provider for provider in existing if provider.get("id")}
        added = 0
        updated = 0
        for raw in incoming:
            payload = _normalize_provider_trust(dict(raw), "verified")
            payload["providerKind"] = "directory"
            payload.setdefault("city", "Ужгород")
            provider_id = str(payload.get("id") or "").strip()
            if not provider_id:
                continue
            if provider_id in by_id:
                previous = by_id[provider_id]
                payload["registeredAt"] = previous.get("registeredAt") or payload.get("registeredAt")
                updated += 1
            else:
                added += 1
            by_id[provider_id] = payload
        merged = list(by_id.values())
        save_providers(merged, path)
        return {"added": added, "updated": updated, "total": len(merged), "directory": sum(1 for item in merged if item.get("providerKind") == "directory")}


def nearby_searching_orders(
    lat: float,
    lng: float,
    *,
    radius_km: float = 20.0,
    service: Optional[str] = None,
    order_store_path: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    pickup = _valid_point({"lat": lat, "lng": lng})
    if pickup is None:
        return []
    normalized_service = normalize_service(service) if service else None
    results: List[Dict[str, Any]] = []
    for order in load_orders(order_store_path):
        if not is_map_request_order(order):
            continue
        order_service = normalize_service(order.get("service"))
        if normalized_service and order_service != normalized_service:
            continue
        order_point = _valid_point(order.get("customerCoordinates"))
        if order_point is None:
            continue
        distance = haversine_distance_km(pickup, order_point)
        if distance > radius_km:
            continue
        payload = {
            "id": order.get("id"),
            "service": order_service,
            "status": peek_order_status(order.get("status")) or "searching",
            "customerLocation": order.get("customerLocation"),
            "vehicleState": order.get("vehicleState"),
            "customerComment": order.get("customerComment"),
            "customerCoordinates": order_point,
            "distanceKm": round(distance, 2),
            "createdAt": order.get("createdAt"),
            "etaMinutes": max(2, math.ceil(distance * 4)),
        }
        results.append(payload)
    return sorted(results, key=lambda item: item.get("distanceKm") or 0)


def load_providers(store_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    if _should_use_sql_store(store_path, _default_provider_store_path):
        found, data = load_collection("providers")
        if not found:
            return apply_provider_presence_ttl(_default_providers())
        providers = data if isinstance(data, list) else _default_providers()
        return apply_provider_presence_ttl([_normalize_provider_trust(provider, "verified") for provider in providers])

    path = store_path or _default_provider_store_path()
    if not path.exists():
        return apply_provider_presence_ttl(_default_providers())
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
            providers = data if isinstance(data, list) else _default_providers()
            return apply_provider_presence_ttl([_normalize_provider_trust(provider, "verified") for provider in providers])
    except json.JSONDecodeError:
        return apply_provider_presence_ttl(_default_providers())


def save_providers(providers: List[Dict[str, Any]], store_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    with STORE_LOCK:
        path = store_path or _default_provider_store_path()
        cleaned_providers = []
        for provider in providers:
            payload = _normalize_provider_trust(provider)
            payload.pop("stale", None)
            cleaned_providers.append(payload)
        _write_json_atomic(path, cleaned_providers)
        return cleaned_providers


def get_provider_profile(provider_id: str, store_path: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    if _should_use_sql_store(store_path, _default_provider_store_path):
        from bot.runtime_store import sql_get_provider

        found = sql_get_provider(str(provider_id))
        if found is None:
            return None
        payload = apply_provider_presence_ttl([_normalize_provider_trust(found)])[0]
        payload.pop("stale", None)
        return payload

    for provider in load_providers(store_path):
        if str(provider.get("id")) == str(provider_id):
            payload = _normalize_provider_trust(provider)
            payload.pop("stale", None)
            return payload
    return None


def build_empty_provider_profile_shell(provider_id: str, store_path: Optional[Path] = None) -> Dict[str, Any]:
    """Minimal provider row for linked partners who have not saved a profile yet."""
    customer_store_path = store_path if store_path and store_path.name.lower() == "customers.json" else None
    customer_id = resolve_customer_id_for_provider(provider_id, customer_store_path)
    if not customer_id and str(provider_id).startswith("provider-"):
        customer_id = str(provider_id)[len("provider-") :].strip()
    customer = get_customer_profile(customer_id, customer_store_path) if customer_id else None
    name = str(customer.get("name") or "").strip() if customer else ""
    phone = str(customer.get("phone") or "").strip() if customer else ""
    city = str(customer.get("city") or "").strip() if customer else ""
    verification_status = (
        normalize_verification_status(customer.get("verificationStatus"), "unverified") if customer else "unverified"
    )
    verification = {"phone": verification_status == "verified"} if customer else {}
    return _normalize_provider_trust({
        "id": str(provider_id),
        "name": name,
        "phone": phone,
        "vehicle": "",
        "plate": "",
        "city": city,
        "telegram": "pomich_help_bot",
        "status": "offline",
        "verificationStatus": verification_status,
        "verification": verification,
        "etaMinutes": 15,
        "location": {"lat": 48.6208, "lng": 22.2879},
        "specialties": [],
        "serviceRadiusKm": 15,
        "providerKind": "dispatch",
    })


def ensure_linked_provider_profile(
    customer_id: str,
    store_path: Optional[Path] = None,
    customer_store_path: Optional[Path] = None,
) -> Optional[Dict[str, Any]]:
    """Persist a linked partner row from the customer account so Mini App duty/go-online works.

    Returning verified customers often have linkedProviderId but a missing SQL provider row.
    Without a persisted profile, the UI falls into empty registration or a blank map.
    """
    profile = get_customer_profile(customer_id, customer_store_path)
    provider_id = resolve_linked_provider_id(customer_id, profile)
    if not provider_id:
        return None

    existing = get_provider_profile(provider_id, store_path)
    if existing and existing.get("registeredAt"):
        synced = sync_linked_provider_phone_verification_from_customer(provider_id, store_path, customer_store_path)
        return synced or existing

    shell = build_empty_provider_profile_shell(provider_id, customer_store_path or store_path)
    if existing:
        shell = {**shell, **existing, "id": provider_id}
        for key in ("name", "phone", "city"):
            if not str(shell.get(key) or "").strip() and str(existing.get(key) or "").strip():
                shell[key] = existing.get(key)

    name = str(shell.get("name") or "").strip()
    phone = str(shell.get("phone") or "").strip()
    verification = profile.get("verification") if isinstance(profile.get("verification"), dict) else {}
    customer_verified = (
        normalize_verification_status(profile.get("verificationStatus"), "unverified") == "verified"
        or bool(verification.get("phone"))
    )
    roles = [str(item).strip() for item in (profile.get("rolesRegistered") or []) if str(item).strip()]
    returning_partner = "provider" in roles or bool(str(profile.get("linkedProviderId") or "").strip())
    preferred_provider = str(profile.get("preferredRole") or "").strip() == "provider"

    # Promote a verified linked customer into a usable duty profile (defaults for vehicle/services).
    if customer_verified and name and phone and (returning_partner or preferred_provider):
        now = _now_iso()
        if not str(shell.get("vehicle") or "").strip():
            shell["vehicle"] = "Автодопомога"
        specialties = shell.get("specialties") if isinstance(shell.get("specialties"), list) else []
        if not specialties:
            shell["specialties"] = ["tow"]
        shell["registeredAt"] = shell.get("registeredAt") or now
        shell["verificationStatus"] = "verified"
        verification = shell.get("verification") if isinstance(shell.get("verification"), dict) else {}
        shell["verification"] = {**verification, "phone": True}
        shell["profileUpdatedAt"] = now
        shell["updatedAt"] = now

    shell["status"] = "offline"
    shell.pop("stale", None)
    shell = _normalize_provider_trust(shell)

    if _should_use_sql_store(store_path, _default_provider_store_path):
        persisted = sql_upsert_provider(dict(shell))
        persisted.pop("stale", None)
    else:
        providers = load_providers(store_path)
        replaced = False
        for index, provider in enumerate(providers):
            if str(provider.get("id")) != str(provider_id):
                continue
            providers[index] = shell
            replaced = True
            break
        if not replaced:
            providers.append(shell)
        save_providers(providers, store_path)
        persisted = dict(shell)

    if not str(profile.get("linkedProviderId") or "").strip():
        try:
            update_customer_profile(customer_id, {"linkedProviderId": provider_id}, customer_store_path)
        except ValueError:
            pass
    if persisted.get("registeredAt"):
        try:
            mark_user_role_registered(customer_id, "provider", customer_store_path)
        except ValueError:
            pass
    return persisted


def submit_provider_verification(provider_id: str, data: Dict[str, Any], store_path: Optional[Path] = None) -> Dict[str, Any]:
    with STORE_LOCK:
        path = store_path or _default_provider_store_path()
        providers = load_providers(path)
        now = _now_iso()
        updated: Optional[Dict[str, Any]] = None
        documents = data.get("documents") if isinstance(data.get("documents"), dict) else {}

        for index, provider in enumerate(providers):
            if str(provider.get("id")) != str(provider_id):
                continue
            provider.pop("stale", None)
            provider = _normalize_provider_trust(provider)
            verification = provider.get("verification") if isinstance(provider.get("verification"), dict) else {}
            fields = {
                "identityDocument": "identityDocumentRef",
                "driverLicense": "driverLicenseRef",
                "vehicleRegistration": "vehicleRegistrationRef",
                "serviceProof": "serviceProofRef",
                "selfieCheck": "selfieRef",
            }

            for flag_key, ref_key in fields.items():
                ref_value = documents.get(ref_key) or data.get(ref_key)
                if ref_value is not None:
                    verification[ref_key] = str(ref_value).strip()
                verification[flag_key] = bool(verification.get(flag_key) or _truthy_flag(data.get(flag_key)) or _truthy_flag(ref_value))

            if data.get("businessName") is not None:
                verification["businessName"] = str(data.get("businessName") or "").strip()
            if data.get("taxNumber") is not None:
                verification["taxNumber"] = str(data.get("taxNumber") or "").strip()

            verification["backgroundCheck"] = "pending"
            verification["submittedAt"] = now
            verification["reviewedAt"] = None
            verification["reviewedBy"] = None
            verification["reviewNote"] = ""
            provider["verificationStatus"] = "pending"
            provider["verification"] = verification
            provider["trustedBadges"] = _verification_badges("pending", "provider")
            provider["updatedAt"] = now
            providers[index] = provider
            updated = provider
            break

        if updated is None:
            raise ValueError("provider profile not found")

        save_providers(providers, path)
        return dict(updated)


def review_provider_verification(provider_id: str, data: Dict[str, Any], store_path: Optional[Path] = None) -> Dict[str, Any]:
    with STORE_LOCK:
        path = store_path or _default_provider_store_path()
        providers = load_providers(path)
        now = _now_iso()
        status = normalize_verification_status(data.get("status"), "")
        if status not in {"verified", "rejected"}:
            raise ValueError("verification status must be verified or rejected")

        updated: Optional[Dict[str, Any]] = None
        for index, provider in enumerate(providers):
            if str(provider.get("id")) != str(provider_id):
                continue
            provider.pop("stale", None)
            provider = _normalize_provider_trust(provider)
            verification = provider.get("verification") if isinstance(provider.get("verification"), dict) else {}
            verification["reviewedAt"] = now
            verification["reviewedBy"] = str(data.get("reviewedBy") or "dispatcher").strip()
            verification["reviewNote"] = str(data.get("reviewNote") or data.get("note") or "").strip()
            if status == "verified":
                for key in ["identityDocument", "driverLicense", "vehicleRegistration", "serviceProof", "selfieCheck"]:
                    verification[key] = True
                verification["backgroundCheck"] = "passed"
            else:
                verification["backgroundCheck"] = "failed"
                provider["status"] = "offline"
                provider.pop("assignedOrderId", None)

            provider["verificationStatus"] = status
            provider["verification"] = verification
            provider["trustedBadges"] = _verification_badges(status, "provider")
            provider["updatedAt"] = now
            providers[index] = provider
            updated = provider
            break

        if updated is None:
            raise ValueError("provider profile not found")

        save_providers(providers, path)
        return dict(updated)


def _decrypt_customer_record(profile: Dict[str, Any]) -> Dict[str, Any]:
    return _normalize_customer_profile(decrypt_customer_profile(profile))


def _encrypt_customer_record(profile: Dict[str, Any]) -> Dict[str, Any]:
    return encrypt_customer_profile(_normalize_customer_profile(profile))


def load_customer_profiles(store_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    if _should_use_sql_store(store_path, _default_customer_store_path):
        found, data = load_collection("customers")
        return [_decrypt_customer_record(profile) for profile in data] if found and isinstance(data, list) else []

    path = store_path or _default_customer_store_path()
    if not path.exists():
        return []
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
            return [_decrypt_customer_record(profile) for profile in data] if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []


def save_customer_profiles(profiles: List[Dict[str, Any]], store_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    with STORE_LOCK:
        path = store_path or _default_customer_store_path()
        cleaned_profiles = [_encrypt_customer_record(profile) for profile in profiles]
        _write_json_atomic(path, cleaned_profiles)
        return [_decrypt_customer_record(profile) for profile in cleaned_profiles]


def get_customer_profile(customer_id: str, store_path: Optional[Path] = None) -> Dict[str, Any]:
    if _should_use_sql_store(store_path, _default_customer_store_path):
        found = sql_get_customer(str(customer_id))
        if found is not None:
            return _maybe_persist_phone_linked_verification(
                _normalize_customer_profile(_decrypt_customer_record(found)),
                store_path,
            )
        return _sync_phone_linked_verification(_default_customer_profile(customer_id), store_path)

    for profile in load_customer_profiles(store_path):
        if str(profile.get("id")) == str(customer_id):
            return _maybe_persist_phone_linked_verification(_normalize_customer_profile(profile), store_path)
    return _sync_phone_linked_verification(_default_customer_profile(customer_id), store_path)


def update_customer_profile(customer_id: str, data: Dict[str, Any], store_path: Optional[Path] = None) -> Dict[str, Any]:
    with STORE_LOCK:
        path = store_path or _default_customer_store_path()
        profiles = load_customer_profiles(path)
        now = _now_iso()
        updated: Optional[Dict[str, Any]] = None
        if data.get("displayName") and not data.get("name"):
            data = {**data, "name": data.get("displayName")}

        editable_fields = [
            "name",
            "phone",
            "email",
            "telegram",
            "city",
            "vehicle",
            "avatarUrl",
            "bio",
            "preferredRole",
            "linkedProviderId",
            "rolesRegistered",
            "telegramBotKind",
            "telegramNotificationChannel",
        ]
        for index, profile in enumerate(profiles):
            if str(profile.get("id")) != str(customer_id):
                continue
            payload = _normalize_customer_profile(profile)
            previous_phone_digits = _customer_profile_phone_digits(payload)
            for field in editable_fields:
                if data.get(field) is not None:
                    if field == "rolesRegistered" and isinstance(data.get(field), list):
                        payload[field] = [str(item).strip() for item in data.get(field) if str(item).strip()]
                    else:
                        payload[field] = str(data.get(field) or "").strip()
            if data.get("phone") is not None:
                next_phone_digits = _customer_profile_phone_digits(payload)
                if next_phone_digits != previous_phone_digits:
                    _ensure_customer_phone_available(customer_id, str(payload.get("phone") or ""), profiles, path)
            payload["updatedAt"] = now
            payload["profileCompleteness"] = _customer_profile_completeness(payload)
            profiles[index] = payload
            updated = payload
            break

        if updated is None:
            payload = _default_customer_profile(customer_id, now)
            for field in editable_fields:
                if data.get(field) is not None:
                    if field == "rolesRegistered" and isinstance(data.get(field), list):
                        payload[field] = [str(item).strip() for item in data.get(field) if str(item).strip()]
                    else:
                        payload[field] = str(data.get(field) or "").strip()
            if data.get("phone") is not None:
                _ensure_customer_phone_available(customer_id, str(payload.get("phone") or ""), profiles, path)
            payload["profileCompleteness"] = _customer_profile_completeness(payload)
            profiles.append(payload)
            updated = payload

        save_customer_profiles(profiles, path)
        return _maybe_persist_phone_linked_verification(dict(updated), path)


def upsert_telegram_customer_profile(
    user: Dict[str, Any],
    store_path: Optional[Path] = None,
    *,
    bot_kind: str | None = None,
) -> Dict[str, Any]:
    # Links Telegram user to tg-{id} customer row shared by bot and web app.
    telegram_user_id = str(user.get("id") or "").strip()
    if not telegram_user_id:
        raise ValueError("telegram user id missing")

    customer_id = f"tg-{telegram_user_id}"
    normalized_bot_kind = str(bot_kind or "").strip().lower()
    if normalized_bot_kind not in {"customer", "provider"}:
        normalized_bot_kind = ""

    with STORE_LOCK:
        path = store_path or _default_customer_store_path()
        profiles = load_customer_profiles(path)
        now = _now_iso()
        updated: Optional[Dict[str, Any]] = None
        display_name = str(user.get("first_name") or "").strip()
        last_name = str(user.get("last_name") or "").strip()
        if last_name:
            display_name = f"{display_name} {last_name}".strip()

        for index, profile in enumerate(profiles):
            if str(profile.get("id")) != customer_id:
                continue
            payload = _normalize_customer_profile(profile)
            updated = payload
            profiles[index] = payload
            break

        if updated is None:
            updated = _default_customer_profile(customer_id, now)
            profiles.append(updated)

        if display_name:
            updated["name"] = display_name
        if user.get("username"):
            updated["telegram"] = str(user.get("username") or "").strip()

        verification = updated.get("verification") if isinstance(updated.get("verification"), dict) else {}
        verification["telegram"] = True
        verification["telegramUserId"] = telegram_user_id
        verification["telegramVerifiedAt"] = verification.get("telegramVerifiedAt") or now
        updated["verification"] = verification
        updated["customerIdentity"] = {
            "type": "telegram",
            "telegramUserId": telegram_user_id,
            "username": user.get("username"),
            "firstName": user.get("first_name"),
            "lastName": user.get("last_name"),
        }
        if normalized_bot_kind:
            # Same human identity; remember which bot channel was used for notifications.
            updated["telegramBotKind"] = normalized_bot_kind
            updated["telegramNotificationChannel"] = normalized_bot_kind
            if not str(updated.get("preferredRole") or "").strip():
                updated["preferredRole"] = normalized_bot_kind
        updated["updatedAt"] = now
        updated["profileCompleteness"] = _customer_profile_completeness(updated)

        save_customer_profiles(profiles, path)
        return dict(updated)


def _customer_display_name(profile: Dict[str, Any]) -> str:
    name = str(profile.get("name") or "").strip()
    if is_encrypted_value(name):
        name = decrypt_field(name).strip()
    if name and name != "Клієнт POMICH":
        return name
    return ""


def is_guest_customer_id(customer_id: str) -> bool:
    normalized = str(customer_id or "").strip()
    return normalized == "customer-web" or normalized.startswith("guest-")


def is_real_customer_profile(profile: Dict[str, Any]) -> bool:
    customer_id = str(profile.get("id") or "").strip()
    if is_customer_client_registered(profile):
        return True
    if str(profile.get("phone") or "").strip():
        return True
    if customer_id.startswith("tg-"):
        if _customer_display_name(profile) or str(profile.get("telegram") or "").strip():
            return True
    return not is_guest_customer_id(customer_id)


def customer_admin_display_name(profile: Dict[str, Any]) -> str:
    name = _customer_display_name(profile)
    if name:
        return name
    customer_id = str(profile.get("id") or "").strip()
    if customer_id.startswith("tg-"):
        telegram = str(profile.get("telegram") or "").strip().lstrip("@")
        if telegram:
            return f"@{telegram}"
        suffix = customer_id.removeprefix("tg-")
        return f"Telegram {suffix}" if suffix else "Telegram"
    if is_guest_customer_id(customer_id):
        short_id = customer_id.removeprefix("guest-")[:8]
        return f"Гість {short_id}" if short_id else "Гість"
    return customer_id or "Клієнт"


def prepare_customer_profile_for_admin(profile: Dict[str, Any]) -> Dict[str, Any]:
    payload = dict(_decrypt_customer_record(profile))
    payload["clientRegistered"] = is_customer_client_registered(payload)
    payload["isGuestSession"] = is_guest_customer_id(str(payload.get("id") or ""))
    payload["displayName"] = customer_admin_display_name(payload)
    return payload


def list_admin_customer_profiles(
    include_guests: bool = False,
    query: str | None = None,
    store_path: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    clients = [prepare_customer_profile_for_admin(profile) for profile in load_customer_profiles(store_path)]
    if not include_guests:
        clients = [client for client in clients if is_real_customer_profile(client)]
    if query:
        needle = query.strip().lower()
        clients = [
            client
            for client in clients
            if needle in str(client.get("id") or "").lower()
            or needle in str(client.get("displayName") or "").lower()
            or needle in str(client.get("name") or "").lower()
            or needle in str(client.get("phone") or "").lower()
            or needle in str(client.get("email") or "").lower()
            or needle in str(client.get("city") or "").lower()
        ]
    return sorted(clients, key=lambda item: str(item.get("updatedAt") or item.get("createdAt") or ""), reverse=True)


def _profile_is_older_than(profile: Dict[str, Any], threshold: datetime) -> bool:
    raw = str(profile.get("updatedAt") or profile.get("createdAt") or "").strip()
    if not raw:
        return False
    normalized = raw.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(normalized) < threshold
    except ValueError:
        return raw[:19] < threshold.isoformat(timespec="seconds")


def purge_stale_guest_customers(
    days: int = 7,
    store_path: Optional[Path] = None,
    order_store_path: Optional[Path] = None,
) -> Dict[str, Any]:
    threshold = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=max(1, int(days)))
    orders = load_orders(order_store_path)
    customer_ids_with_orders = {
        str(order.get("customerId") or order.get("customer_id") or "").strip()
        for order in orders
        if str(order.get("customerId") or order.get("customer_id") or "").strip()
    }

    with STORE_LOCK:
        path = store_path or _default_customer_store_path()
        profiles = load_customer_profiles(path)
        kept: List[Dict[str, Any]] = []
        removed_ids: List[str] = []
        for profile in profiles:
            customer_id = str(profile.get("id") or "").strip()
            if not is_guest_customer_id(customer_id):
                kept.append(profile)
                continue
            if customer_id in customer_ids_with_orders:
                kept.append(profile)
                continue
            if is_real_customer_profile(profile):
                kept.append(profile)
                continue
            if not _profile_is_older_than(profile, threshold):
                kept.append(profile)
                continue
            removed_ids.append(customer_id)

        save_customer_profiles(kept, path)
        return {"deleted": len(removed_ids), "customerIds": removed_ids, "remaining": len(kept)}


def is_customer_client_registered(profile: Dict[str, Any]) -> bool:
    name = _customer_display_name(profile)
    phone = str(profile.get("phone") or "").strip()
    return bool(name and phone)


def _normalize_ukraine_phone_digits(phone: str) -> str:
    digits = "".join(ch for ch in str(phone or "") if ch.isdigit())
    if digits.startswith("380") and len(digits) == 12:
        return digits
    if digits.startswith("0") and len(digits) == 10:
        return f"380{digits[1:]}"
    if len(digits) == 9:
        return f"380{digits}"
    return digits


def _customer_profile_phone_digits(profile: Dict[str, Any]) -> str:
    phone = str(profile.get("phone") or "").strip()
    if is_encrypted_value(phone):
        phone = decrypt_field(phone).strip()
    return _normalize_ukraine_phone_digits(phone)


def find_telegram_user_id_by_phone(phone: str, store_path: Optional[Path] = None) -> Optional[str]:
    """Resolve Telegram user id from a tg-{id} profile or registered provider with the same phone."""
    target = _normalize_ukraine_phone_digits(phone)
    if not target or len(target) != 12:
        return None
    for profile in load_customer_profiles(store_path):
        customer_id = str(profile.get("id") or "")
        if not customer_id.startswith("tg-"):
            continue
        if _customer_profile_phone_digits(profile) != target:
            continue
        verification = profile.get("verification") if isinstance(profile.get("verification"), dict) else {}
        telegram_user_id = str(verification.get("telegramUserId") or customer_id[3:]).strip()
        return telegram_user_id or None
    # Partner cabinet may hold the working phone while the tg-* row keeps another number.
    provider = find_registered_provider_by_phone(phone)
    if provider:
        return resolve_provider_telegram_user_id(
            str(provider.get("id") or ""),
            customer_store_path=store_path,
        )
    return None


def find_verified_customer_by_phone(
    phone: str,
    *,
    exclude_id: str | None = None,
    store_path: Optional[Path] = None,
) -> Optional[Dict[str, Any]]:
    """Find a verified customer profile with the same phone (prefers tg-* canonical rows)."""
    target = _normalize_ukraine_phone_digits(phone)
    if not target or len(target) != 12:
        return None
    candidates: List[Dict[str, Any]] = []
    for profile in load_customer_profiles(store_path):
        customer_id = str(profile.get("id") or "")
        if exclude_id and customer_id == exclude_id:
            continue
        if _customer_profile_phone_digits(profile) != target:
            continue
        normalized = _normalize_customer_profile(profile)
        if normalize_verification_status(normalized.get("verificationStatus"), "unverified") != "verified":
            continue
        candidates.append(normalized)
    if not candidates:
        return None
    tg_candidates = [item for item in candidates if str(item.get("id") or "").startswith("tg-")]
    return tg_candidates[0] if tg_candidates else candidates[0]


PHONE_ALREADY_REGISTERED = "phone_already_registered"
PHONE_ALREADY_REGISTERED_UA = "Цей номер уже зареєстровано"


def _customer_phone_alias_ids(customer_id: str, profiles: List[Dict[str, Any]]) -> set[str]:
    """All customer rows that share the same phone as this profile (guest/tg duplicates)."""
    needle = str(customer_id or "").strip()
    ids: set[str] = {needle} if needle else set()
    if not needle:
        return ids
    profile = next((item for item in profiles if str(item.get("id") or "") == needle), None)
    if profile is None:
        return ids
    phone_digits = _customer_profile_phone_digits(profile)
    if not phone_digits or len(phone_digits) != 12:
        return ids
    for other in profiles:
        other_id = str(other.get("id") or "").strip()
        if not other_id or other_id in ids:
            continue
        if _customer_profile_phone_digits(other) == phone_digits:
            ids.add(other_id)
    return ids


def find_registered_customer_by_phone(
    phone: str,
    *,
    exclude_id: str | None = None,
    exclude_ids: set[str] | None = None,
    store_path: Optional[Path] = None,
    profiles: Optional[List[Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    """Find a registered customer profile with the same phone (prefers tg-* canonical rows)."""
    target = _normalize_ukraine_phone_digits(phone)
    if not target or len(target) != 12:
        return None
    excluded = set(exclude_ids or [])
    if exclude_id:
        excluded.add(str(exclude_id))

    if profiles is None and _should_use_sql_store(store_path, _default_customer_store_path):
        from bot.phone_lookup import phone_lookup_key

        lookup = phone_lookup_key(target)
        if lookup:
            source = [
                _normalize_customer_profile(_decrypt_customer_record(item))
                for item in sql_customers_by_phone_lookup(lookup)
            ]
        else:
            source = []
    else:
        source = profiles if profiles is not None else load_customer_profiles(store_path)

    candidates: List[Dict[str, Any]] = []
    for profile in source:
        customer_id = str(profile.get("id") or "")
        if customer_id in excluded:
            continue
        if _customer_profile_phone_digits(profile) != target:
            continue
        normalized = _normalize_customer_profile(profile)
        if not is_customer_client_registered(normalized):
            continue
        candidates.append(normalized)
    # Prefer the Telegram owner of a partner cabinet that uses this phone
    # (guest web rows often hold the same number without a chat_id).
    provider = find_registered_provider_by_phone(phone, store_path=store_path)
    if provider is not None:
        telegram_user_id = resolve_provider_telegram_user_id(
            str(provider.get("id") or ""),
            customer_store_path=store_path,
        )
        if telegram_user_id:
            preferred_id = f"tg-{telegram_user_id}"
            if preferred_id not in excluded:
                preferred: Optional[Dict[str, Any]] = None
                if profiles is None and _should_use_sql_store(store_path, _default_customer_store_path):
                    raw = sql_get_customer(preferred_id)
                    if raw is not None:
                        preferred = _normalize_customer_profile(_decrypt_customer_record(raw))
                else:
                    for profile in source:
                        if str(profile.get("id") or "") != preferred_id:
                            continue
                        preferred = _normalize_customer_profile(profile)
                        break
                if preferred is not None:
                    if is_customer_client_registered(preferred) or str(preferred.get("phone") or "").strip():
                        return preferred
        # Web/guest partner: restore the customer row that owns provider-{customerId}.
        linked_customer_id = resolve_customer_id_for_provider(str(provider.get("id") or ""), store_path)
        if linked_customer_id and linked_customer_id not in excluded:
            linked_profile = get_customer_profile(linked_customer_id, store_path)
            if linked_profile is not None:
                return _normalize_customer_profile(linked_profile)
    if not candidates:
        return None
    tg_candidates = [item for item in candidates if str(item.get("id") or "").startswith("tg-")]
    return tg_candidates[0] if tg_candidates else candidates[0]


def resolve_customer_id_for_provider(provider_id: str, store_path: Optional[Path] = None) -> str:
    """Map provider-{customerId} (or linkedProviderId reverse lookup) back to the owning customer."""
    normalized = str(provider_id or "").strip()
    if not normalized:
        return ""
    if normalized.startswith("provider-"):
        suffix = normalized[len("provider-") :].strip()
        if suffix and get_customer_profile(suffix, store_path) is not None:
            return suffix
    for profile in load_customer_profiles(store_path):
        if str(profile.get("linkedProviderId") or "").strip() != normalized:
            continue
        customer_id = str(profile.get("id") or "").strip()
        if customer_id:
            return customer_id
    return ""


def find_registered_provider_by_phone(
    phone: str,
    *,
    exclude_id: str | None = None,
    store_path: Optional[Path] = None,
    providers: Optional[List[Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    """Find another registered provider that already uses this phone."""
    target = _normalize_ukraine_phone_digits(phone)
    if not target or len(target) != 12:
        return None

    if providers is None and _should_use_sql_store(store_path, _default_provider_store_path):
        from bot.phone_lookup import phone_lookup_key

        lookup = phone_lookup_key(target)
        source = sql_providers_by_phone_lookup(lookup) if lookup else []
    else:
        source = providers if providers is not None else load_providers(store_path)

    for provider in source:
        provider_id = str(provider.get("id") or "")
        if exclude_id and provider_id == exclude_id:
            continue
        if not provider.get("registeredAt"):
            continue
        provider_phone = _normalize_ukraine_phone_digits(str(provider.get("phone") or ""))
        if provider_phone != target:
            continue
        name = str(provider.get("name") or "").strip()
        if not name:
            continue
        return dict(provider)
    return None


def _profiles_share_account(
    customer_id_a: str,
    customer_id_b: str,
    profiles: List[Dict[str, Any]],
) -> bool:
    """True when two customer rows represent the same user (guest/tg/provider link)."""
    left = str(customer_id_a or "").strip()
    right = str(customer_id_b or "").strip()
    if not left or not right:
        return False
    if left == right:
        return True
    if right in _customer_phone_alias_ids(left, profiles):
        return True
    if left in _customer_phone_alias_ids(right, profiles):
        return True
    left_profile = next((item for item in profiles if str(item.get("id") or "") == left), None)
    right_profile = next((item for item in profiles if str(item.get("id") or "") == right), None)
    left_provider = resolve_linked_provider_id(left, left_profile)
    right_provider = resolve_linked_provider_id(right, right_profile)
    if left_provider and right_provider and left_provider == right_provider:
        return True
    if left_provider and right == resolve_customer_id_for_provider(left_provider):
        return True
    if right_provider and left == resolve_customer_id_for_provider(right_provider):
        return True
    return False


def _customer_phone_exclude_ids(
    customer_id: str,
    phone: str,
    profiles: List[Dict[str, Any]],
) -> set[str]:
    """Customer rows that may reuse this phone for the same authenticated account."""
    excluded = _customer_phone_alias_ids(customer_id, profiles)
    target = _normalize_ukraine_phone_digits(phone)
    if not target or len(target) != 12:
        return excluded
    for profile in profiles:
        profile_id = str(profile.get("id") or "").strip()
        if not profile_id or profile_id in excluded:
            continue
        if _customer_profile_phone_digits(profile) != target:
            continue
        if _profiles_share_account(profile_id, customer_id, profiles):
            excluded.add(profile_id)
    return excluded


def _companion_provider_store_path(customer_store_path: Optional[Path]) -> Optional[Path]:
    if customer_store_path is None:
        return None
    name = customer_store_path.name.lower()
    if name == "customers.json":
        return customer_store_path.with_name("providers.json")
    return customer_store_path


def _ensure_customer_phone_available(
    customer_id: str,
    phone: str,
    profiles: List[Dict[str, Any]],
    store_path: Optional[Path] = None,
) -> None:
    phone_value = str(phone or "").strip()
    if not phone_value:
        return
    target = _normalize_ukraine_phone_digits(phone_value)
    profile = next((item for item in profiles if str(item.get("id") or "") == str(customer_id)), None)
    linked_provider_id = resolve_linked_provider_id(str(customer_id), profile)
    if not linked_provider_id and str(customer_id).startswith("tg-"):
        linked_provider_id = f"provider-{customer_id}"
    provider_store_path = _companion_provider_store_path(store_path)
    own_provider = get_provider_profile(linked_provider_id, provider_store_path) if linked_provider_id else None
    if own_provider is not None and own_provider.get("registeredAt"):
        own_provider_phone = _normalize_ukraine_phone_digits(str(own_provider.get("phone") or ""))
        if own_provider_phone == target:
            return
    existing = find_registered_customer_by_phone(
        phone_value,
        exclude_ids=_customer_phone_exclude_ids(customer_id, phone_value, profiles),
        profiles=profiles,
        store_path=store_path,
    )
    if existing is not None:
        existing_id = str(existing.get("id") or "")
        if _profiles_share_account(existing_id, customer_id, profiles):
            return
        raise ValueError(PHONE_ALREADY_REGISTERED)


def _ensure_provider_phone_available(
    provider_id: str,
    phone: str,
    providers: Optional[List[Dict[str, Any]]] = None,
    *,
    customer_store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
) -> None:
    phone_value = str(phone or "").strip()
    if not phone_value:
        return
    target = _normalize_ukraine_phone_digits(phone_value)
    customer_id = resolve_customer_id_for_provider(str(provider_id))
    if not customer_id and str(provider_id).startswith("provider-"):
        customer_id = str(provider_id)[len("provider-") :].strip()
    if customer_id:
        customer_profile = get_customer_profile(customer_id, customer_store_path)
        customer_phone = _customer_profile_phone_digits(customer_profile)
        if customer_phone == target:
            return
    existing = find_registered_provider_by_phone(
        phone_value,
        exclude_id=str(provider_id),
        providers=providers,
        store_path=provider_store_path,
    )
    if existing is not None:
        existing_customer_id = resolve_customer_id_for_provider(str(existing.get("id") or ""))
        if customer_id and existing_customer_id:
            profiles = [
                get_customer_profile(customer_id, customer_store_path),
                get_customer_profile(existing_customer_id, customer_store_path),
            ]
            if _profiles_share_account(customer_id, existing_customer_id, profiles):
                return
        raise ValueError(PHONE_ALREADY_REGISTERED)


def sync_linked_provider_phone_verification_from_customer(
    provider_id: str,
    store_path: Optional[Path] = None,
    customer_store_path: Optional[Path] = None,
) -> Optional[Dict[str, Any]]:
    """Mirror verified client phone onto the linked partner cabinet without re-OTP."""
    provider = get_provider_profile(provider_id, store_path)
    if provider is None or is_provider_verified(provider):
        return provider
    customer_id = resolve_customer_id_for_provider(str(provider_id))
    if not customer_id and str(provider_id).startswith("provider-"):
        customer_id = str(provider_id)[len("provider-") :].strip()
    if not customer_id:
        return provider
    profile = get_customer_profile(customer_id, customer_store_path)
    if normalize_verification_status(profile.get("verificationStatus"), "unverified") != "verified":
        return provider
    provider_phone = _normalize_ukraine_phone_digits(str(provider.get("phone") or ""))
    customer_phone = _customer_profile_phone_digits(profile)
    linked_by_id = str(provider_id) == f"provider-{customer_id}" or str(provider.get("id") or "") == f"provider-{customer_id}"
    if provider_phone and customer_phone and provider_phone != customer_phone and not linked_by_id:
        return provider
    return verify_provider_phone_otp(provider_id, store_path)


def _mark_profile_phone_verified(
    profile: Dict[str, Any],
    *,
    source_verification: Optional[Dict[str, Any]] = None,
    linked_provider_id: str = "",
) -> Dict[str, Any]:
    payload = dict(profile)
    existing = payload.get("verification") if isinstance(payload.get("verification"), dict) else {}
    linked_verification = source_verification if isinstance(source_verification, dict) else {}
    merged_verification = {**existing, **linked_verification, "phone": True}
    payload["verification"] = merged_verification
    payload["verificationStatus"] = "verified"
    payload["trustedBadges"] = payload.get("trustedBadges") or _verification_badges("verified", "customer")
    if linked_provider_id and not str(payload.get("linkedProviderId") or "").strip():
        payload["linkedProviderId"] = linked_provider_id
    payload["updatedAt"] = _now_iso()
    return payload


def _sync_phone_linked_verification(
    profile: Dict[str, Any],
    store_path: Optional[Path] = None,
) -> Dict[str, Any]:
    """Inherit verified status from another profile/provider with the same phone or linked cabinet."""
    if normalize_verification_status(profile.get("verificationStatus"), "unverified") == "verified":
        return profile

    customer_id = str(profile.get("id") or "").strip()
    linked_provider_id = str(profile.get("linkedProviderId") or "").strip()
    if not linked_provider_id and customer_id.startswith("tg-"):
        linked_provider_id = f"provider-{customer_id}"
    if linked_provider_id:
        # Provider rows live in the provider store; never reuse the customer store_path here.
        linked_provider = get_provider_profile(linked_provider_id)
        if linked_provider and is_provider_verified(linked_provider):
            return _mark_profile_phone_verified(
                profile,
                source_verification=linked_provider.get("verification")
                if isinstance(linked_provider.get("verification"), dict)
                else None,
                linked_provider_id=linked_provider_id,
            )

    phone = str(profile.get("phone") or "").strip()
    if not phone:
        return profile
    linked = find_verified_customer_by_phone(
        phone,
        exclude_id=customer_id,
        store_path=store_path,
    )
    if linked is not None:
        return _mark_profile_phone_verified(
            profile,
            source_verification=linked.get("verification") if isinstance(linked.get("verification"), dict) else None,
            linked_provider_id=str(linked.get("linkedProviderId") or "").strip(),
        )

    provider = find_registered_provider_by_phone(phone)
    if provider is not None and is_provider_verified(provider):
        return _mark_profile_phone_verified(
            profile,
            source_verification=provider.get("verification") if isinstance(provider.get("verification"), dict) else None,
            linked_provider_id=str(provider.get("id") or "").strip(),
        )
    return profile


def _maybe_persist_phone_linked_verification(
    profile: Dict[str, Any],
    store_path: Optional[Path] = None,
) -> Dict[str, Any]:
    synced = _sync_phone_linked_verification(profile, store_path)
    if normalize_verification_status(synced.get("verificationStatus"), "unverified") == normalize_verification_status(
        profile.get("verificationStatus"), "unverified"
    ):
        return synced
    customer_id = str(profile.get("id") or "")
    if not customer_id:
        return synced
    if _should_use_sql_store(store_path, _default_customer_store_path):
        sql_upsert_customer(_encrypt_customer_record(synced))
        return synced
    with STORE_LOCK:
        path = store_path or _default_customer_store_path()
        profiles = load_customer_profiles(path)
        for index, item in enumerate(profiles):
            if str(item.get("id")) != customer_id:
                continue
            profiles[index] = synced
            save_customer_profiles(profiles, path)
            break
    return synced


def _is_valid_ukraine_mobile_phone(phone: str) -> bool:
    digits = _normalize_ukraine_phone_digits(phone)
    if not digits.startswith("380") or len(digits) != 12:
        return False
    national = digits[3:]
    return len(national) == 9 and national[:2] in {"39", "50", "63", "66", "67", "68", "73", "75", "91", "92", "93", "94", "95", "96", "97", "98", "99"}


def resolve_linked_provider_id(customer_id: str, profile: Dict[str, Any] | None = None) -> str:
    payload = profile or get_customer_profile(customer_id)
    linked = str(payload.get("linkedProviderId") or "").strip()
    if linked:
        return linked
    normalized_customer_id = str(customer_id or "").strip()
    if normalized_customer_id and normalized_customer_id not in {"", "customer-web"}:
        return f"provider-{normalized_customer_id}"
    return ""


def is_provider_profile_complete(provider: Optional[Dict[str, Any]]) -> bool:
    """True when partner has name, phone, vehicle, valid plate, specialties, and registeredAt."""
    if not isinstance(provider, dict):
        return False
    name = str(provider.get("name") or "").strip()
    if not name or name == "Партнер POMICH":
        return False
    phone = str(provider.get("phone") or "").strip()
    vehicle = str(provider.get("vehicle") or "").strip()
    plate = str(provider.get("plate") or "").strip()
    specialties = provider.get("specialties") if isinstance(provider.get("specialties"), list) else []
    specialties = _clean_provider_specialties(specialties)
    return bool(
        provider.get("registeredAt")
        and phone
        and vehicle
        and specialties
        and is_valid_ukraine_plate(plate)
    )


def is_customer_provider_registered(customer_id: str, store_path: Optional[Path] = None) -> bool:
    profile = get_customer_profile(customer_id, store_path)
    provider_id = resolve_linked_provider_id(customer_id, profile)
    if not provider_id:
        return False
    provider = get_provider_profile(provider_id, store_path)
    if provider is None:
        return False
    name = str(provider.get("name") or "").strip()
    phone = str(provider.get("phone") or "").strip()
    vehicle = str(provider.get("vehicle") or "").strip()
    specialties = provider.get("specialties") if isinstance(provider.get("specialties"), list) else []
    specialties = _clean_provider_specialties(specialties)
    # Account-level "has partner role" — presence/go-online still requires is_provider_profile_complete (plate).
    return bool(provider.get("registeredAt") and name and phone and vehicle and specialties)


def build_user_account_status(customer_id: str, store_path: Optional[Path] = None) -> Dict[str, Any]:
    profile = get_customer_profile(customer_id, store_path)
    provider_id = resolve_linked_provider_id(customer_id, profile)
    client_registered = is_customer_client_registered(profile)
    provider_registered = is_customer_provider_registered(customer_id, store_path)
    roles_registered = [role for role in (profile.get("rolesRegistered") or []) if role in {"customer", "provider"}]
    if client_registered and "customer" not in roles_registered:
        roles_registered.append("customer")
    if provider_registered and "provider" not in roles_registered:
        roles_registered.append("provider")
    preferred_role = str(profile.get("preferredRole") or "").strip()
    if preferred_role not in {"customer", "provider"}:
        preferred_role = "customer" if client_registered else ("provider" if provider_registered else "")
    return {
        "customerId": str(customer_id),
        "preferredRole": preferred_role,
        "linkedProviderId": provider_id,
        "rolesRegistered": roles_registered,
        "clientRegistered": client_registered,
        "providerRegistered": provider_registered,
        "needsOnboarding": not client_registered and not provider_registered,
        "profile": profile,
    }


def ensure_customer_client_from_linked_provider(
    customer_id: str,
    store_path: Optional[Path] = None,
) -> Dict[str, Any]:
    """Hydrate customer name/phone from linked partner so role switch does not re-ask registration."""
    profile = get_customer_profile(customer_id, store_path)
    if is_customer_client_registered(profile):
        roles = [str(item).strip() for item in (profile.get("rolesRegistered") or []) if str(item).strip()]
        if "customer" not in roles:
            preferred = str(profile.get("preferredRole") or "").strip()
            patch: Dict[str, Any] = {"rolesRegistered": [*roles, "customer"]}
            if preferred in {"customer", "provider"}:
                patch["preferredRole"] = preferred
            update_customer_profile(customer_id, patch, store_path)
        _maybe_persist_phone_linked_verification(get_customer_profile(customer_id, store_path), store_path)
        return build_user_account_status(customer_id, store_path)

    provider_id = resolve_linked_provider_id(customer_id, profile)
    provider = get_provider_profile(provider_id) if provider_id else None
    if provider is None:
        return build_user_account_status(customer_id, store_path)

    name = str(provider.get("name") or "").strip()
    phone = str(provider.get("phone") or "").strip()
    if not name or not phone:
        return build_user_account_status(customer_id, store_path)

    patch: Dict[str, Any] = {
        "name": name,
        "phone": phone,
        "linkedProviderId": str(provider_id),
    }
    city = str(provider.get("city") or "").strip()
    if city:
        patch["city"] = city
    try:
        update_customer_profile(customer_id, patch, store_path)
        mark_user_role_registered(customer_id, "customer", store_path)
        _maybe_persist_phone_linked_verification(get_customer_profile(customer_id, store_path), store_path)
    except ValueError:
        # Phone conflict on another row — still return current status without failing role switch.
        pass
    return build_user_account_status(customer_id, store_path)


def set_user_preferred_role(customer_id: str, role: str, store_path: Optional[Path] = None) -> Dict[str, Any]:
    normalized_role = str(role or "").strip()
    if normalized_role not in {"customer", "provider"}:
        raise ValueError("preferred role must be customer or provider")
    profile = update_customer_profile(customer_id, {"preferredRole": normalized_role}, store_path)
    if normalized_role == "provider":
        provider_id = resolve_linked_provider_id(customer_id, profile)
        if provider_id and not str(profile.get("linkedProviderId") or "").strip():
            profile = update_customer_profile(customer_id, {"linkedProviderId": provider_id}, store_path)
    elif normalized_role == "customer":
        # Partner → client: reuse partner name/phone instead of empty «Реєстрація клієнта».
        return ensure_customer_client_from_linked_provider(customer_id, store_path)
    return build_user_account_status(customer_id, store_path)


def mark_user_role_registered(customer_id: str, role: str, store_path: Optional[Path] = None) -> Dict[str, Any]:
    normalized_role = str(role or "").strip()
    if normalized_role not in {"customer", "provider"}:
        raise ValueError("role must be customer or provider")
    profile = get_customer_profile(customer_id, store_path)
    roles = [str(item).strip() for item in (profile.get("rolesRegistered") or []) if str(item).strip()]
    if normalized_role not in roles:
        roles.append(normalized_role)
    patch: Dict[str, Any] = {"rolesRegistered": roles, "preferredRole": normalized_role}
    if normalized_role == "provider":
        patch["linkedProviderId"] = resolve_linked_provider_id(customer_id, profile)
    update_customer_profile(customer_id, patch, store_path)
    return build_user_account_status(customer_id, store_path)


def submit_customer_verification(customer_id: str, data: Dict[str, Any], store_path: Optional[Path] = None) -> Dict[str, Any]:
    with STORE_LOCK:
        path = store_path or _default_customer_store_path()
        profiles = load_customer_profiles(path)
        now = _now_iso()
        updated: Optional[Dict[str, Any]] = None
        documents = data.get("documents") if isinstance(data.get("documents"), dict) else {}

        for index, profile in enumerate(profiles):
            if str(profile.get("id")) != str(customer_id):
                continue
            payload = _normalize_customer_profile(profile)
            verification = payload.get("verification") if isinstance(payload.get("verification"), dict) else {}
            for key in ["phone", "email", "telegram", "identityDocument", "profilePhoto", "trustedContacts"]:
                ref_value = documents.get(f"{key}Ref") or data.get(f"{key}Ref")
                if ref_value is not None:
                    verification[f"{key}Ref"] = str(ref_value).strip()
                verification[key] = bool(verification.get(key) or _truthy_flag(data.get(key)) or _truthy_flag(ref_value))

            verification["submittedAt"] = now
            verification["reviewedAt"] = None
            verification["reviewedBy"] = None
            verification["reviewNote"] = ""
            payload["verificationStatus"] = "pending"
            payload["verification"] = verification
            payload["trustedBadges"] = _verification_badges("pending", "customer")
            payload["updatedAt"] = now
            payload["profileCompleteness"] = _customer_profile_completeness(payload)
            profiles[index] = payload
            updated = payload
            break

        if updated is None:
            profiles.append(_default_customer_profile(customer_id, now))
            save_customer_profiles(profiles, path)
            return submit_customer_verification(customer_id, data, path)

        save_customer_profiles(profiles, path)
        return dict(updated)


def review_customer_verification(customer_id: str, data: Dict[str, Any], store_path: Optional[Path] = None) -> Dict[str, Any]:
    with STORE_LOCK:
        path = store_path or _default_customer_store_path()
        profiles = load_customer_profiles(path)
        now = _now_iso()
        status = normalize_verification_status(data.get("status"), "")
        if status not in {"verified", "rejected"}:
            raise ValueError("verification status must be verified or rejected")

        updated: Optional[Dict[str, Any]] = None
        for index, profile in enumerate(profiles):
            if str(profile.get("id")) != str(customer_id):
                continue
            payload = _normalize_customer_profile(profile)
            verification = payload.get("verification") if isinstance(payload.get("verification"), dict) else {}
            verification["reviewedAt"] = now
            verification["reviewedBy"] = str(data.get("reviewedBy") or "dispatcher").strip()
            verification["reviewNote"] = str(data.get("reviewNote") or data.get("note") or "").strip()
            if status == "verified":
                verification["phone"] = True
                verification["identityDocument"] = True
            payload["verificationStatus"] = status
            payload["verification"] = verification
            payload["trustedBadges"] = _verification_badges(status, "customer")
            payload["updatedAt"] = now
            payload["profileCompleteness"] = _customer_profile_completeness(payload)
            profiles[index] = payload
            updated = payload
            break

        if updated is None:
            raise ValueError("customer profile not found")

        save_customer_profiles(profiles, path)
        return dict(updated)


def update_provider_profile(provider_id: str, data: Dict[str, Any], store_path: Optional[Path] = None) -> Dict[str, Any]:
    now = _now_iso()
    specialties = _clean_provider_specialties(data.get("specialties"))
    if not specialties:
        raise ValueError("provider specialties must include at least one supported service")

    try:
        radius = int(data.get("serviceRadiusKm") or 15)
    except (TypeError, ValueError):
        radius = 15
    radius = max(1, min(radius, 100))

    use_sql = _should_use_sql_store(store_path, _default_provider_store_path)
    existing = get_provider_profile(provider_id, store_path) if use_sql else None
    providers: Optional[List[Dict[str, Any]]] = None if use_sql else load_providers(store_path)

    updated: Optional[Dict[str, Any]] = None
    if not use_sql and providers is not None:
        for index, provider in enumerate(providers):
            if str(provider.get("id")) != str(provider_id):
                continue

            provider.pop("stale", None)
            provider = _normalize_provider_trust(provider)
            provider["name"] = str(data.get("name") or provider.get("name") or "Партнер POMICH").strip()
            next_phone = str(data.get("phone") or provider.get("phone") or "").strip()
            _ensure_provider_phone_available(
                provider_id,
                next_phone,
                providers,
                provider_store_path=store_path,
            )
            provider["phone"] = next_phone
            provider["telegram"] = str(data.get("telegram") or provider.get("telegram") or "pomich_help_bot").strip()
            provider["vehicle"] = str(data.get("vehicle") or provider.get("vehicle") or "Автодопомога").strip()
            if data.get("vehicleMake") is not None:
                provider["vehicleMake"] = str(data.get("vehicleMake") or "").strip()
            if data.get("vehicleModel") is not None:
                provider["vehicleModel"] = str(data.get("vehicleModel") or "").strip()
            provider["plate"] = str(data.get("plate") or provider.get("plate") or "").strip()
            if data.get("city") is not None:
                provider["city"] = str(data.get("city") or provider.get("city") or "").strip()
            provider["specialties"] = specialties
            provider["serviceRadiusKm"] = radius
            provider["registeredAt"] = provider.get("registeredAt") or now
            provider["profileUpdatedAt"] = now
            provider["updatedAt"] = now
            if isinstance(data.get("location"), dict):
                provider["location"] = data["location"]
                provider["lastLocationAt"] = now
            providers[index] = provider
            updated = provider
            break

    if updated is None and existing is not None:
        provider = dict(existing)
        provider.pop("stale", None)
        provider = _normalize_provider_trust(provider)
        provider["name"] = str(data.get("name") or provider.get("name") or "Партнер POMICH").strip()
        next_phone = str(data.get("phone") or provider.get("phone") or "").strip()
        _ensure_provider_phone_available(
            provider_id,
            next_phone,
            provider_store_path=store_path,
        )
        provider["phone"] = next_phone
        provider["telegram"] = str(data.get("telegram") or provider.get("telegram") or "pomich_help_bot").strip()
        provider["vehicle"] = str(data.get("vehicle") or provider.get("vehicle") or "Автодопомога").strip()
        if data.get("vehicleMake") is not None:
            provider["vehicleMake"] = str(data.get("vehicleMake") or "").strip()
        if data.get("vehicleModel") is not None:
            provider["vehicleModel"] = str(data.get("vehicleModel") or "").strip()
        provider["plate"] = normalize_ukraine_plate(str(data.get("plate") or provider.get("plate") or "").strip())
        if data.get("city") is not None:
            provider["city"] = str(data.get("city") or provider.get("city") or "").strip()
        provider["specialties"] = specialties
        provider["serviceRadiusKm"] = radius
        provider["registeredAt"] = provider.get("registeredAt") or now
        provider["profileUpdatedAt"] = now
        provider["updatedAt"] = now
        if isinstance(data.get("location"), dict):
            provider["location"] = data["location"]
            provider["lastLocationAt"] = now
        updated = provider

    if updated is None:
        status = str(data.get("status") or "offline")
        if status not in PROVIDER_STATUSES:
            raise ValueError("provider status must be online, busy or offline")
        if status in PROVIDER_ACTIVE_STATUSES and not data.get("registeredAt"):
            raise ValueError("provider profile must be registered before going online")
        next_phone = str(data.get("phone") or "").strip()
        _ensure_provider_phone_available(
            provider_id,
            next_phone,
            providers,
            provider_store_path=store_path,
        )
        updated = _normalize_provider_trust({
            "id": str(provider_id),
            "name": str(data.get("name") or "Партнер POMICH").strip(),
            "rating": data.get("rating") or 4.8,
            "vehicle": str(data.get("vehicle") or "Автодопомога").strip(),
            "plate": normalize_ukraine_plate(str(data.get("plate") or "").strip()),
            "city": str(data.get("city") or "Ужгород").strip(),
            "phone": next_phone,
            "telegram": str(data.get("telegram") or "pomich_help_bot").strip(),
            "status": "offline",
            "etaMinutes": data.get("etaMinutes") or 15,
            "location": data.get("location") or {"lat": 48.6208, "lng": 22.2879},
            "specialties": specialties,
            "serviceRadiusKm": radius,
            "registeredAt": now,
            "profileUpdatedAt": now,
            "lastLocationAt": now if data.get("location") else None,
            "updatedAt": now,
        })
        if providers is not None:
            providers.append(updated)

    if use_sql:
        persisted = sql_upsert_provider(dict(updated))
        persisted.pop("stale", None)
        updated = _normalize_provider_trust(persisted)
    else:
        assert providers is not None
        save_providers(providers, store_path)

    customer_id = resolve_customer_id_for_provider(str(provider_id))
    if not customer_id and str(provider_id).startswith("provider-"):
        candidate = str(provider_id)[len("provider-") :].strip()
        if candidate:
            customer_id = candidate
    if customer_id and updated is not None:
        try:
            if _should_use_sql_store(None, _default_customer_store_path):
                existing_customer = sql_get_customer(str(customer_id)) or _default_customer_profile(customer_id)
                payload = _normalize_customer_profile(_decrypt_customer_record(existing_customer))
                payload["linkedProviderId"] = str(provider_id)
                payload["preferredRole"] = "provider"
                if updated.get("name"):
                    payload["name"] = updated.get("name")
                if updated.get("phone"):
                    payload["phone"] = updated.get("phone")
                if updated.get("city"):
                    payload["city"] = updated.get("city")
                roles = [str(item).strip() for item in (payload.get("rolesRegistered") or []) if str(item).strip()]
                if "provider" not in roles:
                    roles.append("provider")
                if is_customer_client_registered(payload) and "customer" not in roles:
                    roles.append("customer")
                payload["rolesRegistered"] = roles
                payload["profileCompleteness"] = _customer_profile_completeness(payload)
                payload["updatedAt"] = _now_iso()
                sql_upsert_customer(_encrypt_customer_record(payload))
            else:
                patch: Dict[str, Any] = {
                    "linkedProviderId": str(provider_id),
                    "preferredRole": "provider",
                }
                if updated.get("name"):
                    patch["name"] = updated.get("name")
                if updated.get("phone"):
                    patch["phone"] = updated.get("phone")
                if updated.get("city"):
                    patch["city"] = updated.get("city")
                update_customer_profile(customer_id, patch)
                mark_user_role_registered(customer_id, "provider")
                synced_profile = get_customer_profile(customer_id)
                if is_customer_client_registered(synced_profile):
                    roles = [str(item).strip() for item in (synced_profile.get("rolesRegistered") or []) if str(item).strip()]
                    if "customer" not in roles:
                        update_customer_profile(
                            customer_id,
                            {"rolesRegistered": [*roles, "customer"], "preferredRole": "provider"},
                        )
        except Exception:
            pass

    try:
        synced = sync_linked_provider_phone_verification_from_customer(str(provider_id), store_path)
    except Exception:
        synced = None
    return dict(synced or updated)


def update_provider_presence(provider_id: str, data: Dict[str, Any], store_path: Optional[Path] = None) -> Dict[str, Any]:
    status = str(data.get("status") or "").strip()
    if status in PROVIDER_ACTIVE_STATUSES:
        # Linked Mini App partners often hit presence before a SQL row is fully promoted.
        customer_id = resolve_customer_id_for_provider(str(provider_id))
        if not customer_id and str(provider_id).startswith("provider-"):
            customer_id = str(provider_id)[len("provider-") :].strip()
        if customer_id:
            try:
                ensure_linked_provider_profile(customer_id, store_path)
            except Exception:
                pass
        sync_linked_provider_phone_verification_from_customer(str(provider_id), store_path)
    providers = load_providers(store_path)
    now = _now_iso()
    updated: Optional[Dict[str, Any]] = None

    for index, provider in enumerate(providers):
        if str(provider.get("id")) != str(provider_id):
            continue
        provider.pop("stale", None)
        provider = _normalize_provider_trust(provider)
        status = str(data.get("status") or provider.get("status") or "offline")
        if status not in PROVIDER_STATUSES:
            raise ValueError("provider status must be online, busy or offline")
        if status in PROVIDER_ACTIVE_STATUSES and not provider.get("registeredAt"):
            raise ValueError("provider profile must be registered before going online")
        if status in PROVIDER_ACTIVE_STATUSES and not is_provider_profile_complete(provider):
            raise ValueError("provider profile must be complete before going online")
        if status in PROVIDER_ACTIVE_STATUSES and not is_provider_verified(provider):
            raise ValueError("provider verification must be approved before going online")
        if provider.get("assignedOrderId") and status == "online":
            status = "busy"
        provider["status"] = status
        provider["updatedAt"] = now
        provider["lastSeenAt"] = now
        if isinstance(data.get("location"), dict):
            provider["location"] = data["location"]
            provider["lastLocationAt"] = now
        if data.get("etaMinutes") is not None:
            provider["etaMinutes"] = data["etaMinutes"]
        providers[index] = provider
        updated = provider
        break

    if updated is None:
        status = str(data.get("status") or "offline")
        if status not in PROVIDER_STATUSES:
            raise ValueError("provider status must be online, busy or offline")
        if status in PROVIDER_ACTIVE_STATUSES and not data.get("registeredAt"):
            raise ValueError("provider profile must be registered before going online")
        candidate = _normalize_provider_trust({
            "id": str(provider_id),
            "name": data.get("name") or "Партнер POMICH",
            "rating": data.get("rating") or 4.8,
            "vehicle": data.get("vehicle") or "Автодопомога",
            "plate": data.get("plate") or "",
            "phone": data.get("phone") or "",
            "telegram": data.get("telegram") or "pomich_help_bot",
            "status": status,
            "etaMinutes": data.get("etaMinutes") or 15,
            "location": data.get("location") or {"lat": 48.6208, "lng": 22.2879},
            "specialties": data.get("specialties") or ["tow", "mechanic"],
            "serviceRadiusKm": data.get("serviceRadiusKm") or 15,
            "lastSeenAt": now,
            "lastLocationAt": now if data.get("location") else None,
            "updatedAt": now,
            "registeredAt": data.get("registeredAt"),
        })
        if status in PROVIDER_ACTIVE_STATUSES and not is_provider_profile_complete(candidate):
            raise ValueError("provider profile must be complete before going online")
        if status in PROVIDER_ACTIVE_STATUSES and not is_provider_verified(candidate):
            raise ValueError("provider verification must be approved before going online")
        updated = candidate
        providers.append(updated)

    if _should_use_sql_store(store_path, _default_provider_store_path):
        persisted = sql_upsert_provider(dict(updated))
        persisted.pop("stale", None)
        if persisted.get("status") == "online":
            redispatch_searching_orders_for_provider(
                provider_id,
                provider_store_path=store_path,
            )
        return persisted

    save_providers(providers, store_path)
    updated.pop("stale", None)
    if updated.get("status") == "online":
        redispatch_searching_orders_for_provider(
            provider_id,
            provider_store_path=store_path,
        )
    return updated


def _pending_offer_count_for_order(offers: List[Dict[str, Any]], order_id: str) -> int:
    return sum(
        1
        for offer in offers
        if str(offer.get("orderId")) == str(order_id) and offer.get("status") == "pending"
    )


def _try_offer_order_to_provider(
    order: Dict[str, Any],
    provider: Dict[str, Any],
    offers: List[Dict[str, Any]],
    now: Optional[datetime] = None,
) -> bool:
    """Create a pending offer for one eligible provider. Returns True when a new offer is added."""
    order_id = str(order.get("id"))
    provider_id = str(provider.get("id"))
    if peek_order_status(order.get("status")) != "searching":
        return False
    if order.get("assignedProviderId"):
        return False
    if _provider_should_skip_order(offers, provider_id, order_id):
        return False
    if _pending_offer_count_for_order(offers, order_id) >= MAX_PROVIDER_OFFERS:
        return False

    service = normalize_service(order.get("service"))
    specialties = _clean_provider_specialties(provider.get("specialties"))
    if service not in specialties:
        return False

    pickup = _valid_point(order.get("customerCoordinates"))
    location = _valid_point(provider.get("location"))
    if pickup is None or location is None:
        return False

    checked_at = now or datetime.now(timezone.utc).replace(tzinfo=None)
    if provider.get("status") != "online":
        return False
    if not is_provider_verified(provider):
        return False
    if provider.get("assignedOrderId"):
        return False
    if provider.get("stale") or not _provider_is_recent(provider, checked_at):
        return False

    distance = haversine_distance_km(pickup, location)
    radius_km = float(provider.get("serviceRadiusKm") or 15)
    if distance > radius_km:
        return False

    now_iso = f"{checked_at.isoformat(timespec='seconds')}Z"
    expires_at = f"{(checked_at + timedelta(seconds=OFFER_TIMEOUT_SECONDS)).isoformat(timespec='seconds')}Z"
    offer = {
        "id": f"OF-{uuid.uuid4().hex[:12].upper()}",
        "orderId": order_id,
        "providerId": provider_id,
        "status": "pending",
        "distanceKm": round(distance, 2),
        "createdAt": now_iso,
        "expiresAt": expires_at,
    }
    offers.append(offer)
    _append_order_event(
        order,
        "OFFER_CREATED",
        now_iso,
        {"offerId": offer["id"], "providerId": provider_id, "distanceKm": offer["distanceKm"], "source": "redispatch"},
    )

    dispatch_info = order.get("dispatchInfo") if isinstance(order.get("dispatchInfo"), dict) else {}
    order["dispatchState"] = "OFFERS_SENT"
    order["dispatchInfo"] = {
        **dispatch_info,
        "eligibleProviders": max(int(dispatch_info.get("eligibleProviders") or 0), 1),
        "offersSent": _pending_offer_count_for_order(offers, order_id),
        "searchRadiusStepsKm": DISPATCH_SEARCH_RADIUS_STEPS_KM,
        "maxProviderOffers": MAX_PROVIDER_OFFERS,
        "offerTimeoutSeconds": OFFER_TIMEOUT_SECONDS,
        "lastDispatchAt": now_iso,
    }
    order["updatedAt"] = now_iso
    return True


def redispatch_searching_orders_for_provider(
    provider_id: str,
    order_store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
    offer_store_path: Optional[Path] = None,
) -> List[str]:
    """Offer nearby searching orders directly to a provider who is online. Returns order IDs with new offers."""
    provider = get_provider_profile(provider_id, provider_store_path)
    if provider is None or provider.get("status") != "online":
        return []
    if not is_provider_verified(provider):
        return []
    if not _valid_point(provider.get("location")):
        return []

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    with STORE_LOCK:
        order_path = order_store_path or _default_store_path()
        offer_path = offer_store_path or _default_offer_store_path()
        orders = load_orders(order_path)
        offers = load_offers(offer_path)
        _expire_offers_in_memory(offers, orders, now)

        created_order_ids: List[str] = []
        for order in orders:
            if peek_order_status(order.get("status")) != "searching":
                continue
            if _try_offer_order_to_provider(order, provider, offers, now):
                created_order_ids.append(str(order.get("id")))

        if created_order_ids:
            _write_json_atomic(order_path, orders)
            save_offers(offers, offer_path)

        return created_order_ids


def _offer_error_for_status(status: str) -> DispatchConflict:
    if status == "expired":
        return DispatchConflict("OFFER_EXPIRED", "Offer has expired.")
    if status == "declined":
        return DispatchConflict("OFFER_DECLINED", "Offer has already been declined.")
    return DispatchConflict("ORDER_ALREADY_ACCEPTED", "Order has already been accepted by another provider.")


# Providers blocked from receiving another offer for the same order (expired may be re-offered).
DISPATCH_BLOCK_REOFFER_STATUSES = {"pending", "declined", "lost", "accepted", "cancelled"}


def _providers_blocked_for_order(offers: List[Dict[str, Any]], order_id: str) -> set[str]:
    return {
        str(offer.get("providerId"))
        for offer in offers
        if str(offer.get("orderId")) == str(order_id) and offer.get("status") in DISPATCH_BLOCK_REOFFER_STATUSES
    }


def _provider_should_skip_order(offers: List[Dict[str, Any]], provider_id: str, order_id: str) -> bool:
    for offer in offers:
        if str(offer.get("orderId")) != str(order_id):
            continue
        if str(offer.get("providerId")) != str(provider_id):
            continue
        status = offer.get("status")
        if status in {"pending", "declined", "lost", "accepted", "cancelled"}:
            return True
    return False


def _expire_offers_in_memory(offers: List[Dict[str, Any]], orders: List[Dict[str, Any]], now: Optional[datetime] = None) -> bool:
    checked_at = now or datetime.now(timezone.utc).replace(tzinfo=None)
    now_iso = f"{checked_at.isoformat(timespec='seconds')}Z"
    order_by_id = {str(order.get("id")): order for order in orders}
    changed = False

    for offer in offers:
        if offer.get("status") != "pending":
            continue

        order = order_by_id.get(str(offer.get("orderId")))
        order_status = peek_order_status(order.get("status")) if order else "cancelled"
        expires_at = _parse_iso(offer.get("expiresAt"))

        if order_status in {None, "cancelled"} or order_status in TERMINAL_ORDER_STATUSES:
            offer["status"] = "cancelled" if order_status != "completed" else "lost"
            offer["respondedAt"] = now_iso
            changed = True
        elif order_status != "searching":
            offer["status"] = "lost"
            offer["respondedAt"] = now_iso
            changed = True
        elif expires_at and checked_at >= expires_at:
            offer["status"] = "expired"
            offer["respondedAt"] = now_iso
            if order:
                _append_order_event(order, "OFFER_EXPIRED", now_iso, {"offerId": offer.get("id"), "providerId": offer.get("providerId")})
            changed = True

    return changed


def _cancel_idle_accepted_orders_in_memory(
    orders: List[Dict[str, Any]],
    offers: List[Dict[str, Any]],
    now: Optional[datetime] = None,
) -> List[Dict[str, Any]]:
    """Cancel accepted orders idle longer than ACCEPTED_IDLE_TIMEOUT_SECONDS. Mutates orders/offers."""
    checked_at = now or datetime.now(timezone.utc).replace(tzinfo=None)
    now_iso = f"{checked_at.isoformat(timespec='seconds')}Z"
    timeout = timedelta(seconds=ACCEPTED_IDLE_TIMEOUT_SECONDS)
    cancelled: List[Dict[str, Any]] = []

    for order in orders:
        if peek_order_status(order.get("status")) != "accepted":
            continue
        accepted_at = _order_accepted_at(order)
        if accepted_at is None or checked_at - accepted_at < timeout:
            continue

        order["status"] = "cancelled"
        order["cancelReason"] = "accepted_idle_timeout"
        order["cancelledAt"] = now_iso
        order["updatedAt"] = now_iso
        order["dispatchState"] = "CANCELLED"
        history = order.get("statusHistory") if isinstance(order.get("statusHistory"), list) else []
        history.append({"status": "cancelled", "at": now_iso, "reason": "accepted_idle_timeout"})
        order["statusHistory"] = history
        _append_order_event(
            order,
            "ORDER_ACCEPTED_TIMEOUT",
            now_iso,
            {"timeoutSeconds": ACCEPTED_IDLE_TIMEOUT_SECONDS, "acceptedAt": order.get("acceptedAt")},
        )
        _append_order_event(order, "ORDER_CANCELLED", now_iso, {"reason": "accepted_idle_timeout"})
        cancelled.append(order)

        order_id = str(order.get("id") or "")
        for offer in offers:
            if str(offer.get("orderId")) != order_id:
                continue
            if offer.get("status") != "pending":
                continue
            offer["status"] = "cancelled"
            offer["respondedAt"] = now_iso

    return cancelled


def _free_providers_after_idle_cancel(
    cancelled_orders: List[Dict[str, Any]],
    provider_store_path: Optional[Path] = None,
) -> bool:
    if not cancelled_orders:
        return False
    providers = load_providers(provider_store_path)
    now = _now_iso()
    changed = False
    provider_ids = {
        str(order.get("assignedProviderId") or order.get("partnerId") or "").strip()
        for order in cancelled_orders
    }
    provider_ids.discard("")
    for provider in providers:
        if str(provider.get("id") or "") not in provider_ids:
            continue
        provider.pop("stale", None)
        provider["status"] = "online"
        provider["assignedOrderId"] = None
        provider["updatedAt"] = now
        provider["lastSeenAt"] = now
        changed = True
    if changed:
        save_providers(providers, provider_store_path)
    return changed


MAX_DISPATCH_AUTO_RETRIES = 2


def expire_stale_dispatch(
    order_store_path: Optional[Path] = None,
    offer_store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    """Expire pending offers and cancel idle accepted orders. Returns cancelled (enriched) orders."""
    retry_order_ids: List[str] = []
    with STORE_LOCK:
        order_path = order_store_path or _default_store_path()
        offer_path = offer_store_path or _default_offer_store_path()
        orders = load_orders(order_path)
        offers = load_offers(offer_path)
        offer_changed = _expire_offers_in_memory(offers, orders)
        cancelled = _cancel_idle_accepted_orders_in_memory(orders, offers)
        exhaustion_changed = False
        now_iso = _now_iso()
        for order in orders:
            if peek_order_status(order.get("status")) != "searching":
                continue
            order_id = str(order.get("id") or "")
            if not order_id:
                continue
            related = [offer for offer in offers if str(offer.get("orderId")) == order_id]
            if not related:
                continue
            if any(offer.get("status") == "pending" for offer in related):
                continue
            info = order.get("dispatchInfo") if isinstance(order.get("dispatchInfo"), dict) else {}
            auto_retries = int(info.get("autoRetryCount") or 0)
            if auto_retries >= MAX_DISPATCH_AUTO_RETRIES:
                if order.get("dispatchState") != "NO_PROVIDERS_AVAILABLE":
                    order["dispatchState"] = "NO_PROVIDERS_AVAILABLE"
                    order["updatedAt"] = now_iso
                    order["dispatchInfo"] = {
                        **info,
                        "autoRetryCount": auto_retries,
                        "exhaustedAt": now_iso,
                    }
                    _append_order_event(
                        order,
                        "OFFERS_EXHAUSTED",
                        now_iso,
                        {"autoRetryCount": auto_retries},
                    )
                    exhaustion_changed = True
                continue
            last_auto = _parse_iso(info.get("lastAutoRetryAt"))
            checked_at = datetime.now(timezone.utc).replace(tzinfo=None)
            if last_auto and (checked_at - last_auto).total_seconds() < 8:
                continue
            order["dispatchInfo"] = {**info, "autoRetryCount": auto_retries + 1, "lastAutoRetryAt": now_iso}
            order["updatedAt"] = now_iso
            _append_order_event(
                order,
                "DISPATCH_AUTO_RETRY",
                now_iso,
                {"autoRetryCount": auto_retries + 1},
            )
            exhaustion_changed = True
            retry_order_ids.append(order_id)
        if offer_changed or cancelled or exhaustion_changed:
            save_offers(offers, offer_path)
            _write_json_atomic(order_path, orders)
        if cancelled:
            _free_providers_after_idle_cancel(cancelled, provider_store_path)

    for order_id in retry_order_ids:
        try:
            dispatch_order(
                order_id,
                order_store_path=order_store_path,
                provider_store_path=provider_store_path,
                offer_store_path=offer_store_path,
            )
        except Exception:
            continue

    return [enrich_order_for_client(order, provider_store_path) for order in cancelled]


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
    expire_stale_dispatch(order_store_path=order_store_path, offer_store_path=offer_store_path)
    return load_offers(offer_store_path)

def invalidate_order_offers(order_id: str, status: str = "cancelled", offer_store_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    with STORE_LOCK:
        offers = load_offers(offer_store_path)
        now = _now_iso()
        changed = False
        for offer in offers:
            if str(offer.get("orderId")) == str(order_id) and offer.get("status") == "pending":
                offer["status"] = "cancelled" if status == "cancelled" else "lost"
                offer["respondedAt"] = now
                changed = True
        if changed:
            save_offers(offers, offer_store_path)
        return offers


def _set_provider_status(provider_id: str, status: str, assigned_order_id: Optional[str] = None, provider_store_path: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    now = _now_iso()
    use_sql = _should_use_sql_store(provider_store_path, _default_provider_store_path)

    if use_sql:
        provider = get_provider_profile(provider_id, provider_store_path)
        if provider is None:
            return None
        provider.pop("stale", None)
        provider["status"] = status
        provider["updatedAt"] = now
        provider["lastSeenAt"] = now
        if assigned_order_id:
            provider["assignedOrderId"] = assigned_order_id
        else:
            provider.pop("assignedOrderId", None)
        return sql_upsert_provider(dict(provider))

    providers = load_providers(provider_store_path)
    updated: Optional[Dict[str, Any]] = None

    for provider in providers:
        if str(provider.get("id")) != str(provider_id):
            continue
        provider.pop("stale", None)
        provider["status"] = status
        provider["updatedAt"] = now
        provider["lastSeenAt"] = now
        if assigned_order_id:
            provider["assignedOrderId"] = assigned_order_id
        else:
            provider.pop("assignedOrderId", None)
        updated = provider
        break

    if updated is not None:
        save_providers(providers, provider_store_path)
    return updated


def _provider_is_recent(provider: Dict[str, Any], now: Optional[datetime] = None) -> bool:
    checked_at = now or datetime.now(timezone.utc).replace(tzinfo=None)
    last_seen = _parse_iso(provider.get("lastSeenAt") or provider.get("updatedAt"))
    last_location_at = _parse_iso(provider.get("lastLocationAt") or provider.get("lastSeenAt") or provider.get("updatedAt"))
    if not last_seen or checked_at - last_seen > timedelta(seconds=PROVIDER_PRESENCE_TTL_SECONDS):
        return False
    if not last_location_at or checked_at - last_location_at > timedelta(seconds=PROVIDER_PRESENCE_TTL_SECONDS):
        return False
    return True


def eligible_providers_for_order(
    order: Dict[str, Any],
    providers: Optional[List[Dict[str, Any]]] = None,
    already_offered_provider_ids: Optional[set[str]] = None,
    now: Optional[datetime] = None,
) -> List[Dict[str, Any]]:
    service = normalize_service(order.get("service"))
    pickup = _valid_point(order.get("customerCoordinates"))
    if service not in PROVIDER_SPECIALTIES or pickup is None:
        return []

    offered_ids = already_offered_provider_ids or set()
    checked_at = now or datetime.now(timezone.utc).replace(tzinfo=None)
    candidates: List[Dict[str, Any]] = []

    for provider in providers if providers is not None else load_providers():
        provider_id = str(provider.get("id"))
        location = _valid_point(provider.get("location"))
        specialties = _clean_provider_specialties(provider.get("specialties"))
        if provider_id in offered_ids:
            continue
        if provider.get("status") != "online":
            continue
        if not is_provider_verified(provider):
            continue
        if provider.get("stale") or not _provider_is_recent(provider, checked_at):
            continue
        if provider.get("assignedOrderId"):
            continue
        if service not in specialties:
            continue
        if location is None:
            continue

        distance = haversine_distance_km(pickup, location)
        provider_radius = float(provider.get("serviceRadiusKm") or 15)
        if distance > provider_radius:
            continue

        candidate = dict(provider)
        candidate["distanceKm"] = round(distance, 2)
        candidates.append(candidate)

    return sorted(candidates, key=lambda provider: provider["distanceKm"])


def _public_offer_payload(offer: Dict[str, Any], order: Dict[str, Any]) -> Dict[str, Any]:
    customer_coordinates = order.get("customerCoordinates")
    if not isinstance(customer_coordinates, dict):
        customer_coordinates = None
    return {
        **offer,
        "orderStatus": normalize_order_status(order.get("status")),
        "service": normalize_service(order.get("service")),
        "vehicleState": order.get("vehicleState"),
        "approximateLocation": order.get("customerLocation"),
        "customerComment": order.get("customerComment"),
        "customerCoordinates": customer_coordinates,
        "etaMinutes": max(2, math.ceil(float(offer.get("distanceKm") or 0) * 4)),
    }


def dispatch_order(
    order_id: str,
    order_store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
    offer_store_path: Optional[Path] = None,
    *,
    reset_auto_retry: bool = False,
) -> Optional[Dict[str, Any]]:
    with STORE_LOCK:
        order_path = order_store_path or _default_store_path()
        offer_path = offer_store_path or _default_offer_store_path()
        provider_path = provider_store_path or _default_provider_store_path()
        orders = load_orders(order_path)
        offers = load_offers(offer_path)
        providers = load_providers(provider_path)
        _expire_offers_in_memory(offers, orders)

        order = next((item for item in orders if str(item.get("id")) == str(order_id)), None)
        if order is None:
            return None
        if normalize_order_status(order.get("status")) != "searching":
            return attach_dispatch_to_order(order, offers)

        if reset_auto_retry:
            prev_info = order.get("dispatchInfo") if isinstance(order.get("dispatchInfo"), dict) else {}
            order["dispatchInfo"] = {
                **prev_info,
                "autoRetryCount": 0,
            }
            order["dispatchInfo"].pop("exhaustedAt", None)
            order["dispatchInfo"].pop("lastAutoRetryAt", None)

        now = datetime.now(timezone.utc).replace(tzinfo=None)
        now_iso = f"{now.isoformat(timespec='seconds')}Z"
        offered_ids = _providers_blocked_for_order(offers, order_id)
        if _should_use_sql_runtime(order_store_path, provider_store_path, offer_store_path):
            candidates = sql_candidate_providers_for_order(
                order_id=str(order_id),
                service=normalize_service(order.get("service")),
                already_offered_provider_ids=offered_ids,
                max_radius_km=max(DISPATCH_SEARCH_RADIUS_STEPS_KM),
                ttl_seconds=PROVIDER_PRESENCE_TTL_SECONDS,
                now=now,
            )
        else:
            candidates = eligible_providers_for_order(order, providers, offered_ids, now)
        selected: List[Dict[str, Any]] = []
        used_ids: set[str] = set()
        selected_radius: Optional[int] = None

        _append_order_event(order, "DISPATCH_STARTED", now_iso)
        for radius in DISPATCH_SEARCH_RADIUS_STEPS_KM:
            for candidate in candidates:
                if candidate["id"] in used_ids or candidate["distanceKm"] > radius:
                    continue
                selected.append(candidate)
                used_ids.add(candidate["id"])
                selected_radius = radius
                if len(selected) >= MAX_PROVIDER_OFFERS:
                    break
            if len(selected) >= MAX_PROVIDER_OFFERS:
                break

        if not selected:
            pending_existing = _pending_offer_count_for_order(offers, order_id)
            prev_info = order.get("dispatchInfo") if isinstance(order.get("dispatchInfo"), dict) else {}
            if pending_existing > 0:
                # Another concurrent retry already sent offers — keep OFFERS_SENT.
                order["dispatchState"] = "OFFERS_SENT"
                order["dispatchInfo"] = {
                    **prev_info,
                    "eligibleProviders": len(candidates),
                    "offersSent": max(int(prev_info.get("offersSent") or 0), pending_existing),
                    "lastDispatchAt": now_iso,
                }
                order["updatedAt"] = now_iso
                _write_json_atomic(order_path, orders)
                save_offers(offers, offer_path)
                return attach_dispatch_to_order(order, offers)
            order["dispatchState"] = "NO_PROVIDERS_AVAILABLE"
            order["dispatchInfo"] = {
                "eligibleProviders": len(candidates),
                "offersSent": 0,
                "searchRadiusStepsKm": DISPATCH_SEARCH_RADIUS_STEPS_KM,
                "lastDispatchAt": now_iso,
                **{
                    key: prev_info[key]
                    for key in ("autoRetryCount", "lastAutoRetryAt", "exhaustedAt")
                    if key in prev_info
                },
            }
            order["updatedAt"] = now_iso
            _append_order_event(order, "NO_PROVIDERS_AVAILABLE", now_iso)
            _write_json_atomic(order_path, orders)
            save_offers(offers, offer_path)
            return attach_dispatch_to_order(order, offers)

        expires_at = f"{(now + timedelta(seconds=OFFER_TIMEOUT_SECONDS)).isoformat(timespec='seconds')}Z"
        for candidate in selected:
            offer = {
                "id": f"OF-{uuid.uuid4().hex[:12].upper()}",
                "orderId": order_id,
                "providerId": candidate["id"],
                "status": "pending",
                "distanceKm": candidate["distanceKm"],
                "createdAt": now_iso,
                "expiresAt": expires_at,
            }
            offers.append(offer)
            _append_order_event(order, "OFFER_CREATED", now_iso, {"offerId": offer["id"], "providerId": candidate["id"], "distanceKm": candidate["distanceKm"]})

        order["dispatchState"] = "OFFERS_SENT"
        prev_info = order.get("dispatchInfo") if isinstance(order.get("dispatchInfo"), dict) else {}
        order["dispatchInfo"] = {
            "eligibleProviders": len(candidates),
            "offersSent": len(selected),
            "searchRadiusKm": selected_radius,
            "searchRadiusStepsKm": DISPATCH_SEARCH_RADIUS_STEPS_KM,
            "maxProviderOffers": MAX_PROVIDER_OFFERS,
            "offerTimeoutSeconds": OFFER_TIMEOUT_SECONDS,
            "lastDispatchAt": now_iso,
            **{
                key: prev_info[key]
                for key in ("autoRetryCount", "lastAutoRetryAt", "exhaustedAt")
                if key in prev_info
            },
        }
        order["updatedAt"] = now_iso
        _write_json_atomic(order_path, orders)
        save_offers(offers, offer_path)
        return attach_dispatch_to_order(order, offers)


def attach_dispatch_to_order(order: Dict[str, Any], offers: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    payload = enrich_order_for_client(order)
    if offers is not None:
        related_offers = [dict(offer) for offer in offers if str(offer.get("orderId")) == str(order.get("id"))]
    elif _should_use_sql_store(None, _default_offer_store_path):
        related_offers = [dict(offer) for offer in sql_offers_for_order(str(order.get("id") or ""))]
    else:
        related_offers = [dict(offer) for offer in load_offers() if str(offer.get("orderId")) == str(order.get("id"))]
    payload["offers"] = related_offers
    return payload


def attach_dispatch_to_orders(orders: List[Dict[str, Any]], offers: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
    active_offers = offers if offers is not None else load_offers()
    return [attach_dispatch_to_order(order, active_offers) for order in orders]


def get_provider_offers(
    provider_id: str,
    order_store_path: Optional[Path] = None,
    offer_store_path: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    # Always expire before listing — do not use throttled expire_stale_and_notify here,
    # or recently-expired offers stay visible between throttle windows.
    expire_stale_dispatch(order_store_path=order_store_path, offer_store_path=offer_store_path)
    if _should_use_sql_runtime(order_store_path, None, offer_store_path):
        provider_offers = []
        for offer in sql_pending_offers_for_provider(str(provider_id)):
            order = offer.get("order") if isinstance(offer.get("order"), dict) else None
            if not isinstance(order, dict):
                continue
            bare = {key: value for key, value in offer.items() if key != "order"}
            provider_offers.append(_public_offer_payload(bare, order))
        return sorted(provider_offers, key=lambda item: item.get("createdAt") or "")

    with STORE_LOCK:
        orders = load_orders(order_store_path)
        offers = load_offers(offer_store_path)

        order_by_id = {str(order.get("id")): order for order in orders}
        provider_offers = []
        for offer in offers:
            if str(offer.get("providerId")) != str(provider_id) or offer.get("status") != "pending":
                continue
            order = order_by_id.get(str(offer.get("orderId")))
            if not order:
                continue
            if peek_order_status(order.get("status")) != "searching":
                continue
            if order.get("assignedProviderId"):
                continue
            provider_offers.append(_public_offer_payload(offer, order))

        return sorted(provider_offers, key=lambda offer: offer.get("createdAt") or "")


def accept_offer(
    offer_id: str,
    provider_id: str,
    order_store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
    offer_store_path: Optional[Path] = None,
    proposed_price: Optional[float] = None,
    price_note: Optional[str] = None,
) -> Dict[str, Any]:
    price_value = _normalize_proposed_price(proposed_price)
    if price_value is None:
        raise DispatchConflict("PRICE_REQUIRED", "Partner must specify proposed price when accepting.")
    note_value = str(price_note or "").strip() or None

    if _should_use_sql_runtime(order_store_path, provider_store_path, offer_store_path):
        try:
            return sql_accept_offer(str(offer_id), str(provider_id), proposed_price=price_value, price_note=note_value)
        except SqlDispatchConflict as exc:
            raise DispatchConflict(exc.code, exc.message) from exc

    with STORE_LOCK:
        order_path = order_store_path or _default_store_path()
        provider_path = provider_store_path or _default_provider_store_path()
        offer_path = offer_store_path or _default_offer_store_path()
        orders = load_orders(order_path)
        providers = load_providers(provider_path)
        offers = load_offers(offer_path)
        _expire_offers_in_memory(offers, orders)

        offer = next((item for item in offers if str(item.get("id")) == str(offer_id)), None)
        if offer is None or str(offer.get("providerId")) != str(provider_id):
            raise DispatchConflict("OFFER_NOT_FOUND", "Offer was not found.")
        if offer.get("status") != "pending":
            save_offers(offers, offer_path)
            _write_json_atomic(order_path, orders)
            raise _offer_error_for_status(str(offer.get("status")))

        order = next((item for item in orders if str(item.get("id")) == str(offer.get("orderId"))), None)
        if order is None:
            offer["status"] = "lost"
            offer["respondedAt"] = _now_iso()
            save_offers(offers, offer_path)
            raise DispatchConflict("ORDER_NOT_FOUND", "Order was not found.")

        now = _now_iso()
        if normalize_order_status(order.get("status")) != "searching":
            offer["status"] = "lost"
            offer["respondedAt"] = now
            save_offers(offers, offer_path)
            raise DispatchConflict("ORDER_ALREADY_ACCEPTED", "Order has already been accepted by another provider.")

        provider = next((item for item in providers if str(item.get("id")) == str(provider_id)), None)
        if provider is None:
            raise DispatchConflict("PROVIDER_NOT_FOUND", "Provider was not found.")
        if not is_provider_verified(provider):
            raise DispatchConflict("PROVIDER_NOT_VERIFIED", "Provider verification is not approved.")

        offer["status"] = "accepted"
        offer["respondedAt"] = now
        for other_offer in offers:
            if other_offer is offer:
                continue
            if str(other_offer.get("orderId")) == str(order.get("id")) and other_offer.get("status") == "pending":
                other_offer["status"] = "lost"
                other_offer["respondedAt"] = now

        order["status"] = "accepted"
        order["assignedProviderId"] = provider_id
        order["partnerId"] = provider_id
        order["assignedOfferId"] = offer_id
        order["partnerProposedPrice"] = price_value
        order["partnerPriceNote"] = note_value
        order["acceptedAt"] = now
        order["assignedProvider"] = {
            "id": provider.get("id"),
            "name": provider.get("name"),
            "rating": provider.get("rating"),
            "vehicle": provider.get("vehicle"),
            "plate": provider.get("plate"),
            "phone": provider.get("phone"),
            "telegram": provider.get("telegram"),
            "location": provider.get("location"),
            "verificationStatus": provider.get("verificationStatus"),
            "trustedBadges": provider.get("trustedBadges"),
            "distanceKm": offer.get("distanceKm"),
            "etaMinutes": max(2, math.ceil(float(offer.get("distanceKm") or 0) * 4)),
        }
        if provider.get("name"):
            order["providerName"] = provider.get("name")
        order["dispatchState"] = "ACCEPTED"
        order["updatedAt"] = now
        history = order.get("statusHistory") if isinstance(order.get("statusHistory"), list) else []
        history.append({"status": "accepted", "at": now})
        order["statusHistory"] = history
        _append_order_event(order, "OFFER_ACCEPTED", now, {"offerId": offer_id, "providerId": provider_id, "proposedPrice": price_value})
        _append_order_event(order, "PROVIDER_ASSIGNED", now, {"providerId": provider_id})

        provider.pop("stale", None)
        provider["status"] = "busy"
        provider["assignedOrderId"] = str(order.get("id"))
        provider["updatedAt"] = now
        provider["lastSeenAt"] = now

        _write_json_atomic(order_path, orders)
        save_offers(offers, offer_path)
        save_providers(providers, provider_path)
        return {"offer": dict(offer), "order": attach_dispatch_to_order(order, offers), "provider": dict(provider)}


def decline_offer(
    offer_id: str,
    provider_id: str,
    order_store_path: Optional[Path] = None,
    offer_store_path: Optional[Path] = None,
) -> Dict[str, Any]:
    with STORE_LOCK:
        order_path = order_store_path or _default_store_path()
        offer_path = offer_store_path or _default_offer_store_path()
        orders = load_orders(order_path)
        offers = load_offers(offer_path)
        _expire_offers_in_memory(offers, orders)
        offer = next((item for item in offers if str(item.get("id")) == str(offer_id)), None)

        if offer is None or str(offer.get("providerId")) != str(provider_id):
            raise DispatchConflict("OFFER_NOT_FOUND", "Offer was not found.")
        if offer.get("status") != "pending":
            save_offers(offers, offer_path)
            _write_json_atomic(order_path, orders)
            raise _offer_error_for_status(str(offer.get("status")))

        now = _now_iso()
        offer["status"] = "declined"
        offer["respondedAt"] = now
        order = next((item for item in orders if str(item.get("id")) == str(offer.get("orderId"))), None)
        if order:
            _append_order_event(order, "OFFER_DECLINED", now, {"offerId": offer_id, "providerId": provider_id})

        save_offers(offers, offer_path)
        _write_json_atomic(order_path, orders)
        return dict(offer)


def update_provider_order_status(
    provider_id: str,
    order_id: str,
    status: str,
    order_store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
    offer_store_path: Optional[Path] = None,
) -> Dict[str, Any]:
    with STORE_LOCK:
        order = get_order(order_id, order_store_path)
        if order is None:
            raise DispatchConflict("ORDER_NOT_FOUND", "Order was not found.")
        if str(order.get("assignedProviderId")) != str(provider_id):
            raise DispatchConflict("ORDER_NOT_ASSIGNED_TO_PROVIDER", "Order is not assigned to this provider.")

        updated = update_order_status(
            order_id,
            status,
            store_path=order_store_path,
            provider_store_path=provider_store_path,
            offer_store_path=offer_store_path,
        )
        if updated is None:
            raise DispatchConflict("ORDER_NOT_FOUND", "Order was not found.")
        if normalize_order_status(updated.get("status")) in {"completed", "cancelled"}:
            _set_provider_status(provider_id, "online", provider_store_path=provider_store_path)
        else:
            _set_provider_status(provider_id, "busy", order_id, provider_store_path=provider_store_path)
        return attach_dispatch_to_order(updated, load_offers(offer_store_path))


def build_admin_stats(
    order_store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
    customer_store_path: Optional[Path] = None,
) -> Dict[str, Any]:
    customers = load_customer_profiles(customer_store_path)
    providers = load_providers(provider_store_path)
    orders = load_orders(order_store_path)
    terminal = {"completed", "cancelled"}
    active_orders = [order for order in orders if normalize_order_status(order.get("status")) not in terminal]
    completed_orders = [order for order in orders if normalize_order_status(order.get("status")) == "completed"]
    dispatch_providers = [provider for provider in providers if str(provider.get("providerKind") or "dispatch").lower() != "directory"]
    directory_providers = [provider for provider in providers if str(provider.get("providerKind") or "").lower() == "directory"]
    return {
        "totals": {
            "clients": len(customers),
            "providers": len(providers),
            "dispatchProviders": len(dispatch_providers),
            "directoryProviders": len(directory_providers),
            "orders": len(orders),
            "activeOrders": len(active_orders),
            "completedOrders": len(completed_orders),
        },
        "providers": {
            "online": sum(1 for provider in providers if provider.get("status") == "online"),
            "busy": sum(1 for provider in providers if provider.get("status") == "busy"),
            "offline": sum(1 for provider in providers if provider.get("status") == "offline"),
            "verified": sum(1 for provider in providers if normalize_verification_status(provider.get("verificationStatus"), "") == "verified"),
            "pendingVerification": sum(1 for provider in providers if normalize_verification_status(provider.get("verificationStatus"), "") == "pending"),
        },
        "clients": {
            "verified": sum(1 for customer in customers if normalize_verification_status(customer.get("verificationStatus"), "") == "verified"),
            "registered": sum(1 for customer in customers if is_customer_client_registered(customer)),
            "disabled": sum(1 for customer in customers if str(customer.get("accountStatus") or "active").lower() == "disabled"),
        },
        "orders": {
            "searching": sum(1 for order in orders if normalize_order_status(order.get("status")) == "searching"),
            "assigned": sum(1 for order in orders if normalize_order_status(order.get("status")) == "assigned"),
            "enRoute": sum(1 for order in orders if normalize_order_status(order.get("status")) == "en_route"),
            "inProgress": sum(1 for order in orders if normalize_order_status(order.get("status")) == "in_progress"),
        },
    }


def build_admin_activity_feed(limit: int = 20, order_store_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    orders = load_orders(order_store_path)
    feed: List[Dict[str, Any]] = []
    for order in sorted(orders, key=lambda item: str(item.get("updatedAt") or item.get("createdAt") or ""), reverse=True)[:limit]:
        feed.append(
            {
                "type": "order",
                "id": order.get("id"),
                "status": normalize_order_status(order.get("status")),
                "service": order.get("service"),
                "source": order.get("source"),
                "customerLocation": order.get("customerLocation"),
                "assignedProviderId": order.get("assignedProviderId"),
                "at": order.get("updatedAt") or order.get("createdAt"),
            }
        )
    return feed


def admin_update_customer_profile(customer_id: str, data: Dict[str, Any], store_path: Optional[Path] = None) -> Dict[str, Any]:
    with STORE_LOCK:
        path = store_path or _default_customer_store_path()
        profiles = load_customer_profiles(path)
        now = _now_iso()
        updated: Optional[Dict[str, Any]] = None
        editable_fields = ["name", "phone", "email", "telegram", "city", "avatarUrl", "bio", "accountStatus"]
        for index, profile in enumerate(profiles):
            if str(profile.get("id")) != str(customer_id):
                continue
            payload = _normalize_customer_profile(profile)
            for field in editable_fields:
                if data.get(field) is not None:
                    payload[field] = str(data.get(field) or "").strip()
            if data.get("verificationStatus") is not None:
                status = normalize_verification_status(data.get("verificationStatus"), payload.get("verificationStatus"))
                if status in VERIFICATION_STATUSES:
                    payload["verificationStatus"] = status
                    payload["trustedBadges"] = _verification_badges(status, "customer")
            payload["updatedAt"] = now
            payload["profileCompleteness"] = _customer_profile_completeness(payload)
            profiles[index] = payload
            updated = payload
            break
        if updated is None:
            raise ValueError("customer profile not found")
        save_customer_profiles(profiles, path)
        return prepare_customer_profile_for_admin(updated)


def admin_update_provider_profile(provider_id: str, data: Dict[str, Any], store_path: Optional[Path] = None) -> Dict[str, Any]:
    providers = load_providers(store_path)
    now = _now_iso()
    updated: Optional[Dict[str, Any]] = None
    for index, provider in enumerate(providers):
        if str(provider.get("id")) != str(provider_id):
            continue
        provider.pop("stale", None)
        provider = _normalize_provider_trust(provider)
        for field in ("name", "phone", "telegram", "vehicle", "vehicleMake", "vehicleModel", "plate", "city", "address", "website", "openingHours", "accountStatus"):
            if data.get(field) is not None:
                provider[field] = str(data.get(field) or "").strip()
        if data.get("specialties") is not None:
            specialties = _clean_provider_specialties(data.get("specialties"))
            if specialties:
                provider["specialties"] = specialties
        if data.get("serviceRadiusKm") is not None:
            try:
                radius = int(data.get("serviceRadiusKm") or provider.get("serviceRadiusKm") or 15)
            except (TypeError, ValueError):
                radius = 15
            provider["serviceRadiusKm"] = max(1, min(radius, 100))
        if data.get("status") in PROVIDER_STATUSES:
            provider["status"] = str(data.get("status"))
        if data.get("verificationStatus") is not None:
            status = normalize_verification_status(data.get("verificationStatus"), provider.get("verificationStatus"))
            if status in VERIFICATION_STATUSES:
                provider["verificationStatus"] = status
                provider["trustedBadges"] = _verification_badges(status, "provider")
        if isinstance(data.get("location"), dict):
            provider["location"] = data["location"]
            provider["lastLocationAt"] = now
        provider["profileUpdatedAt"] = now
        provider["updatedAt"] = now
        providers[index] = provider
        updated = provider
        break
    if updated is None:
        raise ValueError("provider profile not found")
    save_providers(providers, store_path)
    return dict(updated)


def admin_delete_provider(provider_id: str, store_path: Optional[Path] = None) -> Dict[str, Any]:
    with STORE_LOCK:
        path = store_path or _default_provider_store_path()
        providers = load_providers(path)
        remaining = [provider for provider in providers if str(provider.get("id")) != str(provider_id)]
        if len(remaining) == len(providers):
            raise ValueError("provider profile not found")
        save_providers(remaining, path)
        return {"deleted": True, "providerId": str(provider_id)}


def _order_belongs_to_customer(order: Dict[str, Any], customer_id: str) -> bool:
    needle = str(customer_id or "").strip()
    if not needle:
        return False
    if str(order.get("customerId") or "").strip() == needle:
        return True
    identity = order.get("customerIdentity") if isinstance(order.get("customerIdentity"), dict) else {}
    if str(identity.get("customerId") or "").strip() == needle:
        return True
    if needle.startswith("tg-"):
        telegram_user_id = needle[3:]
        if str(order.get("chatId") or "").strip() == telegram_user_id:
            return True
        if str(order.get("telegramUserId") or "").strip() == telegram_user_id:
            return True
        if str(identity.get("telegramUserId") or "").strip() == telegram_user_id:
            return True
    return False


def _order_belongs_to_provider(order: Dict[str, Any], provider_id: str) -> bool:
    needle = str(provider_id or "").strip()
    if not needle:
        return False
    if str(order.get("assignedProviderId") or "").strip() == needle:
        return True
    if str(order.get("partnerId") or "").strip() == needle:
        return True
    assigned = order.get("assignedProvider") if isinstance(order.get("assignedProvider"), dict) else {}
    return str(assigned.get("id") or "").strip() == needle


def _customer_ids_for_order_history(
    customer_id: str,
    customer_store_path: Optional[Path] = None,
) -> set[str]:
    """Include phone-linked guest/tg aliases so cabinet history is not empty after re-login."""
    needle = str(customer_id or "").strip()
    ids: set[str] = {needle} if needle else set()
    if not needle:
        return ids
    profile = get_customer_profile(needle, customer_store_path) or {}
    phone_digits = _customer_profile_phone_digits(profile)
    if not phone_digits or len(phone_digits) != 12:
        return ids
    for other in load_customer_profiles(customer_store_path):
        other_id = str(other.get("id") or "").strip()
        if not other_id or other_id in ids:
            continue
        if _customer_profile_phone_digits(other) == phone_digits:
            ids.add(other_id)
    return ids


def list_orders_for_customer(
    customer_id: str,
    store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
    customer_store_path: Optional[Path] = None,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    needles = _customer_ids_for_order_history(customer_id, customer_store_path)
    seen: set[str] = set()
    orders: List[Dict[str, Any]] = []
    for order in load_orders(store_path):
        if not any(_order_belongs_to_customer(order, needle) for needle in needles):
            continue
        order_id = str(order.get("id") or "").strip()
        if order_id and order_id in seen:
            continue
        if order_id:
            seen.add(order_id)
        orders.append(enrich_order_for_client(order, provider_store_path))
    orders.sort(key=lambda item: str(item.get("updatedAt") or item.get("createdAt") or ""), reverse=True)
    return orders[: max(1, min(int(limit or 50), 200))]


def list_orders_for_provider(
    provider_id: str,
    store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    if _should_use_sql_store(store_path, _default_store_path):
        orders = [
            enrich_order_for_client(order, provider_store_path)
            for order in sql_orders_for_provider(str(provider_id), limit=limit)
        ]
        orders.sort(key=lambda item: str(item.get("updatedAt") or item.get("createdAt") or ""), reverse=True)
        return orders[: max(1, min(int(limit or 50), 200))]

    orders = [
        enrich_order_for_client(order, provider_store_path)
        for order in load_orders(store_path)
        if _order_belongs_to_provider(order, provider_id)
    ]
    orders.sort(key=lambda item: str(item.get("updatedAt") or item.get("createdAt") or ""), reverse=True)
    return orders[: max(1, min(int(limit or 50), 200))]


def list_provider_public_reviews(
    provider_id: str,
    store_path: Optional[Path] = None,
    limit: int = 20,
) -> List[Dict[str, Any]]:
    """Customer reviews left for a provider after completed orders (public, sanitized)."""
    needle = str(provider_id or "").strip()
    if not needle:
        return []
    reviews: List[Dict[str, Any]] = []
    for order in load_orders(store_path):
        if not _order_belongs_to_provider(order, needle):
            continue
        if normalize_order_status(order.get("status")) != "completed":
            continue
        review = order.get("customerReview")
        if not isinstance(review, dict) or review.get("rating") is None:
            continue
        try:
            stars = int(review.get("rating"))
        except (TypeError, ValueError):
            continue
        if stars < 1 or stars > 5:
            continue
        reviews.append(
            {
                "rating": stars,
                "comment": str(review.get("comment") or "").strip()[:500],
                "at": review.get("at") or order.get("updatedAt") or order.get("createdAt"),
                "service": order.get("service"),
            }
        )
    reviews.sort(key=lambda item: str(item.get("at") or ""), reverse=True)
    return reviews[: max(1, min(int(limit or 20), 50))]


def get_provider_public_card(
    provider_id: str,
    *,
    store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
    limit: int = 20,
) -> Optional[Dict[str, Any]]:
    """Public partner card for map clients: profile summary + reviews (no auth)."""
    provider = get_provider_profile(provider_id, provider_store_path)
    if provider is None:
        return None
    reviews = list_provider_public_reviews(provider_id, store_path=store_path, limit=limit)
    return {
        "id": provider.get("id"),
        "name": provider.get("name") or "Партнер POMICH",
        "rating": provider.get("rating"),
        "ratingCount": provider.get("ratingCount"),
        "vehicle": provider.get("vehicle"),
        "specialties": provider.get("specialties") or [],
        "status": provider.get("status"),
        "etaMinutes": provider.get("etaMinutes"),
        "providerKind": provider.get("providerKind") or "dispatch",
        "city": provider.get("city"),
        "address": provider.get("address"),
        "phone": provider.get("phone"),
        "telegram": provider.get("telegram"),
        "verificationStatus": provider.get("verificationStatus"),
        "openingHours": provider.get("openingHours"),
        "website": provider.get("website"),
        "ordersCompleted": provider.get("ordersCompleted"),
        "location": provider.get("location"),
        "reviews": reviews,
    }


def _increment_provider_orders_completed(provider_id: str, provider_store_path: Optional[Path] = None) -> None:
    if _should_use_sql_store(provider_store_path, _default_provider_store_path):
        provider = get_provider_profile(provider_id, provider_store_path)
        if provider is None:
            return
        provider["ordersCompleted"] = int(provider.get("ordersCompleted") or 0) + 1
        provider["updatedAt"] = _now_iso()
        sql_upsert_provider(dict(provider))
        return

    providers = load_providers(provider_store_path)
    changed = False
    for provider in providers:
        if str(provider.get("id")) != str(provider_id):
            continue
        provider["ordersCompleted"] = int(provider.get("ordersCompleted") or 0) + 1
        provider["updatedAt"] = _now_iso()
        changed = True
        break
    if changed:
        save_providers(providers, provider_store_path)


def _increment_customer_orders_completed(customer_id: str, customer_store_path: Optional[Path] = None) -> None:
    if _should_use_sql_store(customer_store_path, _default_customer_store_path):
        found = sql_get_customer(str(customer_id))
        if found is None:
            return
        profile = _decrypt_customer_record(found)
        profile["ordersCompleted"] = int(profile.get("ordersCompleted") or 0) + 1
        profile["updatedAt"] = _now_iso()
        sql_upsert_customer(_encrypt_customer_record(profile))
        return

    path = customer_store_path
    profiles = load_customer_profiles(path)
    changed = False
    for profile in profiles:
        if str(profile.get("id")) != str(customer_id):
            continue
        profile["ordersCompleted"] = int(profile.get("ordersCompleted") or 0) + 1
        profile["updatedAt"] = _now_iso()
        changed = True
        break
    if changed:
        save_customer_profiles(profiles, path)


def _apply_star_rating(target: Dict[str, Any], stars: int) -> None:
    rating_count = int(target.get("ratingCount") or 0)
    current = float(target.get("rating") or 0)
    if rating_count <= 0:
        target["rating"] = float(stars)
        target["ratingCount"] = 1
    else:
        target["rating"] = round(((current * rating_count) + float(stars)) / (rating_count + 1), 2)
        target["ratingCount"] = rating_count + 1


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
    role = str(author_role or "").strip().lower()
    if role not in {"customer", "partner"}:
        raise ValueError("invalid_review_role")
    try:
        stars = int(rating)
    except (TypeError, ValueError) as exc:
        raise ValueError("invalid_review_rating") from exc
    if stars < 1 or stars > 5:
        raise ValueError("invalid_review_rating")
    note = str(comment or "").strip()[:500]

    with STORE_LOCK:
        use_sql = _should_use_sql_store(store_path, _default_store_path)
        if use_sql:
            order = sql_get_order(str(order_id))
            orders: Optional[List[Dict[str, Any]]] = None
            path: Optional[Path] = None
        else:
            path = store_path or _default_store_path()
            orders = load_orders(path)
            order = next((item for item in orders if str(item.get("id")) == str(order_id)), None)

        if order is None:
            raise DispatchConflict("ORDER_NOT_FOUND", "Order was not found.")
        if normalize_order_status(order.get("status")) != "completed":
            raise DispatchConflict("ORDER_NOT_COMPLETED", "Reviews are available only for completed orders.")

        review_key = "customerReview" if role == "customer" else "partnerReview"
        if isinstance(order.get(review_key), dict) and order[review_key].get("rating") is not None:
            raise DispatchConflict("REVIEW_ALREADY_SUBMITTED", "Review already submitted for this order.")

        if role == "customer":
            customer_id = str(order.get("customerId") or "").strip()
            if author_id and customer_id and str(author_id) != customer_id and not _order_belongs_to_customer(order, str(author_id)):
                raise DispatchConflict("REVIEW_FORBIDDEN", "Customer cannot review this order.")
        else:
            provider_id = str(order.get("assignedProviderId") or order.get("partnerId") or "").strip()
            if author_id and provider_id and str(author_id) != provider_id:
                raise DispatchConflict("REVIEW_FORBIDDEN", "Partner cannot review this order.")

        now = _now_iso()
        order[review_key] = {
            "rating": stars,
            "comment": note,
            "at": now,
            "authorId": str(author_id or "").strip() or None,
            "authorRole": role,
        }
        order["updatedAt"] = now
        _append_order_event(order, "REVIEW_SUBMITTED", now, {"role": role, "rating": stars})

        if use_sql:
            sql_upsert_order(order)
        else:
            assert path is not None and orders is not None
            _write_json_atomic(path, orders)

        if role == "customer":
            provider_id = str(order.get("assignedProviderId") or order.get("partnerId") or "").strip()
            if provider_id:
                provider = get_provider_profile(provider_id, provider_store_path)
                if provider is not None:
                    _apply_star_rating(provider, stars)
                    provider["updatedAt"] = now
                    if _should_use_sql_store(provider_store_path, _default_provider_store_path):
                        sql_upsert_provider(dict(provider))
                    else:
                        providers = load_providers(provider_store_path)
                        for index, item in enumerate(providers):
                            if str(item.get("id")) != provider_id:
                                continue
                            providers[index] = provider
                            break
                        save_providers(providers, provider_store_path)
        else:
            customer_id = str(order.get("customerId") or "").strip()
            if customer_id:
                if _should_use_sql_store(customer_store_path, _default_customer_store_path):
                    found = sql_get_customer(customer_id)
                    if found is not None:
                        profile = _decrypt_customer_record(found)
                        _apply_star_rating(profile, stars)
                        profile["updatedAt"] = now
                        sql_upsert_customer(_encrypt_customer_record(profile))
                else:
                    profiles = load_customer_profiles(customer_store_path)
                    for profile in profiles:
                        if str(profile.get("id")) != customer_id:
                            continue
                        _apply_star_rating(profile, stars)
                        profile["updatedAt"] = now
                        break
                    save_customer_profiles(profiles, customer_store_path)

        return enrich_order_for_client(order, provider_store_path, customer_store_path)
