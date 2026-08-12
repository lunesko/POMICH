from __future__ import annotations

import hashlib
import hmac
import json
import os
import random
import smtplib
import threading
import uuid
from datetime import datetime, timedelta
from email.mime.text import MIMEText
from pathlib import Path
from typing import Any, Dict, Optional

from bot.order_store import (
    STORE_LOCK,
    _is_valid_ukraine_mobile_phone,
    _now_iso,
    _parse_iso,
    _verification_badges,
    _write_json_atomic,
    get_customer_profile,
    normalize_verification_status,
    save_customer_profiles,
    update_customer_profile,
)

OTP_LOCK = threading.RLock()
OTP_TTL_SECONDS = 600
OTP_RATE_LIMIT_WINDOW_SECONDS = 600
OTP_RATE_LIMIT_MAX_SENDS = 3
OTP_CODE_LENGTH = 6

UK_OTP_MESSAGE = "Ваш код підтвердження POMICH: {code}. Дійсний 10 хв."
UK_EMAIL_SUBJECT = "Код підтвердження POMICH"


class OtpVerificationError(Exception):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)


def _default_otp_store_path() -> Path:
    return Path(os.getenv("POMICH_OTP_STORE_PATH") or Path(__file__).resolve().parent.parent / "data" / "otp_codes.json")


def _is_production_runtime() -> bool:
    runtime = os.getenv("POMICH_RUNTIME") or os.getenv("VITE_APP_ENV") or "dev"
    return str(runtime).strip().lower() == "production"


def _otp_secret() -> str:
    secret = os.getenv("POMICH_OTP_SECRET") or os.getenv("POMICH_CUSTOMER_SESSION_SECRET") or "dev-otp-secret"
    return secret


def _hash_otp_code(customer_id: str, channel: str, code: str) -> str:
    payload = f"{customer_id}:{channel}:{code}".encode("utf-8")
    return hmac.new(_otp_secret().encode("utf-8"), payload, hashlib.sha256).hexdigest()


def _generate_otp_code() -> str:
    return f"{random.randint(0, 10**OTP_CODE_LENGTH - 1):0{OTP_CODE_LENGTH}d}"


