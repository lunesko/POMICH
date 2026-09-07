from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import smtplib
import threading
import time
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText
from pathlib import Path
from typing import Any, Dict, Optional

from bot.order_store import (
    STORE_LOCK,
    _customer_profile_phone_digits,
    _is_valid_ukraine_mobile_phone,
    _normalize_ukraine_phone_digits,
    _now_iso,
    _parse_iso,
    _verification_badges,
    _write_json_atomic,
    find_telegram_user_id_by_phone,
    get_customer_profile,
    normalize_verification_status,
    save_customer_profiles,
    update_customer_profile,
)

OTP_LOCK = threading.RLock()
OTP_TTL_SECONDS = 600
OTP_RATE_LIMIT_WINDOW_SECONDS = 600
OTP_RATE_LIMIT_MAX_SENDS = 3
# Cross-customer debounce: same phone / Telegram chat must not get two codes within this window.
OTP_SEND_COOLDOWN_SECONDS = 45
OTP_CODE_LENGTH = 6
OTP_MAX_CONFIRM_ATTEMPTS = 5
# Never use urllib/requests 60s default on the OTP path. Telegram delivery is backgrounded.
OTP_TELEGRAM_TIMEOUT_SECONDS = 3


def _run_in_background(fn) -> None:
    thread = threading.Thread(target=fn, daemon=True)
    thread.start()

UK_OTP_EMAIL_MESSAGE = "Ваш код підтвердження POMICH: {code}. Дійсний 10 хв."
UK_OTP_TELEGRAM_MESSAGE = "Ваш код підтвердження POMICH: <code>{code}</code>\n\nДійсний 10 хв."
UK_EMAIL_SUBJECT = "Код підтвердження POMICH"


class OtpVerificationError(Exception):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        retry_after_seconds: Optional[int] = None,
    ) -> None:
        self.code = code
        self.message = message
        self.retry_after_seconds = retry_after_seconds
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
    return f"{secrets.randbelow(10**OTP_CODE_LENGTH):0{OTP_CODE_LENGTH}d}"


# Last-line process guard: never Telegram-spam one chat even if store races.
_TELEGRAM_OTP_GUARD_LOCK = threading.Lock()
_TELEGRAM_OTP_GUARD: dict[str, list[float]] = {}
_TELEGRAM_OTP_GUARD_MAX = OTP_RATE_LIMIT_MAX_SENDS
_TELEGRAM_OTP_GUARD_WINDOW_S = float(OTP_RATE_LIMIT_WINDOW_SECONDS)


def _telegram_otp_guard_at_limit(chat_id: str) -> bool:
    key = str(chat_id or "").strip()
    if not key:
        return True
    now = time.monotonic()
    with _TELEGRAM_OTP_GUARD_LOCK:
        stamps = [stamp for stamp in _TELEGRAM_OTP_GUARD.get(key, []) if now - stamp < _TELEGRAM_OTP_GUARD_WINDOW_S]
        _TELEGRAM_OTP_GUARD[key] = stamps
        return len(stamps) >= _TELEGRAM_OTP_GUARD_MAX


def _telegram_otp_guard_stamp(chat_id: str) -> None:
    key = str(chat_id or "").strip()
    if not key:
        return
    now = time.monotonic()
    with _TELEGRAM_OTP_GUARD_LOCK:
        stamps = [stamp for stamp in _TELEGRAM_OTP_GUARD.get(key, []) if now - stamp < _TELEGRAM_OTP_GUARD_WINDOW_S]
        stamps.append(now)
        _TELEGRAM_OTP_GUARD[key] = stamps


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
    checked_at = now or datetime.now(timezone.utc).replace(tzinfo=None)
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


