"""Encrypt sensitive customer PII at rest (Fernet / AES via cryptography)."""

from __future__ import annotations

import os
from typing import Any

ENC_PREFIX = "enc:v1:"
SENSITIVE_CUSTOMER_FIELDS = ("name", "phone", "email", "city", "bio")

_fernet = None
_fernet_checked = False
_fernet_key = None


class FieldEncryptionError(RuntimeError):
    """PII cannot be safely read or written with the configured key."""


def encryption_enabled() -> bool:
    return bool((os.getenv("POMICH_ENCRYPTION_KEY") or "").strip())


def require_valid_fernet_key(raw_key: str | None = None):
    """Return a Fernet instance or raise FieldEncryptionError for invalid keys."""
    key = (raw_key if raw_key is not None else (os.getenv("POMICH_ENCRYPTION_KEY") or "")).strip()
    if not key:
        raise FieldEncryptionError("PII encryption key is missing")
    try:
        from cryptography.fernet import Fernet

        return Fernet(key.encode("ascii"))
    except Exception as exc:  # InvalidToken is not raised at construct time; ValueError/binascii are.
        raise FieldEncryptionError("Invalid PII encryption key") from exc


def _get_fernet():
    global _fernet, _fernet_checked, _fernet_key
    raw_key = (os.getenv("POMICH_ENCRYPTION_KEY") or "").strip()
    if _fernet_checked and raw_key == _fernet_key:
        return _fernet
    _fernet_checked = False
    if not raw_key:
        _fernet = None
    else:
        # Fail closed: a configured but invalid key must not silently store plaintext (F03).
        _fernet = require_valid_fernet_key(raw_key)
    _fernet_key = raw_key
    _fernet_checked = True
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
        # Dev/local without a key may store plaintext. Production rejects missing keys at startup.
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
        # Keep the ciphertext. Returning "" would let the next profile save
        # encrypt an empty value and permanently wipe customer PII.
        return normalized
    token = normalized[len(ENC_PREFIX) :]
    try:
        return fernet.decrypt(token.encode("ascii")).decode("utf-8")
    except Exception:
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
