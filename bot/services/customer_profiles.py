"""Customer profiles operations; no dependency on the compatibility facade."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional


@dataclass(frozen=True)
class Dependencies:
    PHONE_ALREADY_REGISTERED: Any
    STORE_LOCK: Any
    VERIFICATION_STATUSES: Any
    _claim_conflicting_guest_phone: Callable[..., Any]
    _clean_provider_specialties: Callable[..., Any]
    _clear_customer_phone: Callable[..., Any]
    _companion_provider_store_path: Callable[..., Any]
    _customer_display_name: Callable[..., Any]
    _customer_phone_alias_ids: Callable[..., Any]
    _customer_phone_exclude_ids: Callable[..., Any]
    _customer_profile_completeness: Callable[..., Any]
    _customer_profile_phone_digits: Callable[..., Any]
    _decrypt_customer_record: Callable[..., Any]
    _default_customer_profile: Callable[..., Any]
    _default_customer_store_path: Callable[..., Any]
    _encrypt_customer_record: Callable[..., Any]
    _ensure_customer_phone_available: Callable[..., Any]
    _mark_profile_phone_verified: Callable[..., Any]
    _maybe_persist_phone_linked_verification: Callable[..., Any]
    _normalize_customer_profile: Callable[..., Any]
    _normalize_ukraine_phone_digits: Callable[..., Any]
    _now_iso: Callable[..., Any]
    _profile_is_older_than: Callable[..., Any]
    _profiles_share_account: Callable[..., Any]
    _should_use_sql_store: Callable[..., Any]
    _sync_phone_linked_verification: Callable[..., Any]
    _truthy_flag: Callable[..., Any]
    _verification_badges: Callable[..., Any]
    _write_json_atomic: Callable[..., Any]
    build_user_account_status: Callable[..., Any]
    customer_admin_display_name: Callable[..., Any]
    decrypt_customer_profile: Any
    decrypt_field: Any
    encrypt_customer_profile: Any
    ensure_customer_client_from_linked_provider: Callable[..., Any]
    find_registered_customer_by_phone: Callable[..., Any]
    find_registered_provider_by_phone: Callable[..., Any]
    find_verified_customer_by_phone: Callable[..., Any]
    get_customer_profile: Callable[..., Any]
    get_provider_profile: Callable[..., Any]
    is_customer_client_registered: Callable[..., Any]
    is_customer_provider_registered: Callable[..., Any]
    is_encrypted_value: Any
    is_guest_customer_id: Callable[..., Any]
    is_provider_verified: Callable[..., Any]
    is_real_customer_profile: Callable[..., Any]
    load_collection: Any
    load_customer_profiles: Callable[..., Any]
    load_orders: Callable[..., Any]
    mark_user_role_registered: Callable[..., Any]
    normalize_verification_status: Callable[..., Any]
    prepare_customer_profile_for_admin: Callable[..., Any]
    rebind_customer_orders: Callable[..., Any]
    resolve_customer_id_for_provider: Callable[..., Any]
    resolve_linked_provider_id: Callable[..., Any]
    resolve_provider_telegram_user_id: Callable[..., Any]
    save_customer_profiles: Callable[..., Any]
    sql_customers_by_phone_lookup: Any
    sql_get_customer: Any
    sql_upsert_customer: Any
    submit_customer_verification: Callable[..., Any]
    update_customer_profile: Callable[..., Any]


def _default_customer_profile(deps: Dependencies, customer_id: str, timestamp: str | None = None) -> Dict[str, Any]:
    now = timestamp or deps._now_iso()
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
        "trustedBadges": deps._verification_badges("unverified", "customer"),
        "createdAt": now,
        "updatedAt": now,
    }


def _customer_profile_completeness(deps: Dependencies, profile: Dict[str, Any]) -> int:
    checks = [
        bool(str(profile.get("name") or "").strip()),
        bool(str(profile.get("phone") or "").strip()),
        bool(str(profile.get("email") or "").strip()),
        bool(str(profile.get("city") or "").strip()),
        bool(str(profile.get("telegram") or "").strip()),
    ]
    return round(sum(1 for item in checks if item) / len(checks) * 100)


def _normalize_customer_profile(deps: Dependencies, profile: Dict[str, Any]) -> Dict[str, Any]:
    payload = {**deps._default_customer_profile(str(profile.get("id") or "customer-web")), **profile}
    status = deps.normalize_verification_status(payload.get("verificationStatus"), "unverified")
    existing = payload.get("verification") if isinstance(payload.get("verification"), dict) else {}
    payload["verificationStatus"] = status
    payload["verification"] = {**deps._default_customer_profile(str(payload.get("id"))).get("verification", {}), **existing}
    payload["trustedBadges"] = payload.get("trustedBadges") if isinstance(payload.get("trustedBadges"), list) else deps._verification_badges(status, "customer")
    payload["profileCompleteness"] = deps._customer_profile_completeness(payload)
    roles = payload.get("rolesRegistered")
    payload["rolesRegistered"] = [str(item).strip() for item in roles if str(item).strip()] if isinstance(roles, list) else []
    payload["preferredRole"] = str(payload.get("preferredRole") or "").strip()
    payload["linkedProviderId"] = str(payload.get("linkedProviderId") or "").strip()
    bot_kind = str(payload.get("telegramBotKind") or "").strip()
    payload["telegramBotKind"] = bot_kind if bot_kind in {"customer", "provider"} else ""
    channel = str(payload.get("telegramNotificationChannel") or payload.get("telegramBotKind") or "").strip()
    payload["telegramNotificationChannel"] = channel if channel in {"customer", "provider"} else ""
    return payload


def _decrypt_customer_record(deps: Dependencies, profile: Dict[str, Any]) -> Dict[str, Any]:
    return deps._normalize_customer_profile(deps.decrypt_customer_profile(profile))


def _encrypt_customer_record(deps: Dependencies, profile: Dict[str, Any]) -> Dict[str, Any]:
    return deps.encrypt_customer_profile(deps._normalize_customer_profile(profile))


def load_customer_profiles(deps: Dependencies, store_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    if deps._should_use_sql_store(store_path, deps._default_customer_store_path):
        found, data = deps.load_collection("customers")
        return [deps._decrypt_customer_record(profile) for profile in data] if found and isinstance(data, list) else []

    path = store_path or deps._default_customer_store_path()
    if not path.exists():
        return []
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
            return [deps._decrypt_customer_record(profile) for profile in data] if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []


def save_customer_profiles(deps: Dependencies, profiles: List[Dict[str, Any]], store_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    with deps.STORE_LOCK:
        path = store_path or deps._default_customer_store_path()
        cleaned_profiles = [deps._encrypt_customer_record(profile) for profile in profiles]
        deps._write_json_atomic(path, cleaned_profiles)
        return [deps._decrypt_customer_record(profile) for profile in cleaned_profiles]


def get_customer_profile(deps: Dependencies, customer_id: str, store_path: Optional[Path] = None) -> Dict[str, Any]:
    if deps._should_use_sql_store(store_path, deps._default_customer_store_path):
        found = deps.sql_get_customer(str(customer_id))
        if found is not None:
            return deps._maybe_persist_phone_linked_verification(
                deps._normalize_customer_profile(deps._decrypt_customer_record(found)),
                store_path,
            )
        return deps._sync_phone_linked_verification(deps._default_customer_profile(customer_id), store_path)

    for profile in deps.load_customer_profiles(store_path):
        if str(profile.get("id")) == str(customer_id):
            return deps._maybe_persist_phone_linked_verification(deps._normalize_customer_profile(profile), store_path)
    return deps._sync_phone_linked_verification(deps._default_customer_profile(customer_id), store_path)


def customer_profile_exists(deps: Dependencies, customer_id: str, store_path: Optional[Path] = None) -> bool:
    """True only when a row was actually persisted — unlike get_customer_profile, which synthesizes defaults."""
    normalized = str(customer_id or "").strip()
    if not normalized:
        return False
    if deps._should_use_sql_store(store_path, deps._default_customer_store_path):
        return deps.sql_get_customer(normalized) is not None
    return any(str(profile.get("id")) == normalized for profile in deps.load_customer_profiles(store_path))


def update_customer_profile(deps: Dependencies, customer_id: str, data: Dict[str, Any], store_path: Optional[Path] = None) -> Dict[str, Any]:
    with deps.STORE_LOCK:
        path = store_path or deps._default_customer_store_path()
        profiles = deps.load_customer_profiles(path)
        now = deps._now_iso()
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
            payload = deps._normalize_customer_profile(profile)
            previous_phone_digits = deps._customer_profile_phone_digits(payload)
            for field in editable_fields:
                if data.get(field) is not None:
                    if field == "rolesRegistered" and isinstance(data.get(field), list):
                        payload[field] = [str(item).strip() for item in data.get(field) if str(item).strip()]
                    else:
                        payload[field] = str(data.get(field) or "").strip()
            if data.get("phone") is not None:
                next_phone_digits = deps._customer_profile_phone_digits(payload)
                if next_phone_digits != previous_phone_digits:
                    deps._ensure_customer_phone_available(customer_id, str(payload.get("phone") or ""), profiles, path)
            payload["updatedAt"] = now
            payload["profileCompleteness"] = deps._customer_profile_completeness(payload)
            profiles[index] = payload
            updated = payload
            break

        if updated is None:
            payload = deps._default_customer_profile(customer_id, now)
            for field in editable_fields:
                if data.get(field) is not None:
                    if field == "rolesRegistered" and isinstance(data.get(field), list):
                        payload[field] = [str(item).strip() for item in data.get(field) if str(item).strip()]
                    else:
                        payload[field] = str(data.get(field) or "").strip()
            if data.get("phone") is not None:
                deps._ensure_customer_phone_available(customer_id, str(payload.get("phone") or ""), profiles, path)
            payload["profileCompleteness"] = deps._customer_profile_completeness(payload)
            profiles.append(payload)
            updated = payload

        deps.save_customer_profiles(profiles, path)
        return deps._maybe_persist_phone_linked_verification(dict(updated), path)


def upsert_telegram_customer_profile(deps: Dependencies,
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

    with deps.STORE_LOCK:
        path = store_path or deps._default_customer_store_path()
        profiles = deps.load_customer_profiles(path)
        now = deps._now_iso()
        updated: Optional[Dict[str, Any]] = None
        display_name = str(user.get("first_name") or "").strip()
        last_name = str(user.get("last_name") or "").strip()
        if last_name:
            display_name = f"{display_name} {last_name}".strip()

        for index, profile in enumerate(profiles):
            if str(profile.get("id")) != customer_id:
                continue
            payload = deps._normalize_customer_profile(profile)
            updated = payload
            profiles[index] = payload
            break

        if updated is None:
            updated = deps._default_customer_profile(customer_id, now)
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
        updated["profileCompleteness"] = deps._customer_profile_completeness(updated)

        deps.save_customer_profiles(profiles, path)
        return dict(updated)


def _customer_display_name(deps: Dependencies, profile: Dict[str, Any]) -> str:
    name = str(profile.get("name") or "").strip()
    if deps.is_encrypted_value(name):
        name = deps.decrypt_field(name).strip()
    if name and name != "Клієнт POMICH":
        return name
    return ""


def is_guest_customer_id(deps: Dependencies, customer_id: str) -> bool:
    normalized = str(customer_id or "").strip()
    return normalized == "customer-web" or normalized.startswith("guest-")


def is_real_customer_profile(deps: Dependencies, profile: Dict[str, Any]) -> bool:
    customer_id = str(profile.get("id") or "").strip()
    if deps.is_customer_client_registered(profile):
        return True
    if str(profile.get("phone") or "").strip():
        return True
    if customer_id.startswith("tg-"):
        if deps._customer_display_name(profile) or str(profile.get("telegram") or "").strip():
            return True
    return not deps.is_guest_customer_id(customer_id)


def customer_admin_display_name(deps: Dependencies, profile: Dict[str, Any]) -> str:
    name = deps._customer_display_name(profile)
    if name:
        return name
    customer_id = str(profile.get("id") or "").strip()
    if customer_id.startswith("tg-"):
        telegram = str(profile.get("telegram") or "").strip().lstrip("@")
        if telegram:
            return f"@{telegram}"
        suffix = customer_id.removeprefix("tg-")
        return f"Telegram {suffix}" if suffix else "Telegram"
    if deps.is_guest_customer_id(customer_id):
        short_id = customer_id.removeprefix("guest-")[:8]
        return f"Гість {short_id}" if short_id else "Гість"
    return customer_id or "Клієнт"


def prepare_customer_profile_for_admin(deps: Dependencies, profile: Dict[str, Any]) -> Dict[str, Any]:
    payload = dict(deps._decrypt_customer_record(profile))
    payload["clientRegistered"] = deps.is_customer_client_registered(payload)
    payload["isGuestSession"] = deps.is_guest_customer_id(str(payload.get("id") or ""))
    payload["displayName"] = deps.customer_admin_display_name(payload)
    return payload


def list_admin_customer_profiles(deps: Dependencies,
    include_guests: bool = False,
    query: str | None = None,
    store_path: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    clients = [deps.prepare_customer_profile_for_admin(profile) for profile in deps.load_customer_profiles(store_path)]
    if not include_guests:
        clients = [client for client in clients if deps.is_real_customer_profile(client)]
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


def _profile_is_older_than(deps: Dependencies, profile: Dict[str, Any], threshold: datetime) -> bool:
    raw = str(profile.get("updatedAt") or profile.get("createdAt") or "").strip()
    if not raw:
        return False
    normalized = raw.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(normalized) < threshold
    except ValueError:
        return raw[:19] < threshold.isoformat(timespec="seconds")


def purge_stale_guest_customers(deps: Dependencies,
    days: int = 7,
    store_path: Optional[Path] = None,
    order_store_path: Optional[Path] = None,
) -> Dict[str, Any]:
    threshold = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=max(1, int(days)))
    orders = deps.load_orders(order_store_path)
    customer_ids_with_orders = {
        str(order.get("customerId") or order.get("customer_id") or "").strip()
        for order in orders
        if str(order.get("customerId") or order.get("customer_id") or "").strip()
    }

    with deps.STORE_LOCK:
        path = store_path or deps._default_customer_store_path()
        profiles = deps.load_customer_profiles(path)
        kept: List[Dict[str, Any]] = []
        removed_ids: List[str] = []
        for profile in profiles:
            customer_id = str(profile.get("id") or "").strip()
            if not deps.is_guest_customer_id(customer_id):
                kept.append(profile)
                continue
            if customer_id in customer_ids_with_orders:
                kept.append(profile)
                continue
            if deps.is_real_customer_profile(profile):
                kept.append(profile)
                continue
            if not deps._profile_is_older_than(profile, threshold):
                kept.append(profile)
                continue
            removed_ids.append(customer_id)

        deps.save_customer_profiles(kept, path)
        return {"deleted": len(removed_ids), "customerIds": removed_ids, "remaining": len(kept)}


def is_customer_client_registered(deps: Dependencies, profile: Dict[str, Any]) -> bool:
    name = deps._customer_display_name(profile)
    phone = str(profile.get("phone") or "").strip()
    return bool(name and phone)


def _normalize_ukraine_phone_digits(deps: Dependencies, phone: str) -> str:
    digits = "".join(ch for ch in str(phone or "") if ch.isdigit())
    if digits.startswith("380") and len(digits) == 12:
        return digits
    if digits.startswith("0") and len(digits) == 10:
        return f"380{digits[1:]}"
    if len(digits) == 9:
        return f"380{digits}"
    return digits


def _customer_profile_phone_digits(deps: Dependencies, profile: Dict[str, Any]) -> str:
    phone = str(profile.get("phone") or "").strip()
    if deps.is_encrypted_value(phone):
        phone = deps.decrypt_field(phone).strip()
    return deps._normalize_ukraine_phone_digits(phone)


def find_telegram_user_id_by_phone(deps: Dependencies, phone: str, store_path: Optional[Path] = None) -> Optional[str]:
    """Resolve Telegram user id from a tg-{id} profile or registered provider with the same phone."""
    target = deps._normalize_ukraine_phone_digits(phone)
    if not target or len(target) != 12:
        return None
    for profile in deps.load_customer_profiles(store_path):
        customer_id = str(profile.get("id") or "")
        if not customer_id.startswith("tg-"):
            continue
        if deps._customer_profile_phone_digits(profile) != target:
            continue
        verification = profile.get("verification") if isinstance(profile.get("verification"), dict) else {}
        telegram_user_id = str(verification.get("telegramUserId") or customer_id[3:]).strip()
        return telegram_user_id or None
    # Partner cabinet may hold the working phone while the tg-* row keeps another number.
    provider = deps.find_registered_provider_by_phone(phone)
    if provider:
        return deps.resolve_provider_telegram_user_id(
            str(provider.get("id") or ""),
            customer_store_path=store_path,
        )
    return None


def find_verified_customer_by_phone(deps: Dependencies,
    phone: str,
    *,
    exclude_id: str | None = None,
    store_path: Optional[Path] = None,
) -> Optional[Dict[str, Any]]:
    """Find a verified customer profile with the same phone (prefers tg-* canonical rows)."""
    target = deps._normalize_ukraine_phone_digits(phone)
    if not target or len(target) != 12:
        return None
    candidates: List[Dict[str, Any]] = []
    for profile in deps.load_customer_profiles(store_path):
        customer_id = str(profile.get("id") or "")
        if exclude_id and customer_id == exclude_id:
            continue
        if deps._customer_profile_phone_digits(profile) != target:
            continue
        normalized = deps._normalize_customer_profile(profile)
        if deps.normalize_verification_status(normalized.get("verificationStatus"), "unverified") != "verified":
            continue
        candidates.append(normalized)
    if not candidates:
        return None
    tg_candidates = [item for item in candidates if str(item.get("id") or "").startswith("tg-")]
    return tg_candidates[0] if tg_candidates else candidates[0]


def _customer_phone_alias_ids(deps: Dependencies, customer_id: str, profiles: List[Dict[str, Any]]) -> set[str]:
    """All customer rows that share the same phone as this profile (guest/tg duplicates)."""
    needle = str(customer_id or "").strip()
    ids: set[str] = {needle} if needle else set()
    if not needle:
        return ids
    profile = next((item for item in profiles if str(item.get("id") or "") == needle), None)
    if profile is None:
        return ids
    phone_digits = deps._customer_profile_phone_digits(profile)
    if not phone_digits or len(phone_digits) != 12:
        return ids
    for other in profiles:
        other_id = str(other.get("id") or "").strip()
        if not other_id or other_id in ids:
            continue
        if deps._customer_profile_phone_digits(other) == phone_digits:
            ids.add(other_id)
    return ids


def find_registered_customer_by_phone(deps: Dependencies,
    phone: str,
    *,
    exclude_id: str | None = None,
    exclude_ids: set[str] | None = None,
    store_path: Optional[Path] = None,
    profiles: Optional[List[Dict[str, Any]]] = None,
) -> Optional[Dict[str, Any]]:
    """Find a registered customer profile with the same phone (prefers tg-* canonical rows)."""
    target = deps._normalize_ukraine_phone_digits(phone)
    if not target or len(target) != 12:
        return None
    excluded = set(exclude_ids or [])
    if exclude_id:
        excluded.add(str(exclude_id))

    if profiles is None and deps._should_use_sql_store(store_path, deps._default_customer_store_path):
        from bot.phone_lookup import phone_lookup_key

        lookup = phone_lookup_key(target)
        if lookup:
            source = [
                deps._normalize_customer_profile(deps._decrypt_customer_record(item))
                for item in deps.sql_customers_by_phone_lookup(lookup)
            ]
        else:
            source = []
    else:
        source = profiles if profiles is not None else deps.load_customer_profiles(store_path)

    candidates: List[Dict[str, Any]] = []
    for profile in source:
        customer_id = str(profile.get("id") or "")
        if customer_id in excluded:
            continue
        if deps._customer_profile_phone_digits(profile) != target:
            continue
        normalized = deps._normalize_customer_profile(profile)
        if not deps.is_customer_client_registered(normalized):
            continue
        candidates.append(normalized)
    # Prefer the Telegram owner of a partner cabinet that uses this phone
    # (guest web rows often hold the same number without a chat_id).
    provider_lookup_path = deps._companion_provider_store_path(store_path) if store_path is not None else store_path
    provider = deps.find_registered_provider_by_phone(phone, store_path=provider_lookup_path)
    if provider is not None:
        telegram_user_id = deps.resolve_provider_telegram_user_id(
            str(provider.get("id") or ""),
            customer_store_path=store_path,
        )
        if telegram_user_id:
            preferred_id = f"tg-{telegram_user_id}"
            if preferred_id not in excluded:
                preferred: Optional[Dict[str, Any]] = None
                if profiles is None and deps._should_use_sql_store(store_path, deps._default_customer_store_path):
                    raw = deps.sql_get_customer(preferred_id)
                    if raw is not None:
                        preferred = deps._normalize_customer_profile(deps._decrypt_customer_record(raw))
                else:
                    for profile in source:
                        if str(profile.get("id") or "") != preferred_id:
                            continue
                        preferred = deps._normalize_customer_profile(profile)
                        break
                if preferred is not None:
                    if deps.is_customer_client_registered(preferred) or str(preferred.get("phone") or "").strip():
                        return preferred
        # Web/guest partner: restore the customer row that owns provider-{customerId}.
        linked_customer_id = deps.resolve_customer_id_for_provider(str(provider.get("id") or ""), store_path)
        if linked_customer_id and linked_customer_id not in excluded:
            linked_profile = deps.get_customer_profile(linked_customer_id, store_path)
            if linked_profile is not None:
                return deps._normalize_customer_profile(linked_profile)
    if not candidates:
        return None
    tg_candidates = [item for item in candidates if str(item.get("id") or "").startswith("tg-")]
    return tg_candidates[0] if tg_candidates else candidates[0]


def _profiles_share_account(deps: Dependencies,
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
    if right in deps._customer_phone_alias_ids(left, profiles):
        return True
    if left in deps._customer_phone_alias_ids(right, profiles):
        return True
    left_profile = next((item for item in profiles if str(item.get("id") or "") == left), None)
    right_profile = next((item for item in profiles if str(item.get("id") or "") == right), None)
    left_provider = deps.resolve_linked_provider_id(left, left_profile)
    right_provider = deps.resolve_linked_provider_id(right, right_profile)
    if left_provider and right_provider and left_provider == right_provider:
        return True
    if left_provider and right == deps.resolve_customer_id_for_provider(left_provider):
        return True
    if right_provider and left == deps.resolve_customer_id_for_provider(right_provider):
        return True
    return False


def _customer_phone_exclude_ids(deps: Dependencies,
    customer_id: str,
    phone: str,
    profiles: List[Dict[str, Any]],
) -> set[str]:
    """Customer rows that may reuse this phone for the same authenticated account."""
    excluded = deps._customer_phone_alias_ids(customer_id, profiles)
    target = deps._normalize_ukraine_phone_digits(phone)
    if not target or len(target) != 12:
        return excluded
    for profile in profiles:
        profile_id = str(profile.get("id") or "").strip()
        if not profile_id or profile_id in excluded:
            continue
        if deps._customer_profile_phone_digits(profile) != target:
            continue
        if deps._profiles_share_account(profile_id, customer_id, profiles):
            excluded.add(profile_id)
    return excluded


def _companion_provider_store_path(deps: Dependencies, customer_store_path: Optional[Path]) -> Optional[Path]:
    if customer_store_path is None:
        return None
    name = customer_store_path.name.lower()
    if name == "customers.json":
        return customer_store_path.with_name("providers.json")
    return customer_store_path


def _ensure_customer_phone_available(deps: Dependencies,
    customer_id: str,
    phone: str,
    profiles: List[Dict[str, Any]],
    store_path: Optional[Path] = None,
) -> None:
    phone_value = str(phone or "").strip()
    if not phone_value:
        return
    target = deps._normalize_ukraine_phone_digits(phone_value)
    profile = next((item for item in profiles if str(item.get("id") or "") == str(customer_id)), None)
    linked_provider_id = deps.resolve_linked_provider_id(str(customer_id), profile)
    if not linked_provider_id and str(customer_id).startswith("tg-"):
        linked_provider_id = f"provider-{customer_id}"
    provider_store_path = deps._companion_provider_store_path(store_path)
    own_provider = deps.get_provider_profile(linked_provider_id, provider_store_path) if linked_provider_id else None
    # Own partner cabinet may already hold this phone (including when a tg-* duplicate exists).
    if own_provider is not None and own_provider.get("registeredAt"):
        own_provider_phone = deps._normalize_ukraine_phone_digits(str(own_provider.get("phone") or ""))
        if own_provider_phone == target:
            return
    existing = deps.find_registered_customer_by_phone(
        phone_value,
        exclude_ids=deps._customer_phone_exclude_ids(customer_id, phone_value, profiles),
        profiles=profiles,
        store_path=store_path,
    )
    if existing is not None:
        existing_id = str(existing.get("id") or "")
        if deps._profiles_share_account(existing_id, customer_id, profiles):
            return
        raise ValueError(deps.PHONE_ALREADY_REGISTERED)


def _mark_profile_phone_verified(deps: Dependencies,
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
    payload["trustedBadges"] = payload.get("trustedBadges") or deps._verification_badges("verified", "customer")
    if linked_provider_id and not str(payload.get("linkedProviderId") or "").strip():
        payload["linkedProviderId"] = linked_provider_id
    payload["updatedAt"] = deps._now_iso()
    return payload


def _sync_phone_linked_verification(deps: Dependencies,
    profile: Dict[str, Any],
    store_path: Optional[Path] = None,
) -> Dict[str, Any]:
    """Inherit verified status from another profile/provider with the same phone or linked cabinet."""
    if deps.normalize_verification_status(profile.get("verificationStatus"), "unverified") == "verified":
        return profile

    customer_id = str(profile.get("id") or "").strip()
    linked_provider_id = str(profile.get("linkedProviderId") or "").strip()
    if not linked_provider_id and customer_id.startswith("tg-"):
        linked_provider_id = f"provider-{customer_id}"
    if linked_provider_id:
        # Provider rows live in the provider store; never reuse the customer store_path here.
        linked_provider = deps.get_provider_profile(linked_provider_id)
        if linked_provider and deps.is_provider_verified(linked_provider):
            return deps._mark_profile_phone_verified(
                profile,
                source_verification=linked_provider.get("verification")
                if isinstance(linked_provider.get("verification"), dict)
                else None,
                linked_provider_id=linked_provider_id,
            )

    phone = str(profile.get("phone") or "").strip()
    if not phone:
        return profile
    linked = deps.find_verified_customer_by_phone(
        phone,
        exclude_id=customer_id,
        store_path=store_path,
    )
    if linked is not None:
        return deps._mark_profile_phone_verified(
            profile,
            source_verification=linked.get("verification") if isinstance(linked.get("verification"), dict) else None,
            linked_provider_id=str(linked.get("linkedProviderId") or "").strip(),
        )

    provider = deps.find_registered_provider_by_phone(phone)
    if provider is not None and deps.is_provider_verified(provider):
        return deps._mark_profile_phone_verified(
            profile,
            source_verification=provider.get("verification") if isinstance(provider.get("verification"), dict) else None,
            linked_provider_id=str(provider.get("id") or "").strip(),
        )
    return profile


def _maybe_persist_phone_linked_verification(deps: Dependencies,
    profile: Dict[str, Any],
    store_path: Optional[Path] = None,
) -> Dict[str, Any]:
    synced = deps._sync_phone_linked_verification(profile, store_path)
    if deps.normalize_verification_status(synced.get("verificationStatus"), "unverified") == deps.normalize_verification_status(
        profile.get("verificationStatus"), "unverified"
    ):
        return synced
    customer_id = str(profile.get("id") or "")
    if not customer_id:
        return synced
    if deps._should_use_sql_store(store_path, deps._default_customer_store_path):
        deps.sql_upsert_customer(deps._encrypt_customer_record(synced))
        return synced
    with deps.STORE_LOCK:
        path = store_path or deps._default_customer_store_path()
        profiles = deps.load_customer_profiles(path)
        for index, item in enumerate(profiles):
            if str(item.get("id")) != customer_id:
                continue
            profiles[index] = synced
            deps.save_customer_profiles(profiles, path)
            break
    return synced


def _is_valid_ukraine_mobile_phone(deps: Dependencies, phone: str) -> bool:
    digits = deps._normalize_ukraine_phone_digits(phone)
    if not digits.startswith("380") or len(digits) != 12:
        return False
    national = digits[3:]
    return len(national) == 9 and national[:2] in {"39", "50", "63", "66", "67", "68", "73", "75", "91", "92", "93", "94", "95", "96", "97", "98", "99"}


def resolve_linked_provider_id(deps: Dependencies, customer_id: str, profile: Dict[str, Any] | None = None) -> str:
    payload = profile or deps.get_customer_profile(customer_id)
    linked = str(payload.get("linkedProviderId") or "").strip()
    if linked:
        return linked
    normalized_customer_id = str(customer_id or "").strip()
    if normalized_customer_id and normalized_customer_id not in {"", "customer-web"}:
        return f"provider-{normalized_customer_id}"
    return ""


def is_customer_provider_registered(deps: Dependencies, customer_id: str, store_path: Optional[Path] = None) -> bool:
    profile = deps.get_customer_profile(customer_id, store_path)
    provider_id = deps.resolve_linked_provider_id(customer_id, profile)
    if not provider_id:
        return False
    provider = deps.get_provider_profile(provider_id, store_path)
    if provider is None:
        return False
    name = str(provider.get("name") or "").strip()
    phone = str(provider.get("phone") or "").strip()
    vehicle = str(provider.get("vehicle") or "").strip()
    specialties = provider.get("specialties") if isinstance(provider.get("specialties"), list) else []
    specialties = deps._clean_provider_specialties(specialties)
    # Account-level "has partner role" — presence/go-online still requires is_provider_profile_complete (plate).
    return bool(provider.get("registeredAt") and name and phone and vehicle and specialties)


def build_user_account_status(deps: Dependencies, customer_id: str, store_path: Optional[Path] = None) -> Dict[str, Any]:
    profile = deps.get_customer_profile(customer_id, store_path)
    provider_id = deps.resolve_linked_provider_id(customer_id, profile)
    client_registered = deps.is_customer_client_registered(profile)
    provider_registered = deps.is_customer_provider_registered(customer_id, store_path)
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


def ensure_customer_client_from_linked_provider(deps: Dependencies,
    customer_id: str,
    store_path: Optional[Path] = None,
) -> Dict[str, Any]:
    """Hydrate customer name/phone from linked partner so role switch does not re-ask registration."""
    profile = deps.get_customer_profile(customer_id, store_path)
    if deps.is_customer_client_registered(profile):
        roles = [str(item).strip() for item in (profile.get("rolesRegistered") or []) if str(item).strip()]
        if "customer" not in roles:
            preferred = str(profile.get("preferredRole") or "").strip()
            patch: Dict[str, Any] = {"rolesRegistered": [*roles, "customer"]}
            if preferred in {"customer", "provider"}:
                patch["preferredRole"] = preferred
            deps.update_customer_profile(customer_id, patch, store_path)
        deps._maybe_persist_phone_linked_verification(deps.get_customer_profile(customer_id, store_path), store_path)
        phone = str((deps.get_customer_profile(customer_id, store_path) or {}).get("phone") or "").strip()
        if phone:
            deps._claim_conflicting_guest_phone(customer_id, phone, store_path)
        return deps.build_user_account_status(customer_id, store_path)

    provider_id = deps.resolve_linked_provider_id(customer_id, profile)
    provider = deps.get_provider_profile(provider_id) if provider_id else None
    if provider is None:
        return deps.build_user_account_status(customer_id, store_path)

    name = str(provider.get("name") or "").strip()
    phone = str(provider.get("phone") or "").strip()
    if not name or not phone:
        return deps.build_user_account_status(customer_id, store_path)

    patch: Dict[str, Any] = {
        "name": name,
        "phone": phone,
        "linkedProviderId": str(provider_id),
    }
    city = str(provider.get("city") or "").strip()
    if city:
        patch["city"] = city
    try:
        deps.update_customer_profile(customer_id, patch, store_path)
        deps.mark_user_role_registered(customer_id, "customer", store_path)
        deps._maybe_persist_phone_linked_verification(deps.get_customer_profile(customer_id, store_path), store_path)
        # Fold guest duplicates that share the partner phone into the canonical tg-* row.
        deps._claim_conflicting_guest_phone(customer_id, phone, store_path)
    except ValueError as exc:
        claimed = False
        if str(exc) == deps.PHONE_ALREADY_REGISTERED:
            claimed = deps._claim_conflicting_guest_phone(customer_id, phone, store_path)
            if claimed:
                try:
                    deps.update_customer_profile(customer_id, patch, store_path)
                    deps.mark_user_role_registered(customer_id, "customer", store_path)
                    deps._maybe_persist_phone_linked_verification(deps.get_customer_profile(customer_id, store_path), store_path)
                    claimed = True
                except ValueError:
                    claimed = False
        if not claimed:
            # Phone still conflicted (another tg-* row) — keep role UX, expand history via provider phone.
            try:
                soft_patch: Dict[str, Any] = {
                    "name": name,
                    "linkedProviderId": str(provider_id),
                }
                if city:
                    soft_patch["city"] = city
                deps.update_customer_profile(customer_id, soft_patch, store_path)
                deps.mark_user_role_registered(customer_id, "customer", store_path)
            except ValueError:
                pass

    status = deps.build_user_account_status(customer_id, store_path)
    profile = dict(status.get("profile") or {})
    if name and (
        not str(profile.get("name") or "").strip()
        or str(profile.get("name") or "").strip() == "Клієнт POMICH"
    ):
        profile["name"] = name
    if phone and not str(profile.get("phone") or "").strip():
        # Surface partner phone to the client UI even when it could not be persisted.
        profile["phone"] = phone
    if city and not str(profile.get("city") or "").strip():
        profile["city"] = city
    profile["id"] = str(profile.get("id") or customer_id)
    status["profile"] = profile
    if name and phone:
        roles = [str(item).strip() for item in (status.get("rolesRegistered") or []) if str(item).strip()]
        if "customer" not in roles:
            roles.append("customer")
        status["rolesRegistered"] = roles
        status["clientRegistered"] = True
        status["needsOnboarding"] = False
    return status


def set_user_preferred_role(deps: Dependencies, customer_id: str, role: str, store_path: Optional[Path] = None) -> Dict[str, Any]:
    normalized_role = str(role or "").strip()
    if normalized_role not in {"customer", "provider"}:
        raise ValueError("preferred role must be customer or provider")
    profile = deps.update_customer_profile(customer_id, {"preferredRole": normalized_role}, store_path)
    if normalized_role == "provider":
        provider_id = deps.resolve_linked_provider_id(customer_id, profile)
        if provider_id and not str(profile.get("linkedProviderId") or "").strip():
            profile = deps.update_customer_profile(customer_id, {"linkedProviderId": provider_id}, store_path)
    elif normalized_role == "customer":
        # Partner → client: reuse partner name/phone instead of empty «Реєстрація клієнта».
        return deps.ensure_customer_client_from_linked_provider(customer_id, store_path)
    return deps.build_user_account_status(customer_id, store_path)


def mark_user_role_registered(deps: Dependencies, customer_id: str, role: str, store_path: Optional[Path] = None) -> Dict[str, Any]:
    normalized_role = str(role or "").strip()
    if normalized_role not in {"customer", "provider"}:
        raise ValueError("role must be customer or provider")
    profile = deps.get_customer_profile(customer_id, store_path)
    roles = [str(item).strip() for item in (profile.get("rolesRegistered") or []) if str(item).strip()]
    if normalized_role not in roles:
        roles.append(normalized_role)
    patch: Dict[str, Any] = {"rolesRegistered": roles, "preferredRole": normalized_role}
    if normalized_role == "provider":
        patch["linkedProviderId"] = deps.resolve_linked_provider_id(customer_id, profile)
    deps.update_customer_profile(customer_id, patch, store_path)
    return deps.build_user_account_status(customer_id, store_path)


def submit_customer_verification(deps: Dependencies, customer_id: str, data: Dict[str, Any], store_path: Optional[Path] = None) -> Dict[str, Any]:
    with deps.STORE_LOCK:
        path = store_path or deps._default_customer_store_path()
        profiles = deps.load_customer_profiles(path)
        now = deps._now_iso()
        updated: Optional[Dict[str, Any]] = None
        documents = data.get("documents") if isinstance(data.get("documents"), dict) else {}

        for index, profile in enumerate(profiles):
            if str(profile.get("id")) != str(customer_id):
                continue
            payload = deps._normalize_customer_profile(profile)
            verification = payload.get("verification") if isinstance(payload.get("verification"), dict) else {}
            for key in ["phone", "email", "telegram", "identityDocument", "profilePhoto", "trustedContacts"]:
                ref_value = documents.get(f"{key}Ref") or data.get(f"{key}Ref")
                if ref_value is not None:
                    verification[f"{key}Ref"] = str(ref_value).strip()
                verification[key] = bool(verification.get(key) or deps._truthy_flag(data.get(key)) or deps._truthy_flag(ref_value))

            verification["submittedAt"] = now
            verification["reviewedAt"] = None
            verification["reviewedBy"] = None
            verification["reviewNote"] = ""
            payload["verificationStatus"] = "pending"
            payload["verification"] = verification
            payload["trustedBadges"] = deps._verification_badges("pending", "customer")
            payload["updatedAt"] = now
            payload["profileCompleteness"] = deps._customer_profile_completeness(payload)
            profiles[index] = payload
            updated = payload
            break

        if updated is None:
            profiles.append(deps._default_customer_profile(customer_id, now))
            deps.save_customer_profiles(profiles, path)
            return deps.submit_customer_verification(customer_id, data, path)

        deps.save_customer_profiles(profiles, path)
        return dict(updated)


def review_customer_verification(deps: Dependencies, customer_id: str, data: Dict[str, Any], store_path: Optional[Path] = None) -> Dict[str, Any]:
    with deps.STORE_LOCK:
        path = store_path or deps._default_customer_store_path()
        profiles = deps.load_customer_profiles(path)
        now = deps._now_iso()
        status = deps.normalize_verification_status(data.get("status"), "")
        if status not in {"verified", "rejected"}:
            raise ValueError("verification status must be verified or rejected")

        updated: Optional[Dict[str, Any]] = None
        for index, profile in enumerate(profiles):
            if str(profile.get("id")) != str(customer_id):
                continue
            payload = deps._normalize_customer_profile(profile)
            verification = payload.get("verification") if isinstance(payload.get("verification"), dict) else {}
            verification["reviewedAt"] = now
            verification["reviewedBy"] = str(data.get("reviewedBy") or "dispatcher").strip()
            verification["reviewNote"] = str(data.get("reviewNote") or data.get("note") or "").strip()
            if status == "verified":
                verification["phone"] = True
                verification["identityDocument"] = True
            payload["verificationStatus"] = status
            payload["verification"] = verification
            payload["trustedBadges"] = deps._verification_badges(status, "customer")
            payload["updatedAt"] = now
            payload["profileCompleteness"] = deps._customer_profile_completeness(payload)
            profiles[index] = payload
            updated = payload
            break

        if updated is None:
            raise ValueError("customer profile not found")

        deps.save_customer_profiles(profiles, path)
        return dict(updated)


def admin_update_customer_profile(deps: Dependencies, customer_id: str, data: Dict[str, Any], store_path: Optional[Path] = None) -> Dict[str, Any]:
    with deps.STORE_LOCK:
        path = store_path or deps._default_customer_store_path()
        profiles = deps.load_customer_profiles(path)
        now = deps._now_iso()
        updated: Optional[Dict[str, Any]] = None
        editable_fields = ["name", "phone", "email", "telegram", "city", "avatarUrl", "bio", "accountStatus"]
        for index, profile in enumerate(profiles):
            if str(profile.get("id")) != str(customer_id):
                continue
            payload = deps._normalize_customer_profile(profile)
            for field in editable_fields:
                if data.get(field) is not None:
                    payload[field] = str(data.get(field) or "").strip()
            if data.get("verificationStatus") is not None:
                status = deps.normalize_verification_status(data.get("verificationStatus"), payload.get("verificationStatus"))
                if status in deps.VERIFICATION_STATUSES:
                    payload["verificationStatus"] = status
                    payload["trustedBadges"] = deps._verification_badges(status, "customer")
            payload["updatedAt"] = now
            payload["profileCompleteness"] = deps._customer_profile_completeness(payload)
            profiles[index] = payload
            updated = payload
            break
        if updated is None:
            raise ValueError("customer profile not found")
        deps.save_customer_profiles(profiles, path)
        return deps.prepare_customer_profile_for_admin(updated)


def _clear_customer_phone(deps: Dependencies, customer_id: str, store_path: Optional[Path] = None) -> None:
    """Clear phone on a conflicting guest/alias row so the canonical profile can claim it."""
    needle = str(customer_id or "").strip()
    if not needle:
        return
    with deps.STORE_LOCK:
        path = store_path or deps._default_customer_store_path()
        profiles = deps.load_customer_profiles(path)
        now = deps._now_iso()
        for index, profile in enumerate(profiles):
            if str(profile.get("id") or "").strip() != needle:
                continue
            payload = deps._normalize_customer_profile(profile)
            payload["phone"] = ""
            payload["updatedAt"] = now
            payload["profileCompleteness"] = deps._customer_profile_completeness(payload)
            profiles[index] = payload
            deps.save_customer_profiles(profiles, path)
            return


def _claim_conflicting_guest_phone(deps: Dependencies,
    customer_id: str,
    phone: str,
    store_path: Optional[Path] = None,
) -> bool:
    """If phone is held by a guest/non-tg row, clear it, rebind orders, return True when claimed."""
    target_digits = deps._normalize_ukraine_phone_digits(phone)
    if not target_digits or len(target_digits) != 12:
        return False
    profiles = deps.load_customer_profiles(store_path)
    conflict_ids: list[str] = []
    for profile in profiles:
        other_id = str(profile.get("id") or "").strip()
        if not other_id or other_id == customer_id:
            continue
        if deps._customer_profile_phone_digits(profile) != target_digits:
            continue
        # Never steal phone from a Telegram canonical account (even if claimer is guest).
        if other_id.startswith("tg-"):
            return False
        conflict_ids.append(other_id)
    if not conflict_ids:
        return False
    for conflict_id in conflict_ids:
        deps._clear_customer_phone(conflict_id, store_path)
    # Orders live in the order store (env/default), not the customer profiles path.
    deps.rebind_customer_orders(set(conflict_ids), customer_id, store_path=None)
    return True