def _delete_stored_otp_telegram_message(record: Dict[str, Any]) -> None:
    chat_id = record.get("telegramChatId")
    message_id = record.get("telegramMessageId")
    if chat_id is None or message_id is None:
        return
    from bot.telegram_bot import delete_message
    from bot.telegram_config import normalize_telegram_bot_kind

    preferred = normalize_telegram_bot_kind(str(record.get("telegramBotKind") or ""))
    kinds: list[str] = []
    if preferred:
        kinds.append(preferred)
        other = "provider" if preferred == "customer" else "customer"
        kinds.append(other)
    else:
        kinds = ["customer", "provider"]

    def _async_delete() -> None:
        try:
            for kind in kinds:
                delete_message(
                    str(chat_id),
                    int(message_id),
                    kind=kind,
                    timeout=OTP_TELEGRAM_TIMEOUT_SECONDS,
                )
        except Exception:
            pass

    thread = threading.Thread(target=_async_delete, daemon=True)
    thread.start()


def _schedule_otp_message_deletion(
    chat_id: str,
    message_id: int,
    delay_seconds: int,
    *,
    kind: str | None = None,
) -> None:
    def _run() -> None:
        from bot.telegram_bot import delete_message
        from bot.telegram_config import normalize_telegram_bot_kind

        preferred = normalize_telegram_bot_kind(kind)
        kinds = [preferred] if preferred else ["customer", "provider"]
        if preferred:
            other = "provider" if preferred == "customer" else "customer"
            kinds.append(other)
        try:
            for bot_kind in kinds:
                delete_message(
                    chat_id,
                    message_id,
                    kind=bot_kind,
                    timeout=OTP_TELEGRAM_TIMEOUT_SECONDS,
                )
        except Exception:
            return

    timer = threading.Timer(max(delay_seconds, 1), _run)
    timer.daemon = True
    timer.start()


def _telegram_chat_id_for_customer(
    customer_id: str,
    profile: Dict[str, Any],
    *,
    phone: Optional[str] = None,
    customer_store_path: Optional[Path] = None,
) -> Optional[str]:
    if str(customer_id).startswith("tg-"):
        return str(customer_id)[3:]
    verification = profile.get("verification") if isinstance(profile.get("verification"), dict) else {}
    telegram_user_id = str(verification.get("telegramUserId") or "").strip()
    if telegram_user_id:
        return telegram_user_id
    identity = profile.get("customerIdentity") if isinstance(profile.get("customerIdentity"), dict) else {}
    if str(identity.get("telegramUserId") or "").strip():
        return str(identity.get("telegramUserId"))
    lookup_phone = str(phone or profile.get("phone") or "").strip()
    if lookup_phone:
        return find_telegram_user_id_by_phone(lookup_phone, customer_store_path)
    return None


def _smtp_configured() -> bool:
    return bool(os.getenv("SMTP_HOST") and os.getenv("SMTP_USER") and os.getenv("SMTP_PASS"))


def _send_telegram_otp(chat_id: str, code: str, *, kind: str | None = None) -> int:
    from bot.telegram_bot import send_message
    from bot.telegram_config import normalize_telegram_bot_kind

    bot_kind = normalize_telegram_bot_kind(kind) or "customer"
    result = send_message(
        chat_id,
        UK_OTP_TELEGRAM_MESSAGE.format(code=code),
        parse_mode="HTML",
        kind=bot_kind,
        timeout=OTP_TELEGRAM_TIMEOUT_SECONDS,
    )
    if isinstance(result, dict) and result.get("ok") is False:
        detail = str(result.get("error") or "Не вдалося надіслати код у Telegram")
        raise OtpVerificationError("telegram_send_failed", detail)
    message = result.get("result") if isinstance(result, dict) else None
    message_id = message.get("message_id") if isinstance(message, dict) else None
    if message_id is None:
        raise OtpVerificationError("telegram_send_failed", "Не вдалося надіслати код у Telegram")
    return int(message_id)


def _preferred_otp_bot_kind(profile: Dict[str, Any], hint: str | None = None) -> str:
    from bot.telegram_config import normalize_telegram_bot_kind

    return (
        normalize_telegram_bot_kind(hint)
        or normalize_telegram_bot_kind(
            str(profile.get("telegramBotKind") or profile.get("telegramNotificationChannel") or "")
        )
        or "customer"
    )