def _load_otp_store(path: Optional[Path] = None) -> Dict[str, Any]:
    store_path = path or _default_otp_store_path()
    if not store_path.exists():
        return {}
    try:
        data = json.loads(store_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    return data if isinstance(data, dict) else {}


def _save_otp_store(data: Dict[str, Any], path: Optional[Path] = None) -> None:
    store_path = path or _default_otp_store_path()
    _write_json_atomic(store_path, data)


def _cleanup_expired_otp_records(store: Dict[str, Any], now: Optional[datetime] = None) -> Dict[str, Any]:
    checked_at = now or datetime.utcnow()
    cleaned: Dict[str, Any] = {}
    for customer_id, record in store.items():
        if not isinstance(record, dict):
            continue
        expires_at = _parse_iso(record.get("expiresAt"))
        send_history = record.get("sendHistory") if isinstance(record.get("sendHistory"), list) else []
        recent_sends = []
        for item in send_history:
            sent_at = _parse_iso(item)
            if sent_at and checked_at - sent_at <= timedelta(seconds=OTP_RATE_LIMIT_WINDOW_SECONDS):
                recent_sends.append(item)
        if expires_at and expires_at > checked_at:
            record = {**record, "sendHistory": recent_sends}
            cleaned[str(customer_id)] = record
        elif recent_sends:
            cleaned[str(customer_id)] = {"sendHistory": recent_sends}
    return cleaned


def _telegram_chat_id_for_customer(customer_id: str, profile: Dict[str, Any]) -> Optional[str]:
    if str(customer_id).startswith("tg-"):
        return str(customer_id)[3:]
    verification = profile.get("verification") if isinstance(profile.get("verification"), dict) else {}
    telegram_user_id = str(verification.get("telegramUserId") or "").strip()
    if telegram_user_id:
        return telegram_user_id
    identity = profile.get("customerIdentity") if isinstance(profile.get("customerIdentity"), dict) else {}
    if str(identity.get("telegramUserId") or "").strip():
        return str(identity.get("telegramUserId"))
    return None


def _smtp_configured() -> bool:
    return bool(os.getenv("SMTP_HOST") and os.getenv("SMTP_USER") and os.getenv("SMTP_PASS"))


def _send_telegram_otp(chat_id: str, code: str) -> None:
    from bot.telegram_bot import send_message

    result = send_message(chat_id, UK_OTP_MESSAGE.format(code=code))
    if isinstance(result, dict) and result.get("ok") is False:
        raise OtpVerificationError("telegram_send_failed", "Не вдалося надіслати код у Telegram")


def _send_email_otp(email: str, code: str) -> None:
    if not _smtp_configured():
        print(f"[POMICH OTP] email to {email}: {code}", flush=True)
        return

    host = os.getenv("SMTP_HOST", "")
    port = int(os.getenv("SMTP_PORT") or "587")
    user = os.getenv("SMTP_USER", "")
    password = os.getenv("SMTP_PASS", "")
    sender = os.getenv("SMTP_FROM") or user
    use_tls = str(os.getenv("SMTP_USE_TLS", "true")).strip().lower() not in {"0", "false", "no"}

    message = MIMEText(UK_OTP_MESSAGE.format(code=code), "plain", "utf-8")
    message["Subject"] = UK_EMAIL_SUBJECT
    message["From"] = sender
    message["To"] = email

    with smtplib.SMTP(host, port, timeout=20) as smtp:
        if use_tls:
            smtp.starttls()
        smtp.login(user, password)
        smtp.sendmail(sender, [email], message.as_string())


def send_customer_verification_code(
    customer_id: str,
    channel: str,
    *,
    phone: Optional[str] = None,
    email: Optional[str] = None,
    store_path: Optional[Path] = None,
    customer_store_path: Optional[Path] = None,
) -> Dict[str, Any]:
    normalized_channel = str(channel or "").strip().lower()
    if normalized_channel not in {"telegram", "email"}:
        raise OtpVerificationError("invalid_channel", "channel must be telegram or email")

    profile = get_customer_profile(customer_id, customer_store_path)
    if profile is None:
        raise OtpVerificationError("customer_not_found", "customer profile not found")

    patch: Dict[str, Any] = {}
    if phone is not None:
        phone_value = str(phone).strip()
        if phone_value and not _is_valid_ukraine_mobile_phone(phone_value):
            raise OtpVerificationError("invalid_phone", "invalid ukraine mobile phone")
        if phone_value:
            patch["phone"] = phone_value
    if email is not None:
        patch["email"] = str(email).strip()

    if patch:
        profile = update_customer_profile(customer_id, patch, customer_store_path)

    now = datetime.utcnow()
    now_iso = _now_iso()
    expires_at = now + timedelta(seconds=OTP_TTL_SECONDS)

    with OTP_LOCK:
        otp_path = store_path or _default_otp_store_path()
        store = _cleanup_expired_otp_records(_load_otp_store(otp_path), now)
        record = store.get(customer_id) if isinstance(store.get(customer_id), dict) else {}
        send_history = record.get("sendHistory") if isinstance(record.get("sendHistory"), list) else []
        recent_sends = []
        for item in send_history:
            sent_at = _parse_iso(item)
            if sent_at and now - sent_at <= timedelta(seconds=OTP_RATE_LIMIT_WINDOW_SECONDS):
                recent_sends.append(item)
        if len(recent_sends) >= OTP_RATE_LIMIT_MAX_SENDS:
            raise OtpVerificationError("rate_limit_exceeded", "too many verification codes sent, try again later")

        code = _generate_otp_code()
        code_hash = _hash_otp_code(customer_id, normalized_channel, code)

        if normalized_channel == "telegram":
            chat_id = _telegram_chat_id_for_customer(customer_id, profile)
            if not chat_id:
                raise OtpVerificationError("telegram_unavailable", "telegram user id not linked")
            _send_telegram_otp(chat_id, code)
            target = chat_id
        else:
            target_email = str(email or profile.get("email") or "").strip()
            if not target_email or "@" not in target_email:
                raise OtpVerificationError("email_missing", "email is required for email verification")
            _send_email_otp(target_email, code)
            target = target_email

        recent_sends.append(now_iso)
        store[customer_id] = {
            "codeHash": code_hash,
            "channel": normalized_channel,
            "target": target,
            "expiresAt": f"{expires_at.isoformat(timespec='seconds')}Z",
            "sendHistory": recent_sends,
        }
        _save_otp_store(store, otp_path)

    response: Dict[str, Any] = {
        "ok": True,
        "channel": normalized_channel,
        "expiresAt": store[customer_id]["expiresAt"],
        "expiresInSeconds": OTP_TTL_SECONDS,
    }
    if not _is_production_runtime() and (normalized_channel == "email" and not _smtp_configured()):
        response["devCode"] = code
    return response


def confirm_customer_verification_code(
    customer_id: str,
    code: str,
    *,
    store_path: Optional[Path] = None,
    customer_store_path: Optional[Path] = None,
) -> Dict[str, Any]:
    normalized_code = str(code or "").strip()
    if not normalized_code.isdigit() or len(normalized_code) != OTP_CODE_LENGTH:
        raise OtpVerificationError("invalid_code_format", "code must be a 6-digit number")

    now = datetime.utcnow()
    with OTP_LOCK:
        otp_path = store_path or _default_otp_store_path()
        store = _cleanup_expired_otp_records(_load_otp_store(otp_path), now)
        record = store.get(customer_id)
        if not isinstance(record, dict):
            raise OtpVerificationError("code_not_found", "verification code not found or expired")

        expires_at = _parse_iso(record.get("expiresAt"))
        if expires_at is None or expires_at <= now:
            store.pop(customer_id, None)
            _save_otp_store(store, otp_path)
            raise OtpVerificationError("code_expired", "verification code expired")

        channel = str(record.get("channel") or "telegram")
        expected_hash = str(record.get("codeHash") or "")
        actual_hash = _hash_otp_code(customer_id, channel, normalized_code)
        if not hmac.compare_digest(expected_hash, actual_hash):
            raise OtpVerificationError("code_invalid", "verification code is invalid")

        store.pop(customer_id, None)
        _save_otp_store(store, otp_path)

    return _apply_customer_otp_verification(customer_id, channel, customer_store_path)


def _apply_customer_otp_verification(
    customer_id: str,
    channel: str,
    customer_store_path: Optional[Path] = None,
) -> Dict[str, Any]:
    with STORE_LOCK:
        from bot.order_store import _default_customer_store_path, _normalize_customer_profile, load_customer_profiles

        path = customer_store_path or _default_customer_store_path()
        profiles = load_customer_profiles(path)
        now = _now_iso()
        updated: Optional[Dict[str, Any]] = None
        for index, profile in enumerate(profiles):
            if str(profile.get("id")) != str(customer_id):
                continue
            payload = _normalize_customer_profile(profile)
            verification = payload.get("verification") if isinstance(payload.get("verification"), dict) else {}
            if channel == "email":
                verification["email"] = True
            else:
                verification["phone"] = True
            verification["reviewedAt"] = now
            verification["reviewedBy"] = "otp"
            verification["reviewNote"] = f"Verified via {channel} OTP"
            payload["verification"] = verification
            payload["verificationStatus"] = "verified"
            payload["trustedBadges"] = _verification_badges("verified", "customer")
            payload["updatedAt"] = now
            profiles[index] = payload
            updated = payload
            break

        if updated is None:
            raise OtpVerificationError("customer_not_found", "customer profile not found")

        save_customer_profiles(profiles, path)
        return dict(updated)
