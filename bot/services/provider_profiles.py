"""Provider profiles operations; no dependency on the compatibility facade."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional


@dataclass(frozen=True)
class Dependencies:
    PHONE_ALREADY_REGISTERED: Any
    PROVIDER_ACTIVE_STATUSES: Any
    PROVIDER_PRESENCE_TTL_SECONDS: Any
    PROVIDER_SPECIALTIES: Any
    PROVIDER_STATUSES: Any
    STORE_LOCK: Any
    VERIFICATION_STATUSES: Any
    _clean_provider_specialties: Callable[..., Any]
    _customer_profile_completeness: Callable[..., Any]
    _customer_profile_phone_digits: Callable[..., Any]
    _decrypt_customer_record: Callable[..., Any]
    _default_customer_profile: Callable[..., Any]
    _default_customer_store_path: Callable[..., Any]
    _default_provider_store_path: Callable[..., Any]
    _default_provider_verification: Callable[..., Any]
    _default_providers: Callable[..., Any]
    _encrypt_customer_record: Callable[..., Any]
    _ensure_provider_phone_available: Callable[..., Any]
    _normalize_customer_profile: Callable[..., Any]
    _normalize_provider_trust: Callable[..., Any]
    _normalize_ukraine_phone_digits: Callable[..., Any]
    _now_iso: Callable[..., Any]
    _parse_iso: Callable[..., Any]
    _profiles_share_account: Callable[..., Any]
    _should_use_sql_store: Callable[..., Any]
    _truthy_flag: Callable[..., Any]
    _verification_badges: Callable[..., Any]
    _write_json_atomic: Callable[..., Any]
    apply_provider_presence_ttl: Callable[..., Any]
    build_empty_provider_profile_shell: Callable[..., Any]
    ensure_linked_provider_profile: Callable[..., Any]
    find_registered_provider_by_phone: Callable[..., Any]
    get_customer_profile: Callable[..., Any]
    get_provider_profile: Callable[..., Any]
    is_customer_client_registered: Callable[..., Any]
    is_provider_profile_complete: Callable[..., Any]
    is_provider_verified: Callable[..., Any]
    is_valid_ukraine_plate: Any
    load_collection: Any
    load_customer_profiles: Callable[..., Any]
    load_providers: Callable[..., Any]
    mark_user_role_registered: Callable[..., Any]
    normalize_ukraine_plate: Any
    normalize_verification_status: Callable[..., Any]
    redispatch_searching_orders_for_provider: Callable[..., Any]
    resolve_customer_id_for_provider: Callable[..., Any]
    resolve_linked_provider_id: Callable[..., Any]
    save_providers: Callable[..., Any]
    sql_get_customer: Any
    sql_providers_by_phone_lookup: Any
    sql_upsert_customer: Any
    sql_upsert_provider: Any
    sync_linked_provider_phone_verification_from_customer: Callable[..., Any]
    update_customer_profile: Callable[..., Any]
    verify_provider_phone_otp: Callable[..., Any]


def apply_provider_presence_ttl(deps: Dependencies, providers: List[Dict[str, Any]], now: Optional[datetime] = None) -> List[Dict[str, Any]]:
    checked_at = now or datetime.now(timezone.utc).replace(tzinfo=None)
    visible_providers: List[Dict[str, Any]] = []

    for provider in providers:
        payload = dict(provider)
        status = str(payload.get("status") or "offline")
        last_seen = deps._parse_iso(payload.get("lastSeenAt") or payload.get("updatedAt"))
        if status in deps.PROVIDER_ACTIVE_STATUSES and (last_seen is None or checked_at - last_seen > timedelta(seconds=deps.PROVIDER_PRESENCE_TTL_SECONDS)):
            payload["status"] = "offline"
            payload["stale"] = True
        visible_providers.append(payload)

    return visible_providers


def _clean_provider_specialties(deps: Dependencies, value: Any) -> List[str]:
    if not isinstance(value, list):
        return []
    cleaned: List[str] = []
    for item in value:
        specialty = str(item).strip()
        if specialty in deps.PROVIDER_SPECIALTIES and specialty not in cleaned:
            cleaned.append(specialty)
    return cleaned


def normalize_verification_status(deps: Dependencies, status: Any, default: str = "unverified") -> str:
    normalized = str(status or default).strip().lower()
    return normalized if normalized in deps.VERIFICATION_STATUSES else default


def _truthy_flag(deps: Dependencies, value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    return bool(value)


def _verification_badges(deps: Dependencies, status: str, role: str) -> List[str]:
    if status == "verified":
        return ["Перевірено POMICH", "Документи перевірено"] if role == "provider" else ["Профіль заповнено", "Телефон збережено"]
    if status == "pending":
        return ["На перевірці"] if role == "provider" else ["Профіль заповнено"]
    if status == "rejected":
        return ["Потрібне оновлення документів"] if role == "provider" else ["Потрібне оновлення профілю"]
    return ["Потребує перевірки"] if role == "provider" else ["Заповніть профіль"]


def _default_provider_verification(deps: Dependencies, status: str, timestamp: str | None = None) -> Dict[str, Any]:
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


def _normalize_provider_trust(deps: Dependencies, provider: Dict[str, Any], default_status: str = "unverified") -> Dict[str, Any]:
    payload = dict(provider)
    status = deps.normalize_verification_status(payload.get("verificationStatus") or payload.get("verification_status"), default_status)
    timestamp = str(payload.get("profileUpdatedAt") or payload.get("registeredAt") or payload.get("updatedAt") or deps._now_iso())
    existing = payload.get("verification") if isinstance(payload.get("verification"), dict) else {}
    verification = {**deps._default_provider_verification(status, timestamp), **existing}
    if status == "verified":
        for key in ["identityDocument", "driverLicense", "vehicleRegistration", "serviceProof", "selfieCheck"]:
            verification[key] = True
        verification["backgroundCheck"] = verification.get("backgroundCheck") or "passed"
    payload["verificationStatus"] = status
    payload["verification"] = verification
    badges = payload.get("trustedBadges") if isinstance(payload.get("trustedBadges"), list) else None
    payload["trustedBadges"] = badges or deps._verification_badges(status, "provider")
    payload.pop("verification_status", None)
    return payload


def is_provider_verified(deps: Dependencies, provider: Dict[str, Any]) -> bool:
    status = deps.normalize_verification_status(provider.get("verificationStatus"), "unverified")
    if status == "verified":
        return True
    verification = provider.get("verification") if isinstance(provider.get("verification"), dict) else {}
    return bool(verification.get("phone"))


def verify_provider_phone_otp(deps: Dependencies, provider_id: str, store_path: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    now = deps._now_iso()
    if deps._should_use_sql_store(store_path, deps._default_provider_store_path):
        provider = deps.get_provider_profile(provider_id, store_path)
        if provider is None:
            return None
        provider = deps._normalize_provider_trust(provider)
        verification = provider.get("verification") if isinstance(provider.get("verification"), dict) else {}
        verification["phone"] = True
        verification["reviewedAt"] = now
        verification["reviewedBy"] = "otp"
        verification["reviewNote"] = "Verified via Telegram OTP"
        provider["verificationStatus"] = "verified"
        provider["verification"] = verification
        provider["trustedBadges"] = deps._verification_badges("verified", "provider")
        provider["profileUpdatedAt"] = now
        provider["updatedAt"] = now
        persisted = deps.sql_upsert_provider(dict(provider))
        persisted.pop("stale", None)
        return dict(persisted)

    providers = deps.load_providers(store_path)
    updated: Optional[Dict[str, Any]] = None
    for index, provider in enumerate(providers):
        if str(provider.get("id")) != str(provider_id):
            continue
        provider = deps._normalize_provider_trust(provider)
        verification = provider.get("verification") if isinstance(provider.get("verification"), dict) else {}
        verification["phone"] = True
        verification["reviewedAt"] = now
        verification["reviewedBy"] = "otp"
        verification["reviewNote"] = "Verified via Telegram OTP"
        provider["verificationStatus"] = "verified"
        provider["verification"] = verification
        provider["trustedBadges"] = deps._verification_badges("verified", "provider")
        provider["profileUpdatedAt"] = now
        provider["updatedAt"] = now
        providers[index] = provider
        updated = provider
        break
    if updated is None:
        return None
    deps.save_providers(providers, store_path)
    return dict(updated)


def _default_providers(deps: Dependencies, ) -> List[Dict[str, Any]]:
    now = deps._now_iso()
    return [
        deps._normalize_provider_trust({
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
        deps._normalize_provider_trust({
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
        deps._normalize_provider_trust({
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


def merge_directory_providers(deps: Dependencies,
    incoming: List[Dict[str, Any]],
    store_path: Optional[Path] = None,
) -> Dict[str, Any]:
    """Merge directory providers by id; keep dispatch partners unchanged."""
    with deps.STORE_LOCK:
        path = store_path or deps._default_provider_store_path()
        existing = deps.load_providers(path)
        by_id = {str(provider.get("id")): provider for provider in existing if provider.get("id")}
        added = 0
        updated = 0
        for raw in incoming:
            payload = deps._normalize_provider_trust(dict(raw), "verified")
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
        deps.save_providers(merged, path)
        return {"added": added, "updated": updated, "total": len(merged), "directory": sum(1 for item in merged if item.get("providerKind") == "directory")}


def load_providers(deps: Dependencies, store_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    if deps._should_use_sql_store(store_path, deps._default_provider_store_path):
        found, data = deps.load_collection("providers")
        if not found:
            return deps.apply_provider_presence_ttl(deps._default_providers())
        providers = data if isinstance(data, list) else deps._default_providers()
        return deps.apply_provider_presence_ttl([deps._normalize_provider_trust(provider, "verified") for provider in providers])

    path = store_path or deps._default_provider_store_path()
    if not path.exists():
        return deps.apply_provider_presence_ttl(deps._default_providers())
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
            providers = data if isinstance(data, list) else deps._default_providers()
            return deps.apply_provider_presence_ttl([deps._normalize_provider_trust(provider, "verified") for provider in providers])
    except json.JSONDecodeError:
        return deps.apply_provider_presence_ttl(deps._default_providers())


def save_providers(deps: Dependencies, providers: List[Dict[str, Any]], store_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    with deps.STORE_LOCK:
        path = store_path or deps._default_provider_store_path()
        cleaned_providers = []
        for provider in providers:
            payload = deps._normalize_provider_trust(provider)
            payload.pop("stale", None)
            cleaned_providers.append(payload)
        deps._write_json_atomic(path, cleaned_providers)
        return cleaned_providers


def get_provider_profile(deps: Dependencies, provider_id: str, store_path: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    if deps._should_use_sql_store(store_path, deps._default_provider_store_path):
        from bot.runtime_store import sql_get_provider

        found = sql_get_provider(str(provider_id))
        if found is None:
            return None
        payload = deps.apply_provider_presence_ttl([deps._normalize_provider_trust(found)])[0]
        payload.pop("stale", None)
        return payload

    for provider in deps.load_providers(store_path):
        if str(provider.get("id")) == str(provider_id):
            payload = deps._normalize_provider_trust(provider)
            payload.pop("stale", None)
            return payload
    return None


def build_empty_provider_profile_shell(deps: Dependencies, provider_id: str, store_path: Optional[Path] = None) -> Dict[str, Any]:
    """Minimal provider row for linked partners who have not saved a profile yet."""
    customer_store_path = store_path if store_path and store_path.name.lower() == "customers.json" else None
    customer_id = deps.resolve_customer_id_for_provider(provider_id, customer_store_path)
    if not customer_id and str(provider_id).startswith("provider-"):
        customer_id = str(provider_id)[len("provider-") :].strip()
    customer = deps.get_customer_profile(customer_id, customer_store_path) if customer_id else None
    name = str(customer.get("name") or "").strip() if customer else ""
    phone = str(customer.get("phone") or "").strip() if customer else ""
    city = str(customer.get("city") or "").strip() if customer else ""
    verification_status = (
        deps.normalize_verification_status(customer.get("verificationStatus"), "unverified") if customer else "unverified"
    )
    verification = {"phone": verification_status == "verified"} if customer else {}
    return deps._normalize_provider_trust({
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


def ensure_linked_provider_profile(deps: Dependencies,
    customer_id: str,
    store_path: Optional[Path] = None,
    customer_store_path: Optional[Path] = None,
) -> Optional[Dict[str, Any]]:
    """Persist a linked partner row from the customer account so Mini App duty/go-online works.

    Returning verified customers often have linkedProviderId but a missing SQL provider row.
    Without a persisted profile, the UI falls into empty registration or a blank map.
    """
    profile = deps.get_customer_profile(customer_id, customer_store_path)
    provider_id = deps.resolve_linked_provider_id(customer_id, profile)
    if not provider_id:
        return None

    existing = deps.get_provider_profile(provider_id, store_path)
    if existing and existing.get("registeredAt"):
        synced = deps.sync_linked_provider_phone_verification_from_customer(provider_id, store_path, customer_store_path)
        return synced or existing

    shell = deps.build_empty_provider_profile_shell(provider_id, customer_store_path or store_path)
    if existing:
        shell = {**shell, **existing, "id": provider_id}
        for key in ("name", "phone", "city"):
            if not str(shell.get(key) or "").strip() and str(existing.get(key) or "").strip():
                shell[key] = existing.get(key)

    name = str(shell.get("name") or "").strip()
    phone = str(shell.get("phone") or "").strip()
    verification = profile.get("verification") if isinstance(profile.get("verification"), dict) else {}
    customer_verified = (
        deps.normalize_verification_status(profile.get("verificationStatus"), "unverified") == "verified"
        or bool(verification.get("phone"))
    )
    roles = [str(item).strip() for item in (profile.get("rolesRegistered") or []) if str(item).strip()]
    returning_partner = "provider" in roles or bool(str(profile.get("linkedProviderId") or "").strip())
    preferred_provider = str(profile.get("preferredRole") or "").strip() == "provider"

    # Promote a verified linked customer into a usable duty profile (defaults for vehicle/services).
    if customer_verified and name and phone and (returning_partner or preferred_provider):
        now = deps._now_iso()
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
    shell = deps._normalize_provider_trust(shell)

    if deps._should_use_sql_store(store_path, deps._default_provider_store_path):
        persisted = deps.sql_upsert_provider(dict(shell))
        persisted.pop("stale", None)
    else:
        providers = deps.load_providers(store_path)
        replaced = False
        for index, provider in enumerate(providers):
            if str(provider.get("id")) != str(provider_id):
                continue
            providers[index] = shell
            replaced = True
            break
        if not replaced:
            providers.append(shell)
        deps.save_providers(providers, store_path)
        persisted = dict(shell)

    if not str(profile.get("linkedProviderId") or "").strip():
        try:
            deps.update_customer_profile(customer_id, {"linkedProviderId": provider_id}, customer_store_path)
        except ValueError:
            pass
    if persisted.get("registeredAt"):
        try:
            deps.mark_user_role_registered(customer_id, "provider", customer_store_path)
        except ValueError:
            pass
    return persisted


def submit_provider_verification(deps: Dependencies, provider_id: str, data: Dict[str, Any], store_path: Optional[Path] = None) -> Dict[str, Any]:
    with deps.STORE_LOCK:
        path = store_path or deps._default_provider_store_path()
        providers = deps.load_providers(path)
        now = deps._now_iso()
        updated: Optional[Dict[str, Any]] = None
        documents = data.get("documents") if isinstance(data.get("documents"), dict) else {}

        for index, provider in enumerate(providers):
            if str(provider.get("id")) != str(provider_id):
                continue
            provider.pop("stale", None)
            provider = deps._normalize_provider_trust(provider)
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
                verification[flag_key] = bool(verification.get(flag_key) or deps._truthy_flag(data.get(flag_key)) or deps._truthy_flag(ref_value))

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
            provider["trustedBadges"] = deps._verification_badges("pending", "provider")
            provider["updatedAt"] = now
            providers[index] = provider
            updated = provider
            break

        if updated is None:
            raise ValueError("provider profile not found")

        deps.save_providers(providers, path)
        return dict(updated)


def review_provider_verification(deps: Dependencies, provider_id: str, data: Dict[str, Any], store_path: Optional[Path] = None) -> Dict[str, Any]:
    with deps.STORE_LOCK:
        path = store_path or deps._default_provider_store_path()
        providers = deps.load_providers(path)
        now = deps._now_iso()
        status = deps.normalize_verification_status(data.get("status"), "")
        if status not in {"verified", "rejected"}:
            raise ValueError("verification status must be verified or rejected")

        updated: Optional[Dict[str, Any]] = None
        for index, provider in enumerate(providers):
            if str(provider.get("id")) != str(provider_id):
                continue
            provider.pop("stale", None)
            provider = deps._normalize_provider_trust(provider)
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
            provider["trustedBadges"] = deps._verification_badges(status, "provider")
            provider["updatedAt"] = now
            providers[index] = provider
            updated = provider
            break

        if updated is None:
            raise ValueError("provider profile not found")

        deps.save_providers(providers, path)
        return dict(updated)


def resolve_customer_id_for_provider(deps: Dependencies, provider_id: str, store_path: Optional[Path] = None) -> str:
    """Map provider-{customerId} (or linkedProviderId reverse lookup) back to the owning customer."""
    normalized = str(provider_id or "").strip()
    if not normalized:
        return ""
    if normalized.startswith("provider-"):
        suffix = normalized[len("provider-") :].strip()
        if suffix and deps.get_customer_profile(suffix, store_path) is not None:
            return suffix
    for profile in deps.load_customer_profiles(store_path):
        if str(profile.get("linkedProviderId") or "").strip() != normalized:
            continue
        customer_id = str(profile.get("id") or "").strip()
        if customer_id:
            return customer_id
    return ""


def find_registered_provider_by_phone(deps: Dependencies,
    phone: str,
    *,
    exclude_id: str | None = None,
    store_path: Optional[Path] = None,
    providers: Optional[List[Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    """Find another registered provider that already uses this phone."""
    target = deps._normalize_ukraine_phone_digits(phone)
    if not target or len(target) != 12:
        return None

    if providers is None and deps._should_use_sql_store(store_path, deps._default_provider_store_path):
        from bot.phone_lookup import phone_lookup_key

        lookup = phone_lookup_key(target)
        source = deps.sql_providers_by_phone_lookup(lookup) if lookup else []
    else:
        source = providers if providers is not None else deps.load_providers(store_path)

    for provider in source:
        provider_id = str(provider.get("id") or "")
        if exclude_id and provider_id == exclude_id:
            continue
        if not provider.get("registeredAt"):
            continue
        provider_phone = deps._normalize_ukraine_phone_digits(str(provider.get("phone") or ""))
        if provider_phone != target:
            continue
        name = str(provider.get("name") or "").strip()
        if not name:
            continue
        return dict(provider)
    return None


def _ensure_provider_phone_available(deps: Dependencies,
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
    target = deps._normalize_ukraine_phone_digits(phone_value)
    customer_id = deps.resolve_customer_id_for_provider(str(provider_id))
    if not customer_id and str(provider_id).startswith("provider-"):
        customer_id = str(provider_id)[len("provider-") :].strip()
    if customer_id:
        customer_profile = deps.get_customer_profile(customer_id, customer_store_path)
        customer_phone = deps._customer_profile_phone_digits(customer_profile)
        if customer_phone == target:
            return
    existing = deps.find_registered_provider_by_phone(
        phone_value,
        exclude_id=str(provider_id),
        providers=providers,
        store_path=provider_store_path,
    )
    if existing is not None:
        existing_customer_id = deps.resolve_customer_id_for_provider(str(existing.get("id") or ""))
        if customer_id and existing_customer_id:
            profiles = [
                deps.get_customer_profile(customer_id, customer_store_path),
                deps.get_customer_profile(existing_customer_id, customer_store_path),
            ]
            if deps._profiles_share_account(customer_id, existing_customer_id, profiles):
                return
        raise ValueError(deps.PHONE_ALREADY_REGISTERED)


def sync_linked_provider_phone_verification_from_customer(deps: Dependencies,
    provider_id: str,
    store_path: Optional[Path] = None,
    customer_store_path: Optional[Path] = None,
) -> Optional[Dict[str, Any]]:
    """Mirror verified client phone onto the linked partner cabinet without re-OTP."""
    provider = deps.get_provider_profile(provider_id, store_path)
    if provider is None or deps.is_provider_verified(provider):
        return provider
    customer_id = deps.resolve_customer_id_for_provider(str(provider_id))
    if not customer_id and str(provider_id).startswith("provider-"):
        customer_id = str(provider_id)[len("provider-") :].strip()
    if not customer_id:
        return provider
    profile = deps.get_customer_profile(customer_id, customer_store_path)
    if deps.normalize_verification_status(profile.get("verificationStatus"), "unverified") != "verified":
        return provider
    provider_phone = deps._normalize_ukraine_phone_digits(str(provider.get("phone") or ""))
    customer_phone = deps._customer_profile_phone_digits(profile)
    linked_by_id = str(provider_id) == f"provider-{customer_id}" or str(provider.get("id") or "") == f"provider-{customer_id}"
    if provider_phone and customer_phone and provider_phone != customer_phone and not linked_by_id:
        return provider
    return deps.verify_provider_phone_otp(provider_id, store_path)


def is_provider_profile_complete(deps: Dependencies, provider: Optional[Dict[str, Any]]) -> bool:
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
    specialties = deps._clean_provider_specialties(specialties)
    return bool(
        provider.get("registeredAt")
        and phone
        and vehicle
        and specialties
        and deps.is_valid_ukraine_plate(plate)
    )


def update_provider_profile(deps: Dependencies, provider_id: str, data: Dict[str, Any], store_path: Optional[Path] = None) -> Dict[str, Any]:
    now = deps._now_iso()
    specialties = deps._clean_provider_specialties(data.get("specialties"))
    if not specialties:
        raise ValueError("provider specialties must include at least one supported service")

    try:
        radius = int(data.get("serviceRadiusKm") or 15)
    except (TypeError, ValueError):
        radius = 15
    radius = max(1, min(radius, 100))

    use_sql = deps._should_use_sql_store(store_path, deps._default_provider_store_path)
    existing = deps.get_provider_profile(provider_id, store_path) if use_sql else None
    providers: Optional[List[Dict[str, Any]]] = None if use_sql else deps.load_providers(store_path)

    updated: Optional[Dict[str, Any]] = None
    if not use_sql and providers is not None:
        for index, provider in enumerate(providers):
            if str(provider.get("id")) != str(provider_id):
                continue

            provider.pop("stale", None)
            provider = deps._normalize_provider_trust(provider)
            provider["name"] = str(data.get("name") or provider.get("name") or "Партнер POMICH").strip()
            next_phone = str(data.get("phone") or provider.get("phone") or "").strip()
            deps._ensure_provider_phone_available(
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
        provider = deps._normalize_provider_trust(provider)
        provider["name"] = str(data.get("name") or provider.get("name") or "Партнер POMICH").strip()
        next_phone = str(data.get("phone") or provider.get("phone") or "").strip()
        deps._ensure_provider_phone_available(
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
        provider["plate"] = deps.normalize_ukraine_plate(str(data.get("plate") or provider.get("plate") or "").strip())
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
        if status not in deps.PROVIDER_STATUSES:
            raise ValueError("provider status must be online, busy or offline")
        if status in deps.PROVIDER_ACTIVE_STATUSES and not data.get("registeredAt"):
            raise ValueError("provider profile must be registered before going online")
        next_phone = str(data.get("phone") or "").strip()
        deps._ensure_provider_phone_available(
            provider_id,
            next_phone,
            providers,
            provider_store_path=store_path,
        )
        updated = deps._normalize_provider_trust({
            "id": str(provider_id),
            "name": str(data.get("name") or "Партнер POMICH").strip(),
            "rating": data.get("rating") or 4.8,
            "vehicle": str(data.get("vehicle") or "Автодопомога").strip(),
            "plate": deps.normalize_ukraine_plate(str(data.get("plate") or "").strip()),
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
        persisted = deps.sql_upsert_provider(dict(updated))
        persisted.pop("stale", None)
        updated = deps._normalize_provider_trust(persisted)
    else:
        assert providers is not None
        deps.save_providers(providers, store_path)

    customer_id = deps.resolve_customer_id_for_provider(str(provider_id))
    if not customer_id and str(provider_id).startswith("provider-"):
        candidate = str(provider_id)[len("provider-") :].strip()
        if candidate:
            customer_id = candidate
    if customer_id and updated is not None:
        try:
            if deps._should_use_sql_store(None, deps._default_customer_store_path):
                existing_customer = deps.sql_get_customer(str(customer_id)) or deps._default_customer_profile(customer_id)
                payload = deps._normalize_customer_profile(deps._decrypt_customer_record(existing_customer))
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
                if deps.is_customer_client_registered(payload) and "customer" not in roles:
                    roles.append("customer")
                payload["rolesRegistered"] = roles
                payload["profileCompleteness"] = deps._customer_profile_completeness(payload)
                payload["updatedAt"] = deps._now_iso()
                deps.sql_upsert_customer(deps._encrypt_customer_record(payload))
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
                deps.update_customer_profile(customer_id, patch)
                deps.mark_user_role_registered(customer_id, "provider")
                synced_profile = deps.get_customer_profile(customer_id)
                if deps.is_customer_client_registered(synced_profile):
                    roles = [str(item).strip() for item in (synced_profile.get("rolesRegistered") or []) if str(item).strip()]
                    if "customer" not in roles:
                        deps.update_customer_profile(
                            customer_id,
                            {"rolesRegistered": [*roles, "customer"], "preferredRole": "provider"},
                        )
        except Exception:
            pass

    try:
        synced = deps.sync_linked_provider_phone_verification_from_customer(str(provider_id), store_path)
    except Exception:
        synced = None
    return dict(synced or updated)


def update_provider_presence(deps: Dependencies, provider_id: str, data: Dict[str, Any], store_path: Optional[Path] = None) -> Dict[str, Any]:
    status = str(data.get("status") or "").strip()
    if status in deps.PROVIDER_ACTIVE_STATUSES:
        # Linked Mini App partners often hit presence before a SQL row is fully promoted.
        customer_id = deps.resolve_customer_id_for_provider(str(provider_id))
        if not customer_id and str(provider_id).startswith("provider-"):
            customer_id = str(provider_id)[len("provider-") :].strip()
        if customer_id:
            try:
                deps.ensure_linked_provider_profile(customer_id, store_path)
            except Exception:
                pass
        deps.sync_linked_provider_phone_verification_from_customer(str(provider_id), store_path)

    use_sql = deps._should_use_sql_store(store_path, deps._default_provider_store_path)
    now = deps._now_iso()
    updated: Optional[Dict[str, Any]] = None

    if use_sql:
        provider = deps.get_provider_profile(str(provider_id), store_path)
        providers = [dict(provider)] if provider else []
    else:
        providers = deps.load_providers(store_path)

    for index, provider in enumerate(providers):
        if str(provider.get("id")) != str(provider_id):
            continue
        provider.pop("stale", None)
        provider = deps._normalize_provider_trust(provider)
        status = str(data.get("status") or provider.get("status") or "offline")
        if status not in deps.PROVIDER_STATUSES:
            raise ValueError("provider status must be online, busy or offline")
        if status in deps.PROVIDER_ACTIVE_STATUSES and not provider.get("registeredAt"):
            raise ValueError("provider profile must be registered before going online")
        if status in deps.PROVIDER_ACTIVE_STATUSES and not deps.is_provider_profile_complete(provider):
            raise ValueError("provider profile must be complete before going online")
        if status in deps.PROVIDER_ACTIVE_STATUSES and not deps.is_provider_verified(provider):
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
        if status not in deps.PROVIDER_STATUSES:
            raise ValueError("provider status must be online, busy or offline")
        if status in deps.PROVIDER_ACTIVE_STATUSES and not data.get("registeredAt"):
            raise ValueError("provider profile must be registered before going online")
        candidate = deps._normalize_provider_trust({
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
        if status in deps.PROVIDER_ACTIVE_STATUSES and not deps.is_provider_profile_complete(candidate):
            raise ValueError("provider profile must be complete before going online")
        if status in deps.PROVIDER_ACTIVE_STATUSES and not deps.is_provider_verified(candidate):
            raise ValueError("provider verification must be approved before going online")
        updated = candidate
        providers.append(updated)

    if use_sql:
        persisted = deps.sql_upsert_provider(dict(updated))
        persisted.pop("stale", None)
        if persisted.get("status") == "online":
            deps.redispatch_searching_orders_for_provider(
                provider_id,
                provider_store_path=store_path,
            )
        return persisted

    deps.save_providers(providers, store_path)
    updated.pop("stale", None)
    if updated.get("status") == "online":
        deps.redispatch_searching_orders_for_provider(
            provider_id,
            provider_store_path=store_path,
        )
    return updated


def admin_update_provider_profile(deps: Dependencies, provider_id: str, data: Dict[str, Any], store_path: Optional[Path] = None) -> Dict[str, Any]:
    providers = deps.load_providers(store_path)
    now = deps._now_iso()
    updated: Optional[Dict[str, Any]] = None
    for index, provider in enumerate(providers):
        if str(provider.get("id")) != str(provider_id):
            continue
        provider.pop("stale", None)
        provider = deps._normalize_provider_trust(provider)
        for field in ("name", "phone", "telegram", "vehicle", "vehicleMake", "vehicleModel", "plate", "city", "address", "website", "openingHours", "accountStatus"):
            if data.get(field) is not None:
                provider[field] = str(data.get(field) or "").strip()
        if data.get("specialties") is not None:
            specialties = deps._clean_provider_specialties(data.get("specialties"))
            if specialties:
                provider["specialties"] = specialties
        if data.get("serviceRadiusKm") is not None:
            try:
                radius = int(data.get("serviceRadiusKm") or provider.get("serviceRadiusKm") or 15)
            except (TypeError, ValueError):
                radius = 15
            provider["serviceRadiusKm"] = max(1, min(radius, 100))
        if data.get("status") in deps.PROVIDER_STATUSES:
            provider["status"] = str(data.get("status"))
        if data.get("verificationStatus") is not None:
            status = deps.normalize_verification_status(data.get("verificationStatus"), provider.get("verificationStatus"))
            if status in deps.VERIFICATION_STATUSES:
                provider["verificationStatus"] = status
                provider["trustedBadges"] = deps._verification_badges(status, "provider")
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
    deps.save_providers(providers, store_path)
    return dict(updated)


def admin_delete_provider(deps: Dependencies, provider_id: str, store_path: Optional[Path] = None) -> Dict[str, Any]:
    with deps.STORE_LOCK:
        path = store_path or deps._default_provider_store_path()
        providers = deps.load_providers(path)
        remaining = [provider for provider in providers if str(provider.get("id")) != str(provider_id)]
        if len(remaining) == len(providers):
            raise ValueError("provider profile not found")
        deps.save_providers(remaining, path)
        return {"deleted": True, "providerId": str(provider_id)}
