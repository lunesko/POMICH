import json
import math
import os
import threading
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

from bot.field_encryption import decrypt_customer_profile, decrypt_field, encrypt_customer_profile, is_encrypted_value
from bot.runtime_store import (
    SqlDispatchConflict,
    load_collection,
    save_collection,
    sql_accept_offer,
    sql_candidate_providers_for_order,
    sql_storage_enabled,
    sql_upsert_provider,
)

PROVIDER_PRESENCE_TTL_SECONDS = 60
PROVIDER_ACTIVE_STATUSES = {"online", "busy"}
PROVIDER_STATUSES = {"online", "busy", "offline"}
PROVIDER_SPECIALTIES = {"tow", "battery", "wheel", "fuel", "lockout", "mechanic"}
VERIFICATION_STATUSES = {"unverified", "pending", "verified", "rejected"}
DISPATCH_SEARCH_RADIUS_STEPS_KM = [int(value) for value in os.getenv("SEARCH_RADIUS_STEPS_KM", "5,10,20,40").split(",") if value.strip().isdigit()]
MAX_PROVIDER_OFFERS = int(os.getenv("MAX_PROVIDER_OFFERS", "5"))
# Partners need time to read details, enter a price, and accept. 20s was too short in production.
OFFER_TIMEOUT_SECONDS = int(os.getenv("OFFER_TIMEOUT_SECONDS", "90"))
OFFER_STATUSES = {"pending", "accepted", "declined", "expired", "lost", "cancelled"}
STORE_LOCK = threading.RLock()

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
    return f"{datetime.utcnow().isoformat(timespec='seconds')}Z"


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


def normalize_order_status(status: Any) -> str:
    normalized = str(status or "searching").strip().lower()
    normalized = ORDER_STATUS_ALIASES.get(normalized, normalized)
    if normalized not in ORDER_STATUSES:
        raise ValueError(f"unknown order status: {status}")
    return normalized


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
    with STORE_LOCK:
        path = order_store_path or _default_store_path()
        orders = load_orders(path)
        order = next((item for item in orders if str(item.get("id")) == str(order_id)), None)
        if order is None:
            raise DispatchConflict("ORDER_NOT_FOUND", "Order was not found.")

        current_status = normalize_order_status(order.get("status"))
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
    checked_at = now or datetime.utcnow()
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
    providers = load_providers(store_path)
    now = _now_iso()
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
        payload["id"] = payload.get("id") or f"PM-{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}"
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
        path = store_path or _default_store_path()
        orders = load_orders(path)
        updated_order: Optional[Dict[str, Any]] = None
        now = _now_iso()
        next_status = normalize_order_status(status)

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
        elif next_status == "completed" and updated_order.get("assignedProviderId"):
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
        dispatch_partners = [provider for provider in existing if str(provider.get("providerKind") or "dispatch") != "directory"]
        by_id = {str(provider.get("id")): provider for provider in dispatch_partners if provider.get("id")}
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
        if normalize_order_status(order.get("status")) != "searching":
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
            "status": "searching",
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
    for provider in load_providers(store_path):
        if str(provider.get("id")) == str(provider_id):
            payload = _normalize_provider_trust(provider)
            payload.pop("stale", None)
            return payload
    return None


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
            "avatarUrl",
            "bio",
            "preferredRole",
            "linkedProviderId",
            "rolesRegistered",
        ]
        for index, profile in enumerate(profiles):
            if str(profile.get("id")) != str(customer_id):
                continue
            payload = _normalize_customer_profile(profile)
            for field in editable_fields:
                if data.get(field) is not None:
                    if field == "rolesRegistered" and isinstance(data.get(field), list):
                        payload[field] = [str(item).strip() for item in data.get(field) if str(item).strip()]
                    else:
                        payload[field] = str(data.get(field) or "").strip()
            if data.get("phone") is not None:
                _ensure_customer_phone_available(customer_id, str(payload.get("phone") or ""), profiles)
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
                _ensure_customer_phone_available(customer_id, str(payload.get("phone") or ""), profiles)
            payload["profileCompleteness"] = _customer_profile_completeness(payload)
            profiles.append(payload)
            updated = payload

        save_customer_profiles(profiles, path)
        return _maybe_persist_phone_linked_verification(dict(updated), path)