def _deliver_telegram_otp(chat_id: str, code: str, *, preferred_kind: str | None = None) -> tuple[int, str]:
    from bot.telegram_config import get_telegram_bot_config, normalize_telegram_bot_kind

    preferred = normalize_telegram_bot_kind(preferred_kind) or "customer"
    other = "provider" if preferred == "customer" else "customer"
    kinds = [preferred]
    preferred_config = get_telegram_bot_config(preferred)
    other_config = get_telegram_bot_config(other)
    if other_config is not None and (
        preferred_config is None or other_config.token != preferred_config.token
    ):
        kinds.append(other)

    last_error: Optional[OtpVerificationError] = None
    for kind in kinds:
        try:
            return _send_telegram_otp(chat_id, code, kind=kind), kind
        except OtpVerificationError as exc:
            last_error = exc
            msg = (exc.message or "").lower()
            # Timeout / reset: Telegram may already have delivered — do not also ping the other bot.
            if any(token in msg for token in ("timed out", "timeout", "reset by peer", "temporarily unavailable")):
                break
    raise last_error or OtpVerificationError("telegram_send_failed", "Не вдалося надіслати код у Telegram")


def _deliver_telegram_otp_and_record(
    customer_id: str,
    chat_id: str,
    code: str,
    *,
    preferred_kind: str | None = None,
    store_path: Optional[Path] = None,
) -> None:
    if _telegram_otp_guard_at_limit(chat_id):
        print(
            f"[POMICH OTP] telegram send skipped (chat guard) customer_id={customer_id} chat_id={chat_id}",
            flush=True,
        )
        return
    try:
        message_id, bot_kind = _deliver_telegram_otp(chat_id, code, preferred_kind=preferred_kind)
    except Exception as exc:
        print(
            f"[POMICH OTP] telegram send failed customer_id={customer_id} chat_id={chat_id} error={exc}",
            flush=True,
        )
        return
    _telegram_otp_guard_stamp(chat_id)
    with OTP_LOCK:
        otp_path = store_path or _default_otp_store_path()
        store = _load_otp_store(otp_path)
        record = store.get(customer_id)
        if not isinstance(record, dict) or not record.get("codeHash"):
            return
        record["telegramChatId"] = str(chat_id)
        record["telegramMessageId"] = message_id
        record["telegramBotKind"] = bot_kind
        store[customer_id] = record
        _save_otp_store(store, otp_path)
    _schedule_otp_message_deletion(str(chat_id), message_id, OTP_TTL_SECONDS, kind=bot_kind)


def _send_email_otp(email: str, code: str) -> None:
    if not _smtp_configured():
        # Never print OTP codes — even in local/dev logs can leak to shared host logs.
        print(f"[POMICH OTP] email skipped (SMTP not configured) target={email}", flush=True)
        return

    host = os.getenv("SMTP_HOST", "")
    port = int(os.getenv("SMTP_PORT") or "587")
    user = os.getenv("SMTP_USER", "")
    password = os.getenv("SMTP_PASS", "")
    sender = os.getenv("SMTP_FROM") or user
    use_tls = str(os.getenv("SMTP_USE_TLS", "true")).strip().lower() not in {"0", "false", "no"}

    message = MIMEText(UK_OTP_EMAIL_MESSAGE.format(code=code), "plain", "utf-8")
    message["Subject"] = UK_EMAIL_SUBJECT
    message["From"] = sender
    message["To"] = email

    with smtplib.SMTP(host, port, timeout=20) as smtp:
        if use_tls:
            smtp.starttls()
        smtp.login(user, password)
        smtp.sendmail(sender, [email], message.as_string())


def _record_last_sent_at(record: Dict[str, Any]) -> Optional[datetime]:
    send_history = record.get("sendHistory") if isinstance(record.get("sendHistory"), list) else []
    last_iso = None
    for item in send_history:
        if isinstance(item, str):
            last_iso = item
    if not last_iso and isinstance(record.get("lastSentAt"), str):
        last_iso = record.get("lastSentAt")
    return _parse_iso(last_iso) if last_iso else None


