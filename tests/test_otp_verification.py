import threading
import time
from datetime import datetime, timedelta, timezone

import pytest

from bot import otp_verification
from bot.order_store import get_customer_profile, get_provider_profile, update_customer_profile, update_provider_profile


@pytest.fixture
def otp_env(monkeypatch, tmp_path):
    customer_path = tmp_path / "customers.json"
    otp_path = tmp_path / "otp_codes.json"
    monkeypatch.setattr("bot.order_store._default_customer_store_path", lambda: customer_path)
    monkeypatch.setenv("POMICH_OTP_SECRET", "test-otp-secret")
    monkeypatch.setenv("POMICH_RUNTIME", "dev")
    monkeypatch.delenv("SMTP_HOST", raising=False)
    monkeypatch.setattr(otp_verification, "_default_otp_store_path", lambda: otp_path)
    monkeypatch.setattr(otp_verification, "_send_telegram_otp", lambda chat_id, code, **kwargs: 12345)
    monkeypatch.setattr(otp_verification, "_run_in_background", lambda fn: fn())
    return customer_path, otp_path


def test_generate_and_confirm_telegram_otp(otp_env, monkeypatch) -> None:
    customer_path, _ = otp_env
    monkeypatch.setattr(otp_verification, "_generate_otp_code", lambda: "654321")
    update_customer_profile("tg-42", {"name": "Maria", "phone": "+380501112233"}, customer_path)

    sent = otp_verification.send_customer_verification_code("tg-42", "telegram", customer_store_path=customer_path)
    assert sent["ok"] is True
    assert sent["expiresInSeconds"] == 600

    store = otp_verification._load_otp_store()
    record = store["tg-42"]
    assert record["codeHash"] == otp_verification._hash_otp_code("tg-42", "telegram", "654321")

    profile = otp_verification.confirm_customer_verification_code("tg-42", "654321", customer_store_path=customer_path)
    assert profile["verificationStatus"] == "verified"
    assert profile["verification"]["phone"] is True


def test_confirm_rejects_invalid_code(otp_env) -> None:
    customer_path, _ = otp_env
    update_customer_profile("tg-99", {"name": "Ivan", "phone": "+380661007434"}, customer_path)
    otp_verification.send_customer_verification_code("tg-99", "telegram", customer_store_path=customer_path)

    with pytest.raises(otp_verification.OtpVerificationError) as exc:
        otp_verification.confirm_customer_verification_code("tg-99", "000000", customer_store_path=customer_path)
    assert exc.value.code == "code_invalid"


def test_expired_code_is_rejected(monkeypatch, otp_env) -> None:
    customer_path, otp_path = otp_env
    update_customer_profile("tg-7", {"name": "Olena", "phone": "+380931234567"}, customer_path)
    sent = otp_verification.send_customer_verification_code("tg-7", "telegram", customer_store_path=customer_path)

    store = otp_verification._load_otp_store(otp_path)
    expired_at = (datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=1)).isoformat(timespec="seconds") + "Z"
    store["tg-7"]["expiresAt"] = expired_at
    otp_verification._save_otp_store(store, otp_path)

    with pytest.raises(otp_verification.OtpVerificationError) as exc:
        otp_verification.confirm_customer_verification_code("tg-7", "123456", customer_store_path=customer_path)
    assert exc.value.code == "code_expired"


def test_rate_limit_returns_already_sent_when_code_valid(otp_env, monkeypatch) -> None:
    customer_path, _ = otp_env
    monkeypatch.setattr(otp_verification, "OTP_SEND_COOLDOWN_SECONDS", 0)
    update_customer_profile("tg-55", {"name": "Petro", "phone": "+380501112233"}, customer_path)

    for _ in range(3):
        otp_verification.send_customer_verification_code("tg-55", "telegram", customer_store_path=customer_path)

    fourth = otp_verification.send_customer_verification_code("tg-55", "telegram", customer_store_path=customer_path)
    assert fourth["ok"] is True
    assert fourth.get("alreadySent") is True


