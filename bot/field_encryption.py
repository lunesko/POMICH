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
    global _fernet, _fernet_checked
    if _fernet_checked:
        return _fernet
    _fernet_checked = True
    raw_key = (os.getenv("POMICH_ENCRYPTION_KEY") or "").strip()
    if not raw_key:
        _fernet = None
        return None
    try:
        from cryptography.fernet import Fernet

        _fernet = Fernet(raw_key.encode("ascii"))
    except Exception:
        _fernet = None
    return _fernet


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
        # Wrong key or corrupted token — hide ciphertext; field re-encrypts on next profile save.
        return ""


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