def _retry_after_from_send_history(
    recent_sends: list,
    now: datetime,
    *,
    window_seconds: int = OTP_RATE_LIMIT_WINDOW_SECONDS,
) -> int:
    """Seconds until the oldest send leaves the rate-limit window (at least 1)."""
    oldest: Optional[datetime] = None
    for item in recent_sends:
        sent_at = _parse_iso(item) if isinstance(item, str) else None
        if sent_at is None:
            continue
        if oldest is None or sent_at < oldest:
            oldest = sent_at
    if oldest is None:
        return max(1, int(window_seconds))
    remaining = int((oldest + timedelta(seconds=window_seconds) - now).total_seconds())
    return max(1, remaining)


def _record_has_valid_code(record: Dict[str, Any], now: datetime) -> bool:
    expires_at = _parse_iso(record.get("expiresAt"))
    return bool(expires_at and expires_at > now and record.get("codeHash"))


def _already_sent_response(record: Dict[str, Any], now: datetime, retry_after: int) -> Dict[str, Any]:
    expires_at = _parse_iso(record.get("expiresAt"))
    expires_in = max(1, int((expires_at - now).total_seconds())) if expires_at else OTP_TTL_SECONDS
    channel = str(record.get("channel") or "telegram").strip().lower() or "telegram"
    return {
        "ok": True,
        "sent": True,
        "channel": channel,
        "expiresAt": record.get("expiresAt"),
        "expiresInSeconds": expires_in,
        "cooldownSeconds": retry_after,
        "alreadySent": True,
    }


def _record_matches_destination(
    record: Dict[str, Any],
    *,
    telegram_chat_id: Optional[str] = None,
    phone: Optional[str] = None,
    email: Optional[str] = None,
) -> bool:
    chat_key = str(telegram_chat_id or "").strip()
    phone_key = _normalize_ukraine_phone_digits(str(phone or ""))
    email_key = str(email or "").strip().lower()
    channel = str(record.get("channel") or "").strip().lower()
    record_chat = str(record.get("telegramChatId") or "").strip()
    if not record_chat and channel == "telegram":
        record_chat = str(record.get("target") or "").strip()
    record_phone = _normalize_ukraine_phone_digits(str(record.get("phone") or ""))
    record_email = str(record.get("email") or "").strip().lower()
    if not record_email and channel == "email":
        record_email = str(record.get("target") or "").strip().lower()
    if chat_key and record_chat == chat_key:
        return True
    if phone_key and record_phone and record_phone == phone_key:
        return True
    if email_key and record_email == email_key:
        return True
    return False