def test_rate_limit_allows_new_send_when_code_expired(otp_env, monkeypatch) -> None:
    customer_path, otp_path = otp_env
    monkeypatch.setattr(otp_verification, "OTP_SEND_COOLDOWN_SECONDS", 0)
    update_customer_profile("tg-55", {"name": "Petro", "phone": "+380501112233"}, customer_path)

    for _ in range(3):
        otp_verification.send_customer_verification_code("tg-55", "telegram", customer_store_path=customer_path)

    store = otp_verification._load_otp_store(otp_path)
    record = store["tg-55"]
    record["expiresAt"] = "2020-01-01T00:00:00Z"
    record.pop("codeHash", None)
    otp_verification._save_otp_store(store, otp_path)

    fifth = otp_verification.send_customer_verification_code("tg-55", "telegram", customer_store_path=customer_path)
    assert fifth["ok"] is True
    assert fifth.get("alreadySent") is not True


def test_send_cooldown_returns_already_sent_when_code_still_valid(otp_env, monkeypatch) -> None:
    customer_path, _ = otp_env
    update_customer_profile("tg-55", {"name": "Petro", "phone": "+380501112233"}, customer_path)
    first = otp_verification.send_customer_verification_code(
        "tg-55",
        "telegram",
        customer_store_path=customer_path,
        send_reason="test/first",
    )
    assert first["ok"] is True

    second = otp_verification.send_customer_verification_code(
        "tg-55",
        "telegram",
        customer_store_path=customer_path,
        send_reason="test/second",
    )
    assert second["ok"] is True
    assert second.get("alreadySent") is True
    assert second["expiresAt"] == first["expiresAt"]


def test_send_cooldown_blocks_cross_customer_same_phone(otp_env) -> None:
    customer_path, _ = otp_env
    from bot.order_store import save_customer_profiles

    # Legacy duplicate rows (guest + tg-*) can still exist in production data.
    save_customer_profiles(
        [
            {
                "id": "tg-777888",
                "name": "Bot User",
                "phone": "+380501112233",
                "verificationStatus": "unverified",
            },
            {
                "id": "guest-web-1",
                "name": "Web User",
                "phone": "+380501112233",
                "verificationStatus": "unverified",
            },
        ],
        customer_path,
    )

    otp_verification.send_customer_verification_code(
        "guest-web-1",
        "telegram",
        phone="+380501112233",
        customer_store_path=customer_path,
        send_reason="auth/customer/verify/send",
    )

    with pytest.raises(otp_verification.OtpVerificationError) as exc:
        otp_verification.send_customer_verification_code(
            "tg-777888",
            "telegram",
            customer_store_path=customer_path,
            send_reason="auth/customer/phone/login/send",
        )
    assert exc.value.code == "send_cooldown"


def test_resend_after_cooldown_deletes_previous_telegram_message(otp_env, monkeypatch) -> None:
    customer_path, _ = otp_env
    deleted: list[tuple[str, int]] = []
    message_ids = iter([111, 222])
    monkeypatch.setattr(otp_verification, "OTP_SEND_COOLDOWN_SECONDS", 0)
    monkeypatch.setattr(
        otp_verification,
        "_send_telegram_otp",
        lambda chat_id, code, **kwargs: next(message_ids),
    )
    monkeypatch.setattr(
        otp_verification,
        "_delete_stored_otp_telegram_message",
        lambda record: deleted.append((str(record.get("telegramChatId")), int(record["telegramMessageId"])))
        if record.get("telegramChatId") and record.get("telegramMessageId") is not None
        else None,
    )
    update_customer_profile("tg-42", {"name": "Maria", "phone": "+380501112233"}, customer_path)

    otp_verification.send_customer_verification_code("tg-42", "telegram", customer_store_path=customer_path)
    otp_verification.send_customer_verification_code("tg-42", "telegram", customer_store_path=customer_path)

    assert ("42", 111) in deleted



def test_telegram_otp_message_uses_html_code_tag(monkeypatch) -> None:
    sent_messages: list[dict] = []

    def fake_send_message(chat_id, text, **kwargs):
        sent_messages.append({"chat_id": chat_id, "text": text, **kwargs})
        return {"ok": True, "result": {"message_id": 9876}}

    monkeypatch.setattr("bot.telegram_bot.send_message", fake_send_message)
    message_id = otp_verification._send_telegram_otp("12345", "378741")

    assert message_id == 9876
    assert len(sent_messages) == 1
    assert sent_messages[0]["chat_id"] == "12345"
    assert sent_messages[0]["text"] == (
        "Ваш код підтвердження POMICH: <code>378741</code>\n\nДійсний 10 хв."
    )
    assert sent_messages[0]["parse_mode"] == "HTML"
    assert sent_messages[0]["timeout"] == otp_verification.OTP_TELEGRAM_TIMEOUT_SECONDS


