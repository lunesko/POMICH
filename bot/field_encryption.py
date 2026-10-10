"""Encrypt sensitive customer PII at rest (Fernet / AES via cryptography)."""

from __future__ import annotations

import os
from typing import Any

ENC_PREFIX = "enc:v1:"
SENSITIVE_CUSTOMER_FIELDS = ("name", "phone", "email", "city", "bio")

_fernet = None
_fernet_checked = False


def encryption_enabled() -> bool:
    return bool((os.getenv("POMICH_ENCRYPTION_KEY") or "").strip())


def _get_fernet():
    # Validate the actual configured key on every call: an earlier cache hit must
    # never mask a missing/invalid key after configuration changes.
    raw_key = (os.getenv("POMICH_ENCRYPTION_KEY") or "").strip()
    if not raw_key:
        runtime = (os.getenv("POMICH_RUNTIME") or os.getenv("VITE_APP_ENV") or "dev").lower()
        if runtime in {"prod", "production"}:
            raise RuntimeError("POMICH_ENCRYPTION_KEY is required")
        return None
    try:
        from cryptography.fernet import Fernet
        return Fernet(raw_key.encode("ascii"))
    except Exception as exc:
        raise RuntimeError("POMICH_ENCRYPTION_KEY is invalid or cryptography is unavailable") from exc


def generate_encryption_key() -> str:
    from cryptography.fernet import Fernet

    return Fernet.generate_key().decode("ascii")


def is_encrypted_value(value: Any) -> bool:
    return str(value or "").startswith(ENC_PREFIX)


def encrypt_field(value: str) -> str:
    normalized = str(value or "")
    if not normalized or is_encrypted_value(normalized):
        return normalized
    fernet = _get_fernet()
    if fernet is None:
        return normalized
    token = fernet.encrypt(normalized.encode("utf-8")).decode("ascii")
    return f"{ENC_PREFIX}{token}"


def decrypt_field(value: str) -> str:
    normalized = str(value or "")
    if not normalized:
        return ""
    if not is_encrypted_value(normalized):
        return normalized
    fernet = _get_fernet()
    if fernet is None:
        return normalized
    token = normalized[len(ENC_PREFIX) :]
    try:
        return fernet.decrypt(token.encode("ascii")).decode("utf-8")
    except Exception:
        # Keep the ciphertext. Returning "" would let the next profile save
        # encrypt an empty value and permanently wipe customer PII.
        return normalized


def encrypt_customer_profile(profile: dict[str, Any]) -> dict[str, Any]:
    payload = dict(profile)
    for field in SENSITIVE_CUSTOMER_FIELDS:
        if payload.get(field):
            payload[field] = encrypt_field(str(payload[field]))
    return payload


def decrypt_customer_profile(profile: dict[str, Any]) -> dict[str, Any]:
    payload = dict(profile)
    for field in SENSITIVE_CUSTOMER_FIELDS:
        if payload.get(field):
            payload[field] = decrypt_field(str(payload[field]))
    return payload
