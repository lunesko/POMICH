import json
import math
import os
import threading
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

from bot.runtime_store import (
    SqlDispatchConflict,
    load_collection,
    save_collection,
    sql_accept_offer,
    sql_candidate_providers_for_order,
    sql_storage_enabled,
)

PROVIDER_PRESENCE_TTL_SECONDS = 60
PROVIDER_ACTIVE_STATUSES = {"online", "busy"}
PROVIDER_STATUSES = {"online", "busy", "offline"}
PROVIDER_SPECIALTIES = {"tow", "battery", "wheel", "fuel", "lockout", "mechanic"}
VERIFICATION_STATUSES = {"unverified", "pending", "verified", "rejected"}
DISPATCH_SEARCH_RADIUS_STEPS_KM = [int(value) for value in os.getenv("SEARCH_RADIUS_STEPS_KM", "5,10,20,40").split(",") if value.strip().isdigit()]
MAX_PROVIDER_OFFERS = int(os.getenv("MAX_PROVIDER_OFFERS", "5"))
OFFER_TIMEOUT_SECONDS = int(os.getenv("OFFER_TIMEOUT_SECONDS", "20"))
OFFER_STATUSES = {"pending", "accepted", "declined", "expired", "lost", "cancelled"}
STORE_LOCK = threading.RLock()

