import os

import pytest

# Tests must never pick up a developer's local credentials during collection.
os.environ["POMICH_LOAD_LOCAL_ENV"] = "0"


@pytest.fixture(autouse=True)
def _telegram_queue_inline_by_default(monkeypatch):
    """Keep Telegram notify assertions deterministic in unit tests."""
    monkeypatch.setenv("POMICH_TELEGRAM_QUEUE_INLINE", "1")
    monkeypatch.setenv("POMICH_EXPIRE_MIN_INTERVAL_SECONDS", "0")
    # Module reads the interval at import time — override the live value too.
    monkeypatch.setattr("bot.order_store._EXPIRE_STALE_MIN_INTERVAL_SECONDS", 0.0)


@pytest.fixture(autouse=True)
def isolated_runtime_files(monkeypatch, tmp_path):
    """Do not let tests persist PII/OTP into the developer's project data folder."""
    from bot import order_store, otp_verification
    defaults = tmp_path / "runtime"
    for variable, filename in [
        ("POMICH_ORDER_STORE_PATH", "orders.json"),
        ("POMICH_PROVIDER_STORE_PATH", "providers.json"),
        ("POMICH_OFFER_STORE_PATH", "offers.json"),
        ("POMICH_CUSTOMER_STORE_PATH", "customers.json"),
        ("POMICH_SESSION_STORE_PATH", "telegram_sessions.json"),
    ]:
        monkeypatch.setenv(variable, str(defaults / filename))
    monkeypatch.setattr(otp_verification, "_default_otp_store_path", lambda: defaults / "otp_codes.json")
    otp_verification._TELEGRAM_OTP_GUARD.clear()


@pytest.fixture
def temp_store(monkeypatch, tmp_path):
    """Set isolated JSON store paths for API tests; return paths on demand."""
    from bot import order_store, otp_verification

    def configure():
        for attribute, filename in [
            ("_default_store_path", "orders.json"),
            ("_default_provider_store_path", "providers.json"),
            ("_default_offer_store_path", "offers.json"),
            ("_default_customer_store_path", "customers.json"),
        ]:
            monkeypatch.setattr(order_store, attribute, lambda filename=filename: tmp_path / filename)
        otp_verification._TELEGRAM_OTP_GUARD.clear()
        return tmp_path / "orders.json", tmp_path / "providers.json", tmp_path / "offers.json"

    return configure