def test_confirm_does_not_call_telegram(otp_env, monkeypatch) -> None:
    customer_path, _ = otp_env
    telegram_calls: list[str] = []
    monkeypatch.setattr(otp_verification, "_generate_otp_code", lambda: "654321")
    monkeypatch.setattr(
        otp_verification,
        "_delete_stored_otp_telegram_message",
        lambda record: telegram_calls.append("delete"),
    )
    monkeypatch.setattr(
        "bot.telegram_bot.send_message",
        lambda *args, **kwargs: telegram_calls.append("send") or {"ok": True, "result": {"message_id": 1}},
    )
    monkeypatch.setattr(
        "bot.telegram_bot.delete_message",
        lambda *args, **kwargs: telegram_calls.append("delete_api") or {"ok": True},
    )
    update_customer_profile("tg-42", {"name": "Maria", "phone": "+380501112233"}, customer_path)

    otp_verification.send_customer_verification_code("tg-42", "telegram", customer_store_path=customer_path)
    telegram_calls.clear()
    otp_verification.confirm_customer_verification_code("tg-42", "654321", customer_store_path=customer_path)

    assert telegram_calls == []


def test_expired_code_cleanup_does_not_call_telegram(monkeypatch, otp_env) -> None:
    customer_path, otp_path = otp_env
    telegram_calls: list[str] = []
    monkeypatch.setattr(
        otp_verification,
        "_delete_stored_otp_telegram_message",
        lambda record: telegram_calls.append("delete"),
    )
    update_customer_profile("tg-7", {"name": "Olena", "phone": "+380931234567"}, customer_path)
    otp_verification.send_customer_verification_code("tg-7", "telegram", customer_store_path=customer_path)

    store = otp_verification._load_otp_store(otp_path)
    expired_at = (datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=1)).isoformat(timespec="seconds") + "Z"
    store["tg-7"]["expiresAt"] = expired_at
    otp_verification._save_otp_store(store, otp_path)

    with pytest.raises(otp_verification.OtpVerificationError) as exc:
        otp_verification.confirm_customer_verification_code("tg-7", "123456", customer_store_path=customer_path)
    assert exc.value.code == "code_expired"
    assert telegram_calls == []


def test_email_channel_sets_email_flag(otp_env) -> None:
    customer_path, _ = otp_env
    update_customer_profile(
        "guest-1",
        {"name": "Test", "phone": "+380501112233", "email": "test@example.com"},
        customer_path,
    )

    sent = otp_verification.send_customer_verification_code(
        "guest-1",
        "email",
        email="test@example.com",
        customer_store_path=customer_path,
    )
    assert sent.get("devCode")

    profile = otp_verification.confirm_customer_verification_code(
        "guest-1",
        sent["devCode"],
        customer_store_path=customer_path,
    )
    assert profile["verification"]["email"] is True
    assert get_customer_profile("guest-1", customer_path)["verificationStatus"] == "verified"


def test_telegram_otp_resolves_chat_id_by_phone(otp_env) -> None:
    customer_path, _ = otp_env
    from bot.order_store import save_customer_profiles

    save_customer_profiles(
        [
            {
                "id": "tg-777888",
                "name": "Bot User",
                "phone": "+380501112233",
                "verificationStatus": "unverified",
            },
            {
                "id": "guest-web-1",
                "name": "Web User",
                "phone": "+380501112233",
                "verificationStatus": "unverified",
            },
        ],
        customer_path,
    )

    sent = otp_verification.send_customer_verification_code(
        "guest-web-1",
        "telegram",
        phone="+380501112233",
        customer_store_path=customer_path,
    )
    assert sent["ok"] is True
    assert sent["channel"] == "telegram"


def test_telegram_otp_requires_bot_link_when_phone_unknown(otp_env) -> None:
    customer_path, _ = otp_env
    update_customer_profile(
        "guest-2",
        {"name": "Lonely Web", "phone": "+380661007434"},
        customer_path,
    )

    with pytest.raises(otp_verification.OtpVerificationError) as exc:
        otp_verification.send_customer_verification_code(
            "guest-2",
            "telegram",
            phone="+380661007434",
            customer_store_path=customer_path,
        )
    assert exc.value.code == "telegram_not_linked"