ORDER_STATUS_ALIASES = {
    "created": "searching",
    "matching": "searching",
    "tracking": "en_route",
}
ORDER_STATUSES = {"draft", "searching", "assigned", "en_route", "arrived", "in_progress", "completed", "cancelled"}
ORDER_TRANSITIONS = {
    "draft": {"searching", "cancelled"},
    "searching": {"assigned", "cancelled"},
    "assigned": {"en_route", "cancelled"},
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
        return ["Перевірено POMICH", "Документи перевірено"] if role == "provider" else ["Профіль підтверджено", "Телефон перевірено"]
    if status == "pending":
        return ["На перевірці"]
    if status == "rejected":
        return ["Потрібне оновлення документів"]
    return ["Потребує перевірки"]


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
    return normalize_verification_status(provider.get("verificationStatus"), "unverified") == "verified"


def _default_customer_profile(customer_id: str, timestamp: str | None = None) -> Dict[str, Any]:
    now = timestamp or _now_iso()
    return {
        "id": str(customer_id),
        "name": "Клієнт POMICH",
        "phone": "",
        "email": "",
        "telegram": "",
        "city": "Київ",
        "avatarUrl": "",
        "bio": "",
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
    verification = profile.get("verification") if isinstance(profile.get("verification"), dict) else {}
    checks = [
        bool(str(profile.get("name") or "").strip()),
        bool(str(profile.get("phone") or "").strip()),
        bool(str(profile.get("city") or "").strip()),
        bool(str(profile.get("avatarUrl") or "").strip()) or bool(verification.get("profilePhoto")),
        bool(verification.get("phone")),
        bool(verification.get("identityDocument")) or bool(verification.get("telegram")),
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
            "serviceRadiusKm": 7,
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


def save_order(order: Dict[str, Any], store_path: Optional[Path] = None) -> Dict[str, Any]:
    with STORE_LOCK:
        path = store_path or _default_store_path()
        orders = load_orders(path)
        payload = dict(order)
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


def get_order(order_id: str, store_path: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    for order in load_orders(store_path):
        if str(order.get("id")) == str(order_id):
            payload = dict(order)
            try:
                payload["status"] = normalize_order_status(payload.get("status"))
            except ValueError:
                payload["status"] = "searching"
            return payload
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
        elif next_status == "completed" and updated_order.get("assignedProviderId"):
            _set_provider_status(str(updated_order.get("assignedProviderId")), "online", provider_store_path=provider_store_path)
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


def load_customer_profiles(store_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    if _should_use_sql_store(store_path, _default_customer_store_path):
        found, data = load_collection("customers")
        return [_normalize_customer_profile(profile) for profile in data] if found and isinstance(data, list) else []

    path = store_path or _default_customer_store_path()
    if not path.exists():
        return []
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
            return [_normalize_customer_profile(profile) for profile in data] if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []


def save_customer_profiles(profiles: List[Dict[str, Any]], store_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    with STORE_LOCK:
        path = store_path or _default_customer_store_path()
        cleaned_profiles = [_normalize_customer_profile(profile) for profile in profiles]
        _write_json_atomic(path, cleaned_profiles)
        return cleaned_profiles


def get_customer_profile(customer_id: str, store_path: Optional[Path] = None) -> Dict[str, Any]:
    for profile in load_customer_profiles(store_path):
        if str(profile.get("id")) == str(customer_id):
            return _normalize_customer_profile(profile)
    return _default_customer_profile(customer_id)


def update_customer_profile(customer_id: str, data: Dict[str, Any], store_path: Optional[Path] = None) -> Dict[str, Any]:
    with STORE_LOCK:
        path = store_path or _default_customer_store_path()
        profiles = load_customer_profiles(path)
        now = _now_iso()
        updated: Optional[Dict[str, Any]] = None

        editable_fields = ["name", "phone", "email", "telegram", "city", "avatarUrl", "bio"]
        for index, profile in enumerate(profiles):
            if str(profile.get("id")) != str(customer_id):
                continue
            payload = _normalize_customer_profile(profile)
            for field in editable_fields:
                if data.get(field) is not None:
                    payload[field] = str(data.get(field) or "").strip()
            payload["updatedAt"] = now
            payload["profileCompleteness"] = _customer_profile_completeness(payload)
            profiles[index] = payload
            updated = payload
            break

        if updated is None:
            payload = _default_customer_profile(customer_id, now)
            for field in editable_fields:
                if data.get(field) is not None:
                    payload[field] = str(data.get(field) or "").strip()
            payload["profileCompleteness"] = _customer_profile_completeness(payload)
            profiles.append(payload)
            updated = payload

        save_customer_profiles(profiles, path)
        return dict(updated)


def upsert_telegram_customer_profile(user: Dict[str, Any], store_path: Optional[Path] = None) -> Dict[str, Any]:
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
        if updated.get("verificationStatus") == "unverified":
            updated["verificationStatus"] = "verified"
            updated["trustedBadges"] = _verification_badges("verified", "customer")
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
        radius = int(data.get("serviceRadiusKm") or 7)
    except (TypeError, ValueError):
        radius = 7
    radius = max(1, min(radius, 50))

    updated: Optional[Dict[str, Any]] = None
    for index, provider in enumerate(providers):
        if str(provider.get("id")) != str(provider_id):
            continue

        provider.pop("stale", None)
        provider = _normalize_provider_trust(provider)
        provider["name"] = str(data.get("name") or provider.get("name") or "Партнер POMICH").strip()
        provider["phone"] = str(data.get("phone") or provider.get("phone") or "").strip()
        provider["telegram"] = str(data.get("telegram") or provider.get("telegram") or "pomich_help_bot").strip()
        provider["vehicle"] = str(data.get("vehicle") or provider.get("vehicle") or "Автодопомога").strip()
        provider["plate"] = str(data.get("plate") or provider.get("plate") or "").strip()
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
        updated = _normalize_provider_trust({
            "id": str(provider_id),
            "name": str(data.get("name") or "Партнер POMICH").strip(),
            "rating": data.get("rating") or 4.8,
            "vehicle": str(data.get("vehicle") or "Автодопомога").strip(),
            "plate": str(data.get("plate") or "").strip(),
            "phone": str(data.get("phone") or "").strip(),
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
            "serviceRadiusKm": data.get("serviceRadiusKm") or 7,
            "lastSeenAt": now,
            "lastLocationAt": now if data.get("location") else None,
            "updatedAt": now,
        })
        if status in PROVIDER_ACTIVE_STATUSES and not is_provider_verified(candidate):
            raise ValueError("provider verification must be approved before going online")
        updated = candidate
        providers.append(updated)

    save_providers(providers, store_path)
    updated.pop("stale", None)
    return updated


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
        provider_radius = float(provider.get("serviceRadiusKm") or 7)
        if distance > provider_radius:
            continue

        candidate = dict(provider)
        candidate["distanceKm"] = round(distance, 2)
        candidates.append(candidate)

    return sorted(candidates, key=lambda provider: provider["distanceKm"])


def _public_offer_payload(offer: Dict[str, Any], order: Dict[str, Any]) -> Dict[str, Any]:
    return {
        **offer,
        "service": normalize_service(order.get("service")),
        "vehicleState": order.get("vehicleState"),
        "approximateLocation": order.get("customerLocation"),
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
        offered_ids = {str(offer.get("providerId")) for offer in offers if str(offer.get("orderId")) == str(order_id)}
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
    payload = dict(order)
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
) -> Dict[str, Any]:
    if _should_use_sql_runtime(order_store_path, provider_store_path, offer_store_path):
        try:
            return sql_accept_offer(str(offer_id), str(provider_id))
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

        order["status"] = "assigned"
        order["assignedProviderId"] = provider_id
        order["assignedOfferId"] = offer_id
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
        order["dispatchState"] = "ASSIGNED"
        order["updatedAt"] = now
        history = order.get("statusHistory") if isinstance(order.get("statusHistory"), list) else []
        history.append({"status": "assigned", "at": now})
        order["statusHistory"] = history
        _append_order_event(order, "OFFER_ACCEPTED", now, {"offerId": offer_id, "providerId": provider_id})
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