def upsert_telegram_customer_profile(user: Dict[str, Any], store_path: Optional[Path] = None) -> Dict[str, Any]:
    # Links Telegram user to tg-{id} customer row shared by bot and web app.
    telegram_user_id = str(user.get("id") or "").strip()
    if not telegram_user_id:
        raise ValueError("telegram user id missing")

    customer_id = f"tg-{telegram_user_id}"
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
    threshold = datetime.utcnow() - timedelta(days=max(1, int(days)))
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


def find_registered_customer_by_phone(
    phone: str,
    *,
    exclude_id: str | None = None,
    store_path: Optional[Path] = None,
    profiles: Optional[List[Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    """Find a registered customer profile with the same phone (prefers tg-* canonical rows)."""
    target = _normalize_ukraine_phone_digits(phone)
    if not target or len(target) != 12:
        return None
    candidates: List[Dict[str, Any]] = []
    source = profiles if profiles is not None else load_customer_profiles(store_path)
    for profile in source:
        customer_id = str(profile.get("id") or "")
        if exclude_id and customer_id == exclude_id:
            continue
        if _customer_profile_phone_digits(profile) != target:
            continue
        normalized = _normalize_customer_profile(profile)
        if not is_customer_client_registered(normalized):
            continue
        candidates.append(normalized)
    # Prefer the Telegram owner of a partner cabinet that uses this phone
    # (guest web rows often hold the same number without a chat_id).
    provider = find_registered_provider_by_phone(phone)
    if provider is not None:
        telegram_user_id = resolve_provider_telegram_user_id(
            str(provider.get("id") or ""),
            customer_store_path=store_path,
        )
        if telegram_user_id:
            preferred_id = f"tg-{telegram_user_id}"
            if not exclude_id or preferred_id != str(exclude_id):
                for profile in source:
                    if str(profile.get("id") or "") != preferred_id:
                        continue
                    normalized = _normalize_customer_profile(profile)
                    if is_customer_client_registered(normalized) or str(normalized.get("phone") or "").strip():
                        return normalized
                    break
    if not candidates:
        return None
    tg_candidates = [item for item in candidates if str(item.get("id") or "").startswith("tg-")]
    return tg_candidates[0] if tg_candidates else candidates[0]


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


def _ensure_customer_phone_available(
    customer_id: str,
    phone: str,
    profiles: List[Dict[str, Any]],
) -> None:
    phone_value = str(phone or "").strip()
    if not phone_value:
        return
    existing = find_registered_customer_by_phone(
        phone_value,
        exclude_id=str(customer_id),
        profiles=profiles,
    )
    if existing is not None:
        raise ValueError(PHONE_ALREADY_REGISTERED)


def _ensure_provider_phone_available(
    provider_id: str,
    phone: str,
    providers: List[Dict[str, Any]],
) -> None:
    phone_value = str(phone or "").strip()
    if not phone_value:
        return
    existing = find_registered_provider_by_phone(
        phone_value,
        exclude_id=str(provider_id),
        providers=providers,
    )
    if existing is not None:
        raise ValueError(PHONE_ALREADY_REGISTERED)


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


def set_user_preferred_role(customer_id: str, role: str, store_path: Optional[Path] = None) -> Dict[str, Any]:
    normalized_role = str(role or "").strip()
    if normalized_role not in {"customer", "provider"}:
        raise ValueError("preferred role must be customer or provider")
    profile = update_customer_profile(customer_id, {"preferredRole": normalized_role}, store_path)
    if normalized_role == "provider":
        provider_id = resolve_linked_provider_id(customer_id, profile)
        if provider_id and not str(profile.get("linkedProviderId") or "").strip():
            profile = update_customer_profile(customer_id, {"linkedProviderId": provider_id}, store_path)
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
    providers = load_providers(store_path)
    now = _now_iso()
    specialties = _clean_provider_specialties(data.get("specialties"))
    if not specialties:
        raise ValueError("provider specialties must include at least one supported service")

    try:
        radius = int(data.get("serviceRadiusKm") or 15)
    except (TypeError, ValueError):
        radius = 15
    radius = max(1, min(radius, 100))

    updated: Optional[Dict[str, Any]] = None
    for index, provider in enumerate(providers):
        if str(provider.get("id")) != str(provider_id):
            continue

        provider.pop("stale", None)
        provider = _normalize_provider_trust(provider)
        provider["name"] = str(data.get("name") or provider.get("name") or "Партнер POMICH").strip()
        next_phone = str(data.get("phone") or provider.get("phone") or "").strip()
        _ensure_provider_phone_available(provider_id, next_phone, providers)
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

    if updated is None:
        status = str(data.get("status") or "offline")
        if status not in PROVIDER_STATUSES:
            raise ValueError("provider status must be online, busy or offline")
        if status in PROVIDER_ACTIVE_STATUSES and not data.get("registeredAt"):
            raise ValueError("provider profile must be registered before going online")
        next_phone = str(data.get("phone") or "").strip()
        _ensure_provider_phone_available(provider_id, next_phone, providers)
        updated = _normalize_provider_trust({
            "id": str(provider_id),
            "name": str(data.get("name") or "Партнер POMICH").strip(),
            "rating": data.get("rating") or 4.8,
            "vehicle": str(data.get("vehicle") or "Автодопомога").strip(),
            "plate": str(data.get("plate") or "").strip(),
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
        providers.append(updated)

    save_providers(providers, store_path)
    return dict(updated)


def update_provider_presence(provider_id: str, data: Dict[str, Any], store_path: Optional[Path] = None) -> Dict[str, Any]:
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
        })
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


def redispatch_searching_orders_for_provider(
    provider_id: str,
    order_store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
    offer_store_path: Optional[Path] = None,
) -> int:
    """Offer nearby searching orders to a provider who just went online."""
    provider = get_provider_profile(provider_id, provider_store_path)
    if provider is None or provider.get("status") != "online":
        return 0
    if not is_provider_verified(provider):
        return 0

    location = _valid_point(provider.get("location"))
    if location is None:
        return 0

    specialties = _clean_provider_specialties(provider.get("specialties"))
    radius_km = float(provider.get("serviceRadiusKm") or 15)
    redispatched = 0

    for order in load_orders(order_store_path):
        if normalize_order_status(order.get("status")) != "searching":
            continue
        service = normalize_service(order.get("service"))
        if service not in specialties:
            continue
        pickup = _valid_point(order.get("customerCoordinates"))
        if pickup is None:
            continue
        if haversine_distance_km(location, pickup) > radius_km:
            continue
        dispatch_order(
            str(order.get("id")),
            order_store_path,
            provider_store_path,
            offer_store_path,
        )
        redispatched += 1

    return redispatched


def _offer_error_for_status(status: str) -> DispatchConflict:
    if status == "expired":
        return DispatchConflict("OFFER_EXPIRED", "Offer has expired.")
    if status == "declined":
        return DispatchConflict("OFFER_DECLINED", "Offer has already been declined.")
    return DispatchConflict("ORDER_ALREADY_ACCEPTED", "Order has already been accepted by another provider.")


def _expire_offers_in_memory(offers: List[Dict[str, Any]], orders: List[Dict[str, Any]], now: Optional[datetime] = None) -> bool:
    checked_at = now or datetime.utcnow()
    now_iso = f"{checked_at.isoformat(timespec='seconds')}Z"
    order_by_id = {str(order.get("id")): order for order in orders}
    changed = False

    for offer in offers:
        if offer.get("status") != "pending":
            continue

        order = order_by_id.get(str(offer.get("orderId")))
        order_status = normalize_order_status(order.get("status")) if order else "cancelled"
        expires_at = _parse_iso(offer.get("expiresAt"))

        if order_status == "cancelled":
            offer["status"] = "cancelled"
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


def expire_offers(order_store_path: Optional[Path] = None, offer_store_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    with STORE_LOCK:
        orders = load_orders(order_store_path)
        offers = load_offers(offer_store_path)
        changed = _expire_offers_in_memory(offers, orders)
        if changed:
            save_offers(offers, offer_store_path)
            if order_store_path:
                _write_json_atomic(order_store_path, orders)
            else:
                _write_json_atomic(_default_store_path(), orders)
        return offers


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
    providers = load_providers(provider_store_path)
    now = _now_iso()
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
    checked_at = now or datetime.utcnow()
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
    checked_at = now or datetime.utcnow()
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

        now = datetime.utcnow()
        now_iso = f"{now.isoformat(timespec='seconds')}Z"
        offered_ids = {
            str(offer.get("providerId"))
            for offer in offers
            if str(offer.get("orderId")) == str(order_id) and offer.get("status") == "pending"
        }
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
            order["dispatchState"] = "NO_PROVIDERS_AVAILABLE"
            order["dispatchInfo"] = {
                "eligibleProviders": len(candidates),
                "offersSent": 0,
                "searchRadiusStepsKm": DISPATCH_SEARCH_RADIUS_STEPS_KM,
                "lastDispatchAt": now_iso,
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
        order["dispatchInfo"] = {
            "eligibleProviders": len(candidates),
            "offersSent": len(selected),
            "searchRadiusKm": selected_radius,
            "searchRadiusStepsKm": DISPATCH_SEARCH_RADIUS_STEPS_KM,
            "maxProviderOffers": MAX_PROVIDER_OFFERS,
            "offerTimeoutSeconds": OFFER_TIMEOUT_SECONDS,
            "lastDispatchAt": now_iso,
        }
        order["updatedAt"] = now_iso
        _write_json_atomic(order_path, orders)
        save_offers(offers, offer_path)
        return attach_dispatch_to_order(order, offers)


def attach_dispatch_to_order(order: Dict[str, Any], offers: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    payload = enrich_order_for_client(order)
    related_offers = [dict(offer) for offer in (offers if offers is not None else load_offers()) if str(offer.get("orderId")) == str(order.get("id"))]
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
    with STORE_LOCK:
        orders = load_orders(order_store_path)
        offers = load_offers(offer_store_path)
        changed = _expire_offers_in_memory(offers, orders)
        if changed:
            save_offers(offers, offer_store_path)
            _write_json_atomic(order_store_path or _default_store_path(), orders)

        order_by_id = {str(order.get("id")): order for order in orders}
        provider_offers = []
        for offer in offers:
            if str(offer.get("providerId")) != str(provider_id) or offer.get("status") != "pending":
                continue
            order = order_by_id.get(str(offer.get("orderId")))
            if not order or normalize_order_status(order.get("status")) != "searching":
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
    store_path: Optional[Path] = None,
) -> set[str]:
    """Include phone-linked guest/tg aliases so cabinet history is not empty after re-login."""
    needle = str(customer_id or "").strip()
    ids: set[str] = {needle} if needle else set()
    if not needle:
        return ids
    profile = get_customer_profile(needle, store_path) or {}
    phone_digits = _customer_profile_phone_digits(profile)
    if not phone_digits or len(phone_digits) != 12:
        return ids
    for other in load_customer_profiles(store_path):
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
    limit: int = 50,
) -> List[Dict[str, Any]]:
    needles = _customer_ids_for_order_history(customer_id, store_path)
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
    orders = [
        enrich_order_for_client(order, provider_store_path)
        for order in load_orders(store_path)
        if _order_belongs_to_provider(order, provider_id)
    ]
    orders.sort(key=lambda item: str(item.get("updatedAt") or item.get("createdAt") or ""), reverse=True)
    return orders[: max(1, min(int(limit or 50), 200))]


def _increment_provider_orders_completed(provider_id: str, provider_store_path: Optional[Path] = None) -> None:
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
        _write_json_atomic(path, orders)

        if role == "customer":
            provider_id = str(order.get("assignedProviderId") or order.get("partnerId") or "").strip()
            if provider_id:
                providers = load_providers(provider_store_path)
                for provider in providers:
                    if str(provider.get("id")) != provider_id:
                        continue
                    _apply_star_rating(provider, stars)
                    provider["updatedAt"] = now
                    break
                save_providers(providers, provider_store_path)
        else:
            customer_id = str(order.get("customerId") or "").strip()
            if customer_id:
                profiles = load_customer_profiles(customer_store_path)
                for profile in profiles:
                    if str(profile.get("id")) != customer_id:
                        continue
                    _apply_star_rating(profile, stars)
                    profile["updatedAt"] = now
                    break
                save_customer_profiles(profiles, customer_store_path)

        return enrich_order_for_client(order, provider_store_path, customer_store_path)
