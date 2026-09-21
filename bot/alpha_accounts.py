"""Closed alpha test accounts — [TEST] partners + dispatcher for Uzhhorod pilot."""

from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from bot.api_deps import hash_password
from bot.order_store import get_provider_profile, save_providers, load_providers

ALPHA_TAG = "[TEST]"
ALPHA_SOURCE = "alpha-test"
ALPHA_CITY = "Ужгород"

# Distinct pins around Uzhhorod so map cards do not stack.
ALPHA_PROVIDERS: list[dict[str, Any]] = [
    {
        "id": "alpha-tow-01",
        "username": "alpha-tow-01",
        "name": f"{ALPHA_TAG} Евакуатор Ужгород",
        "specialties": ["tow"],
        "vehicle": "Mercedes Sprinter (TEST)",
        "plate": "AO 1001 CH",
        "phone": "+380990000101",
        "location": {"lat": 48.6208, "lng": 22.2879},
    },
    {
        "id": "alpha-battery-01",
        "username": "alpha-battery-01",
        "name": f"{ALPHA_TAG} Запуск АКБ",
        "specialties": ["battery"],
        "vehicle": "Volkswagen Caddy (TEST)",
        "plate": "AO 1002 CH",
        "phone": "+380990000102",
        "location": {"lat": 48.6255, "lng": 22.2952},
    },
    {
        "id": "alpha-wheel-01",
        "username": "alpha-wheel-01",
        "name": f"{ALPHA_TAG} Допомога з колесом",
        "specialties": ["wheel"],
        "vehicle": "Ford Transit (TEST)",
        "plate": "AO 1003 CH",
        "phone": "+380990000103",
        "location": {"lat": 48.6142, "lng": 22.2786},
    },
    {
        "id": "alpha-fuel-01",
        "username": "alpha-fuel-01",
        "name": f"{ALPHA_TAG} Доставка пального",
        "specialties": ["fuel"],
        "vehicle": "Renault Kangoo (TEST)",
        "plate": "AO 1004 CH",
        "phone": "+380990000104",
        "location": {"lat": 48.6311, "lng": 22.2744},
    },
]