def _find_live_otp_for_destination(
    store: Dict[str, Any],
    now: datetime,
    *,
    telegram_chat_id: Optional[str] = None,
    phone: Optional[str] = None,
    email: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    for record in store.values():
        if not isinstance(record, dict):
            continue
        if not _record_matches_destination(
            record, telegram_chat_id=telegram_chat_id, phone=phone, email=email
        ):
            continue
        if _record_has_valid_code(record, now):
            return record
    return None


def _destination_recent_sends(
    store: Dict[str, Any],
    now: datetime,
    *,
    telegram_chat_id: Optional[str] = None,
    phone: Optional[str] = None,
    email: Optional[str] = None,
) -> list[str]:
    stamps: list[str] = []
    for record in store.values():
        if not isinstance(record, dict):
            continue
        if not _record_matches_destination(
            record, telegram_chat_id=telegram_chat_id, phone=phone, email=email
        ):
            continue
        history = record.get("sendHistory") if isinstance(record.get("sendHistory"), list) else []
        for item in history:
            sent_at = _parse_iso(item) if isinstance(item, str) else None
            if sent_at and now - sent_at <= timedelta(seconds=OTP_RATE_LIMIT_WINDOW_SECONDS):
                stamps.append(item)
    return stamps


def _delete_otp_messages_for_chat(store: Dict[str, Any], telegram_chat_id: str) -> None:
    """Remove previous OTP Telegram messages for this chat across all customer rows."""
    chat_key = str(telegram_chat_id)
    for record in store.values():
        if not isinstance(record, dict):
            continue
        if str(record.get("telegramChatId") or "") != chat_key:
            continue
        _delete_stored_otp_telegram_message(record)
        record.pop("telegramMessageId", None)


def _enforce_delivery_cooldown(
    store: Dict[str, Any],
    *,
    now: datetime,
    telegram_chat_id: Optional[str] = None,
    phone: Optional[str] = None,
    email: Optional[str] = None,
) -> None:
    """Block duplicate OTP delivery to the same phone / Telegram chat / email within cooldown."""
    phone_key = str(phone or "").strip()
    chat_key = str(telegram_chat_id or "").strip()
    email_key = str(email or "").strip().lower()
    for record in store.values():
        if not isinstance(record, dict):
            continue
        last_sent = _record_last_sent_at(record)
        if last_sent is None or now - last_sent > timedelta(seconds=OTP_SEND_COOLDOWN_SECONDS):
            continue
        record_chat = str(record.get("telegramChatId") or "").strip()
        record_phone = _normalize_ukraine_phone_digits(str(record.get("phone") or ""))
        record_target = str(record.get("target") or "").strip()
        record_email = str(record.get("email") or "").strip().lower()
        same_chat = bool(chat_key) and (record_chat == chat_key or record_target == chat_key)
        same_phone = bool(_normalize_ukraine_phone_digits(phone_key)) and record_phone == _normalize_ukraine_phone_digits(
            phone_key
        )
        same_email = bool(email_key) and (record_email == email_key or record_target.lower() == email_key)
        if same_chat or same_phone or same_email:
            remaining = OTP_SEND_COOLDOWN_SECONDS
            if last_sent is not None:
                remaining = max(
                    1,
                    int((last_sent + timedelta(seconds=OTP_SEND_COOLDOWN_SECONDS) - now).total_seconds()),
                )
            raise OtpVerificationError(
                "send_cooldown",
                f"verification code already sent recently; retry after {remaining}s",
                retry_after_seconds=remaining,
            )


def send_customer_verification_code(
    customer_id: str,
    channel: str,
    *,
    phone: Optional[str] = None,
    email: Optional[str] = None,
    preferred_bot_kind: Optional[str] = None,
    store_path: Optional[Path] = None,
    customer_store_path: Optional[Path] = None,
    send_reason: str = "unspecified",
) -> Dict[str, Any]:
    normalized_channel = str(channel or "").strip().lower()
    if normalized_channel not in {"telegram", "email"}:
        raise OtpVerificationError("invalid_channel", "channel must be telegram or email")

    profile = get_customer_profile(customer_id, customer_store_path)
    if profile is None:
        raise OtpVerificationError("customer_not_found", "customer profile not found")

    existing_digits = _customer_profile_phone_digits(profile)
    requested_phone = str(phone).strip() if phone is not None else ""
    next_digits = _normalize_ukraine_phone_digits(requested_phone) if requested_phone else existing_digits
    phone_changing = bool(requested_phone) and next_digits != existing_digits

    if (
        normalize_verification_status(profile.get("verificationStatus"), "unverified") == "verified"
        and not phone_changing
        and send_reason != "auth/customer/phone/login/send"
    ):
        _verify_linked_provider_after_otp(customer_id, customer_store_path)
        verified_profile = get_customer_profile(customer_id, customer_store_path)
        return {
            "ok": True,
            "sent": False,
            "alreadyVerified": True,
            "channel": normalized_channel,
            "expiresAt": _now_iso(),
            "expiresInSeconds": 0,
            "cooldownSeconds": 0,
            "profile": dict(verified_profile) if isinstance(verified_profile, dict) else None,
        }

    patch: Dict[str, Any] = {}
    if phone is not None:
        phone_value = str(phone).strip()
        if phone_value and not _is_valid_ukraine_mobile_phone(phone_value):
            raise OtpVerificationError("invalid_phone", "invalid ukraine mobile phone")
        # Do not re-patch an unchanged phone: legacy guest+tg duplicates would raise
        # phone_already_registered and block OTP delivery.
        existing_digits = _customer_profile_phone_digits(profile)
        next_digits = _normalize_ukraine_phone_digits(phone_value)
        if phone_value and next_digits != existing_digits:
            patch["phone"] = phone_value
    if email is not None:
        email_value = str(email).strip()
        existing_email = str(profile.get("email") or "").strip()
        if email_value and email_value != existing_email:
            patch["email"] = email_value

    if patch:
        try:
            profile = update_customer_profile(customer_id, patch, customer_store_path)
        except ValueError as exc:
            if str(exc) == "phone_already_registered":
                raise OtpVerificationError("phone_already_registered", "phone already registered") from exc
            raise

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    now_iso = _now_iso()
    expires_at = now + timedelta(seconds=OTP_TTL_SECONDS)
    profile_phone = str(profile.get("phone") or phone or "").strip() or None

    pending_telegram: Optional[Dict[str, Any]] = None
    pending_email: Optional[tuple[str, str]] = None
    telegram_chat_id: Optional[str] = None
    otp_path = store_path or _default_otp_store_path()

    with OTP_LOCK:
        store = _cleanup_expired_otp_records(_load_otp_store(otp_path), now)
        record = store.get(customer_id) if isinstance(store.get(customer_id), dict) else {}
        send_history = record.get("sendHistory") if isinstance(record.get("sendHistory"), list) else []
        recent_sends = []
        for item in send_history:
            sent_at = _parse_iso(item)
            if sent_at and now - sent_at <= timedelta(seconds=OTP_RATE_LIMIT_WINDOW_SECONDS):
                recent_sends.append(item)
        if len(recent_sends) >= OTP_RATE_LIMIT_MAX_SENDS:
            retry_after = _retry_after_from_send_history(recent_sends, now)
            # Soft-lock fix: if a valid code is still live, tell the client to use it
            # instead of a generic failure. If the code already expired but history is
            # still full (cleanup keeps sendHistory), free one slot so login is not stuck.
            if _record_has_valid_code(record, now):
                return _already_sent_response(record, now, retry_after)
            recent_sends = recent_sends[-(OTP_RATE_LIMIT_MAX_SENDS - 1) :]

        # Resend within delivery cooldown while OTP is still valid → reuse, don't 429.
        if _record_has_valid_code(record, now):
            last_sent = _record_last_sent_at(record)
            if last_sent and now - last_sent <= timedelta(seconds=OTP_SEND_COOLDOWN_SECONDS):
                remaining = max(
                    1,
                    int((last_sent + timedelta(seconds=OTP_SEND_COOLDOWN_SECONDS) - now).total_seconds()),
                )
                return _already_sent_response(record, now, remaining)

        code = _generate_otp_code()
        code_hash = _hash_otp_code(customer_id, normalized_channel, code)

        if normalized_channel == "telegram":
            telegram_chat_id = _telegram_chat_id_for_customer(
                customer_id,
                profile,
                phone=profile_phone,
                customer_store_path=customer_store_path,
            )
            if not telegram_chat_id:
                raise OtpVerificationError(
                    "telegram_not_linked",
                    "telegram user id not linked; start @pomich_ua_bot or @pomich_help_bot with the same phone",
                )
            live = _find_live_otp_for_destination(
                store,
                now,
                telegram_chat_id=telegram_chat_id,
                phone=profile_phone,
            )
            if live is not None:
                last_sent = _record_last_sent_at(live)
                remaining = OTP_SEND_COOLDOWN_SECONDS
                if last_sent:
                    remaining = max(
                        1,
                        int((last_sent + timedelta(seconds=OTP_SEND_COOLDOWN_SECONDS) - now).total_seconds()),
                    )
                live_owner = str(live.get("customerId") or "").strip()
                within_cooldown = bool(
                    last_sent and now - last_sent <= timedelta(seconds=OTP_SEND_COOLDOWN_SECONDS)
                )
                # Another profile (guest vs tg-*) already delivered to this chat — do not send a second code.
                if within_cooldown or (live_owner and live_owner != str(customer_id)):
                    return _already_sent_response(live, now, remaining)
            dest_sends = _destination_recent_sends(
                store,
                now,
                telegram_chat_id=telegram_chat_id,
                phone=profile_phone,
            )
            if len(dest_sends) >= OTP_RATE_LIMIT_MAX_SENDS:
                retry_after = _retry_after_from_send_history(dest_sends, now)
                raise OtpVerificationError(
                    "rate_limit_exceeded",
                    f"too many verification codes; retry after {retry_after}s",
                    retry_after_seconds=retry_after,
                )
            _enforce_delivery_cooldown(
                store,
                now=now,
                telegram_chat_id=telegram_chat_id,
                phone=profile_phone,
            )
            # Queue previous OTP bubble deletes; never wait for Telegram HTTP here.
            _delete_otp_messages_for_chat(store, telegram_chat_id)
            target = telegram_chat_id
            pending_telegram = {
                "chat_id": telegram_chat_id,
                "code": code,
                "preferred_kind": _preferred_otp_bot_kind(profile, preferred_bot_kind),
            }
        else:
            target_email = str(email or profile.get("email") or "").strip()
            if not target_email or "@" not in target_email:
                raise OtpVerificationError("email_missing", "email is required for email verification")
            _enforce_delivery_cooldown(store, now=now, phone=profile_phone, email=target_email)
            pending_email = (target_email, code)
            target = target_email

        print(
            "[POMICH OTP] queued "
            f"reason={send_reason} endpoint={send_reason} customer_id={customer_id} "
            f"channel={normalized_channel} phone={profile_phone or '-'} "
            f"target={target} chat_id={telegram_chat_id or '-'}",
            flush=True,
        )

        recent_sends.append(now_iso)
        record = {
            "codeHash": code_hash,
            "channel": normalized_channel,
            "target": target,
            "phone": profile_phone,
            "email": target if normalized_channel == "email" else None,
            "expiresAt": f"{expires_at.isoformat(timespec='seconds')}Z",
            "sendHistory": recent_sends,
            "lastSentAt": now_iso,
            "sendReason": send_reason,
            "customerId": customer_id,
        }
        if normalized_channel == "telegram" and telegram_chat_id:
            record["telegramChatId"] = str(telegram_chat_id)
        store[customer_id] = record
        _save_otp_store(store, otp_path)

    if pending_telegram:
        chat_id = str(pending_telegram["chat_id"])
        queued_code = str(pending_telegram["code"])
        preferred_kind = pending_telegram.get("preferred_kind")
        queued_customer_id = customer_id
        queued_store_path = otp_path

        def _bg_telegram_send() -> None:
            _deliver_telegram_otp_and_record(
                queued_customer_id,
                chat_id,
                queued_code,
                preferred_kind=preferred_kind,
                store_path=queued_store_path,
            )

        # Dedicated short-lived thread: OTP latency must not wait on the shared
        # Telegram outbound queue when dispatch fan-out is busy.
        _run_in_background(_bg_telegram_send)
    elif pending_email:
        target_email, queued_code = pending_email

        def _bg_email_send() -> None:
            try:
                _send_email_otp(target_email, queued_code)
            except Exception as exc:
                print(f"[POMICH OTP] email send failed target={target_email} error={exc}", flush=True)

        _run_in_background(_bg_email_send)

    response: Dict[str, Any] = {
        "ok": True,
        "sent": True,
        "channel": normalized_channel,
        "expiresAt": store[customer_id]["expiresAt"],
        "expiresInSeconds": OTP_TTL_SECONDS,
        "cooldownSeconds": OTP_SEND_COOLDOWN_SECONDS,
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

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    linked_owner_id = ""
    with OTP_LOCK:
        otp_path = store_path or _default_otp_store_path()
        store = _cleanup_expired_otp_records(_load_otp_store(otp_path), now)
        record = store.get(customer_id) if isinstance(store.get(customer_id), dict) else None
        store_key = customer_id
        if not isinstance(record, dict) or not record.get("codeHash"):
            profile = get_customer_profile(customer_id, customer_store_path) or {}
            chat_id = _telegram_chat_id_for_customer(
                customer_id,
                profile if isinstance(profile, dict) else {},
                phone=str(profile.get("phone") or "").strip() or None,
                customer_store_path=customer_store_path,
            )
            live = _find_live_otp_for_destination(
                store,
                now,
                telegram_chat_id=chat_id,
                phone=str(profile.get("phone") or "").strip() or None,
                email=str(profile.get("email") or "").strip() or None,
            )
            if live is None:
                if isinstance(record, dict):
                    store.pop(customer_id, None)
                    _save_otp_store(store, otp_path)
                    raise OtpVerificationError("code_expired", "verification code expired")
                raise OtpVerificationError("code_not_found", "verification code not found or expired")
            record = live
            store_key = str(live.get("customerId") or "")
            for key, value in store.items():
                if value is live:
                    store_key = str(key)
                    break

        expires_at = _parse_iso(record.get("expiresAt"))
        if expires_at is None or expires_at <= now:
            store.pop(store_key, None)
            if store_key != customer_id:
                store.pop(customer_id, None)
            _save_otp_store(store, otp_path)
            raise OtpVerificationError("code_expired", "verification code expired")

        channel = str(record.get("channel") or "telegram")
        hashed_customer_id = str(record.get("customerId") or store_key or customer_id).strip() or customer_id
        expected_hash = str(record.get("codeHash") or "")
        actual_hash = _hash_otp_code(hashed_customer_id, channel, normalized_code)
        failed_attempts = int(record.get("failedAttempts") or 0)
        if failed_attempts >= OTP_MAX_CONFIRM_ATTEMPTS:
            store.pop(store_key, None)
            if store_key != customer_id:
                store.pop(customer_id, None)
            _save_otp_store(store, otp_path)
            raise OtpVerificationError("code_locked", "too many invalid verification attempts")
        hash_mismatch = (
            not expected_hash
            or len(expected_hash) != len(actual_hash)
            or not hmac.compare_digest(expected_hash, actual_hash)
        )
        if hash_mismatch:
            record["failedAttempts"] = failed_attempts + 1
            store[store_key] = record
            _save_otp_store(store, otp_path)
            raise OtpVerificationError("code_invalid", "verification code is invalid")

        # Queue OTP bubble delete immediately on success (async — does not block confirm).
        _delete_stored_otp_telegram_message(record)
        store.pop(store_key, None)
        if store_key != customer_id:
            store.pop(customer_id, None)
        _save_otp_store(store, otp_path)
        linked_owner_id = hashed_customer_id if hashed_customer_id != customer_id else ""

    updated = _apply_customer_otp_verification(customer_id, channel, customer_store_path)
    if linked_owner_id:
        try:
            _apply_customer_otp_verification(linked_owner_id, channel, customer_store_path)
        except OtpVerificationError:
            pass
    return updated


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
        _verify_linked_provider_after_otp(customer_id, customer_store_path)
        return dict(updated)


def _verify_linked_provider_after_otp(customer_id: str, customer_store_path: Optional[Path] = None) -> None:
    from bot.order_store import get_customer_profile, resolve_linked_provider_id, verify_provider_phone_otp

    profile = get_customer_profile(customer_id, customer_store_path)
    if profile is None:
        return
    provider_id = resolve_linked_provider_id(customer_id, profile)
    if not provider_id:
        return
    verify_provider_phone_otp(provider_id)
