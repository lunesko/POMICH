"""Indexed phone lookup keys (HMAC of normalized UA digits).

Encrypted customer phone columns cannot be equality-scanned. We store a
deterministic, non-reversible lookup key so OTP/login can hit an index instead
of decrypting every customer row.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import re
from typing import Any


def normalize_ukraine_phone_digits(phone: str | None) -> str:
    digits = re.sub(r"\D+", "", str(phone or ""))
    if digits.startswith("0") and len(digits) == 10:
        digits = f"38{digits}"
    if digits.startswith("80") and len(digits) == 11:
        digits = f"3{digits}"
    if len(digits) == 9 and digits[0] in "345679":
        digits = f"380{digits}"
    return digits


def phone_lookup_secret() -> str:
    return (
        (os.getenv("POMICH_PHONE_LOOKUP_SECRET") or "").strip()
        or (os.getenv("POMICH_ENCRYPTION_KEY") or "").strip()
        or (os.getenv("POMICH_OTP_SECRET") or "").strip()
        or (os.getenv("POMICH_CUSTOMER_SESSION_SECRET") or "").strip()
        or "dev-phone-lookup-secret"
    )


def phone_lookup_key(phone: str | None) -> str | None:
    digits = normalize_ukraine_phone_digits(phone)
    if not digits or len(digits) != 12 or not digits.startswith("380"):
        return None
    digest = hmac.new(
        phone_lookup_secret().encode("utf-8"),
        digits.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return digest


def phone_lookup_key_from_payload(payload: dict[str, Any] | None) -> str | None:
    if not isinstance(payload, dict):
        return None
    raw_phone = payload.get("phone")
    if raw_phone is None:
        return None
    text = str(raw_phone).strip()
    if not text:
        return None
    if text.startswith("enc:v1:"):
        try:
            from bot.field_encryption import decrypt_field

            text = decrypt_field(text)
        except Exception:
            return None
    return phone_lookup_key(text)