def test_otp_verification_auto_verifies_linked_provider(otp_env, tmp_path, monkeypatch) -> None:
    customer_path, otp_path = otp_env
    provider_path = tmp_path / "providers.json"
    monkeypatch.setattr("bot.order_store._default_provider_store_path", lambda: provider_path)

    update_customer_profile(
        "guest-partner-1",
        {"name": "Partner User", "phone": "+380501112233", "linkedProviderId": "provider-guest-partner-1"},
        customer_path,
    )
    update_provider_profile(
        "provider-guest-partner-1",
        {
            "name": "Partner User",
            "phone": "+380501112233",
            "vehicle": "Ford Transit",
            "plate": "AA 1111 AA",
            "specialties": ["tow"],
            "serviceRadiusKm": 12,
        },
        store_path=provider_path,
    )

    monkeypatch.setattr(otp_verification, "_generate_otp_code", lambda: "654321")
    otp_verification.send_customer_verification_code(
        "guest-partner-1",
        "email",
        email="partner@example.com",
        customer_store_path=customer_path,
    )
    otp_verification.confirm_customer_verification_code(
        "guest-partner-1",
        "654321",
        customer_store_path=customer_path,
    )

    provider = get_provider_profile("provider-guest-partner-1", provider_path)
    assert provider["verificationStatus"] == "verified"
    assert provider["verification"]["phone"] is True


def test_telegram_otp_resolves_chat_id_via_provider_phone(otp_env, tmp_path, monkeypatch) -> None:
    """Guest web OTP must reach the Telegram owner of a partner cabinet with the same phone."""
    customer_path, _ = otp_env
    provider_path = tmp_path / "providers.json"
    monkeypatch.setattr("bot.order_store._default_provider_store_path", lambda: provider_path)

    update_customer_profile(
        "tg-6863802123",
        {"name": "Owner", "phone": "+380679998877", "linkedProviderId": "provider-tg-6863802123"},
        customer_path,
    )
    update_customer_profile(
        "guest-arsen",
        {"name": "Arsen", "phone": "+380635236801"},
        customer_path,
    )
    update_provider_profile(
        "provider-tg-6863802123",
        {
            "name": "Arsen",
            "phone": "+380635236801",
            "vehicle": "VW Transporter",
            "plate": "АО1234ВО",
            "specialties": ["tow"],
            "serviceRadiusKm": 15,
        },
        store_path=provider_path,
    )

    sent = otp_verification.send_customer_verification_code(
        "guest-arsen",
        "telegram",
        phone="+380635236801",
        customer_store_path=customer_path,
    )
    assert sent["ok"] is True
    assert sent["channel"] == "telegram"


def test_guest_inherits_verification_from_verified_provider_phone(otp_env, tmp_path, monkeypatch) -> None:
    customer_path, _ = otp_env
    provider_path = tmp_path / "providers.json"
    monkeypatch.setattr("bot.order_store._default_provider_store_path", lambda: provider_path)

    update_customer_profile(
        "guest-arsen-2",
        {"name": "Arsen", "phone": "+380635236801"},
        customer_path,
    )
    update_provider_profile(
        "provider-tg-6863802123",
        {
            "name": "Arsen",
            "phone": "+380635236801",
            "vehicle": "VW Transporter",
            "plate": "АО1234ВО",
            "specialties": ["tow"],
            "serviceRadiusKm": 15,
        },
        store_path=provider_path,
    )
    from bot.order_store import verify_provider_phone_otp

    verify_provider_phone_otp("provider-tg-6863802123", store_path=provider_path)

    loaded = get_customer_profile("guest-arsen-2", customer_path)
    assert loaded["verificationStatus"] == "verified"
    assert loaded["verification"]["phone"] is True
    assert loaded.get("linkedProviderId") == "provider-tg-6863802123"


def test_otp_prefers_provider_bot_for_partner_mini_app(otp_env, monkeypatch) -> None:
    customer_path, _ = otp_env
    sent: list[str | None] = []

    def fake_send(chat_id, code, *, kind=None):
        sent.append(kind)
        return 42

    monkeypatch.setattr(otp_verification, "_send_telegram_otp", fake_send)
    update_customer_profile(
        "tg-42",
        {
            "name": "Партнер",
            "phone": "+380501112233",
            "telegramBotKind": "provider",
        },
        customer_path,
    )

    otp_verification.send_customer_verification_code("tg-42", "telegram", customer_store_path=customer_path)

    assert sent == ["provider"]