ALPHA_DISPATCHER = {
    "id": "alpha-dispatcher",
    "username": "alpha-dispatcher",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds") + "Z"


def generate_password(nbytes: int = 12) -> str:
    # URL-safe, no ambiguous punctuation that breaks shell/env JSON.
    return secrets.token_urlsafe(nbytes)


def build_provider_row(spec: dict[str, Any], *, verified: bool = True) -> dict[str, Any]:
    now = _now_iso()
    status = "verified" if verified else "unverified"
    return {
        "id": spec["id"],
        "name": spec["name"],
        "rating": 5.0,
        "vehicle": spec["vehicle"],
        "vehicleMake": "Інше",
        "vehicleModel": "TEST",
        "plate": spec["plate"],
        "phone": spec["phone"],
        "telegram": "",
        "city": ALPHA_CITY,
        "status": "offline",
        "etaMinutes": 15,
        "location": dict(spec["location"]),
        "specialties": list(spec["specialties"]),
        "serviceRadiusKm": 20,
        "providerKind": "dispatch",
        "verificationStatus": status,
        "verification": {"phone": verified},
        "trustedBadges": ["phone_verified"] if verified else [],
        "source": ALPHA_SOURCE,
        "alphaTest": True,
        "excludeFromAnalytics": True,
        "registeredAt": now,
        "profileUpdatedAt": now,
        "lastSeenAt": now,
        "lastLocationAt": now,
        "updatedAt": now,
    }


def build_credential_bundle(passwords: dict[str, str] | None = None) -> dict[str, Any]:
    """Generate (or reuse) plaintext passwords + hashed login configs. Never commit plaintext."""
    passwords = dict(passwords or {})
    provider_accounts: list[dict[str, Any]] = []
    plaintext: dict[str, str] = {}

    for spec in ALPHA_PROVIDERS:
        username = str(spec["username"])
        password = passwords.get(username) or generate_password()
        plaintext[username] = password
        provider_accounts.append(
            {
                "providerId": spec["id"],
                "username": username,
                "passwordHash": hash_password(password),
            }
        )

    dispatcher_user = ALPHA_DISPATCHER["username"]
    dispatcher_password = passwords.get(dispatcher_user) or generate_password()
    plaintext[dispatcher_user] = dispatcher_password
    admin_accounts = [
        {
            "username": dispatcher_user,
            "passwordHash": hash_password(dispatcher_password),
        }
    ]

    return {
        "generatedAt": _now_iso(),
        "plaintext": plaintext,
        "providerAccounts": provider_accounts,
        "adminAccounts": admin_accounts,
        "providers": [build_provider_row(spec) for spec in ALPHA_PROVIDERS],
    }


def write_plaintext_credentials(path: Path, plaintext: dict[str, str], *, generated_at: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generatedAt": generated_at,
        "warning": "Local-only alpha passwords. Do not commit. Do not paste into chat.",
        "accounts": [
            {"role": "admin", "username": "alpha-dispatcher", "password": plaintext["alpha-dispatcher"]},
            *[
                {
                    "role": "provider",
                    "providerId": spec["id"],
                    "username": spec["username"],
                    "password": plaintext[spec["username"]],
                    "specialty": spec["specialties"][0],
                }
                for spec in ALPHA_PROVIDERS
            ],
        ],
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass


def upsert_alpha_providers(providers: list[dict[str, Any]], store_path: Path | None = None) -> dict[str, Any]:
    """Insert or replace alpha dispatch partners. Leaves other providers intact."""
    from bot.order_store import _default_provider_store_path, _should_use_sql_store

    added = 0
    updated = 0
    if _should_use_sql_store(store_path, _default_provider_store_path):
        from bot.runtime_store import sql_get_provider, sql_upsert_provider

        for provider in providers:
            provider_id = str(provider.get("id") or "").strip()
            if not provider_id:
                continue
            if sql_get_provider(provider_id) is None:
                added += 1
            else:
                updated += 1
            sql_upsert_provider(dict(provider))
    else:
        existing = load_providers(store_path)
        by_id = {str(item.get("id")): dict(item) for item in existing}
        for provider in providers:
            provider_id = str(provider.get("id") or "").strip()
            if not provider_id:
                continue
            if provider_id in by_id:
                updated += 1
            else:
                added += 1
            by_id[provider_id] = dict(provider)
        save_providers(list(by_id.values()), store_path)

    return {
        "added": added,
        "updated": updated,
        "totalAlpha": len(providers),
        "ids": [str(item.get("id")) for item in providers],
    }


def seed_alpha_accounts(
    *,
    credentials_path: Path | None = None,
    store_path: Path | None = None,
    reuse_passwords_from: Path | None = None,
) -> dict[str, Any]:
    passwords: dict[str, str] = {}
    if reuse_passwords_from and reuse_passwords_from.is_file():
        try:
            prior = json.loads(reuse_passwords_from.read_text(encoding="utf-8"))
            for account in prior.get("accounts") or []:
                if isinstance(account, dict) and account.get("username") and account.get("password"):
                    passwords[str(account["username"])] = str(account["password"])
        except (OSError, json.JSONDecodeError):
            passwords = {}

    bundle = build_credential_bundle(passwords)
    result = upsert_alpha_providers(bundle["providers"], store_path=store_path)
    out_path = credentials_path or Path("secrets/alpha-credentials.local.json")
    write_plaintext_credentials(out_path, bundle["plaintext"], generated_at=bundle["generatedAt"])

    # Verify offline + present
    statuses = {}
    for spec in ALPHA_PROVIDERS:
        row = get_provider_profile(spec["id"], store_path)
        statuses[spec["id"]] = {
            "exists": row is not None,
            "status": (row or {}).get("status"),
            "verificationStatus": (row or {}).get("verificationStatus"),
            "alphaTest": bool((row or {}).get("alphaTest")),
        }

    return {
        "providers": result,
        "credentialsPath": str(out_path),
        "providerAccounts": bundle["providerAccounts"],
        "adminAccounts": bundle["adminAccounts"],
        "statuses": statuses,
        # Plaintext only returned to caller for secure handoff — never log.
        "plaintext": bundle["plaintext"],
    }


def merge_account_env_lists(existing_raw: str, new_accounts: list[dict[str, Any]], *, id_keys: tuple[str, ...]) -> str:
    """Merge JSON account lists by username/providerId; alpha rows win on conflict."""
    try:
        existing = json.loads(existing_raw) if existing_raw.strip() else []
    except json.JSONDecodeError:
        existing = []
    if not isinstance(existing, list):
        existing = []

    def key_for(account: dict[str, Any]) -> str:
        for field in id_keys:
            value = str(account.get(field) or "").strip().lower()
            if value:
                return f"{field}:{value}"
        return ""

    merged: dict[str, dict[str, Any]] = {}
    for account in existing:
        if isinstance(account, dict):
            key = key_for(account)
            if key:
                merged[key] = account
    for account in new_accounts:
        key = key_for(account)
        if key:
            merged[key] = account
    return json.dumps(list(merged.values()), ensure_ascii=False, separators=(",", ":"))


def docker_compose_escape_env_value(value: str) -> str:
    """Docker Compose interpolates $VAR in env files — escape argon2 $ as $$."""
    return str(value).replace("$", "$$")