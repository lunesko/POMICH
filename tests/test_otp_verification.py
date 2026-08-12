from datetime import datetime, timedelta

import pytest

from bot import otp_verification
from bot.order_store import get_customer_profile, update_customer_profile


@pytest.fixture
def otp_env(monkeypatch, tmp_path):
    customer_path = tmp_path / "customers.json"
    otp_path = tmp_path / "otp_codes.json"
    monkeypatch.setattr("bot.order_store._default_customer_store_path", lambda: customer_path)
    monkeypatch.setenv("POMICH_OTP_SECRET", "test-otp-secret")
    monkeypatch.setenv("POMICH_RUNTIME", "dev")
    monkeypatch.delenv("SMTP_HOST", raising=False)
    monkeypatch.setattr(otp_verification, "_default_otp_store_path", lambda: otp_path)
    monkeypatch.setattr(otp_verification, "_send_telegram_otp", lambda chat_id, code: None)
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
    expired_at = (datetime.utcnow() - timedelta(minutes=1)).isoformat(timespec="seconds") + "Z"
    store["tg-7"]["expiresAt"] = expired_at
    otp_verification._save_otp_store(store, otp_path)

    with pytest.raises(otp_verification.OtpVerificationError) as exc:
        otp_verification.confirm_customer_verification_code("tg-7", "123456", customer_store_path=customer_path)
    assert exc.value.code == "code_expired"


def test_rate_limit_blocks_fourth_send(otp_env) -> None:
    customer_path, _ = otp_env
    update_customer_profile("tg-55", {"name": "Petro", "phone": "+380501112233"}, customer_path)

    for _ in range(3):
        otp_verification.send_customer_verification_code("tg-55", "telegram", customer_store_path=customer_path)

    with pytest.raises(otp_verification.OtpVerificationError) as exc:
        otp_verification.send_customer_verification_code("tg-55", "telegram", customer_store_path=customer_path)
    assert exc.value.code == "rate_limit_exceeded"


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