def test_otp_falls_back_to_customer_bot_when_provider_send_fails(otp_env, monkeypatch) -> None:
    customer_path, _ = otp_env
    sent: list[str | None] = []

    def fake_send(chat_id, code, *, kind=None):
        sent.append(kind)
        if kind == "provider":
            raise otp_verification.OtpVerificationError("telegram_send_failed", "fail")
        return 99

    monkeypatch.setattr(otp_verification, "_send_telegram_otp", fake_send)

    from bot.telegram_config import TelegramBotConfig

    def fake_config(kind):
        token = "111:customer" if kind == "customer" else "222:provider"
        return TelegramBotConfig(kind=kind, username="bot", token=token, web_app_url="https://pomich.help/")

    monkeypatch.setattr("bot.telegram_config.get_telegram_bot_config", fake_config)
    update_customer_profile(
        "tg-42",
        {"name": "Партнер", "phone": "+380501112233", "telegramBotKind": "provider"},
        customer_path,
    )

    otp_verification.send_customer_verification_code("tg-42", "telegram", customer_store_path=customer_path)

    assert sent == ["provider", "customer"]


def test_send_returns_without_waiting_for_telegram_http(otp_env, monkeypatch) -> None:
    customer_path, _ = otp_env

    def hang_send(*args, **kwargs):
        time.sleep(5)
        return 1

    monkeypatch.setattr(otp_verification, "_send_telegram_otp", hang_send)
    monkeypatch.setattr(
        otp_verification,
        "_run_in_background",
        lambda fn: threading.Thread(target=fn, daemon=True).start(),
    )
    update_customer_profile("tg-42", {"name": "Maria", "phone": "+380501112233"}, customer_path)

    started = time.monotonic()
    sent = otp_verification.send_customer_verification_code("tg-42", "telegram", customer_store_path=customer_path)
    elapsed = time.monotonic() - started

    assert sent["ok"] is True
    assert sent.get("sent") is True
    assert elapsed < 1.0


def test_send_returns_without_waiting_for_delete_message(otp_env, monkeypatch) -> None:
    customer_path, otp_path = otp_env
    monkeypatch.setattr(otp_verification, "OTP_SEND_COOLDOWN_SECONDS", 0)
    monkeypatch.setattr(
        otp_verification,
        "_run_in_background",
        lambda fn: threading.Thread(target=fn, daemon=True).start(),
    )

    def hang_delete(*args, **kwargs):
        time.sleep(5)
        return {"ok": True}

    monkeypatch.setattr("bot.telegram_bot.delete_message", hang_delete)
    update_customer_profile("tg-42", {"name": "Maria", "phone": "+380501112233"}, customer_path)

    live_expires = (datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(minutes=8)).isoformat(timespec="seconds") + "Z"
    otp_verification._save_otp_store(
        {
            "tg-42": {
                "codeHash": "stale",
                "channel": "telegram",
                "telegramChatId": "42",
                "telegramMessageId": 111,
                "telegramBotKind": "customer",
                "expiresAt": live_expires,
                "sendHistory": [],
                "lastSentAt": "2020-01-01T00:00:00Z",
            }
        },
        otp_path,
    )

    started = time.monotonic()
    sent = otp_verification.send_customer_verification_code("tg-42", "telegram", customer_store_path=customer_path)
    elapsed = time.monotonic() - started

    assert sent["ok"] is True
    assert elapsed < 1.0


def test_telegram_otp_send_uses_short_timeout(monkeypatch) -> None:
    sent_messages: list[dict] = []

    def fake_send_message(chat_id, text, **kwargs):
        sent_messages.append({"chat_id": chat_id, "text": text, **kwargs})
        return {"ok": True, "result": {"message_id": 9876}}

    monkeypatch.setattr("bot.telegram_bot.send_message", fake_send_message)
    otp_verification._send_telegram_otp("12345", "378741")

    assert sent_messages[0]["timeout"] == otp_verification.OTP_TELEGRAM_TIMEOUT_SECONDS
    assert sent_messages[0]["timeout"] <= 5
