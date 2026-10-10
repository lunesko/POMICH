import pytest

from tests.helpers import use_temp_store


@pytest.fixture(autouse=True)
def _telegram_queue_inline_by_default(monkeypatch, tmp_path_factory):
    """Keep Telegram notify assertions deterministic in unit tests."""
    monkeypatch.setenv("POMICH_TELEGRAM_QUEUE_INLINE", "1")
    monkeypatch.setenv("POMICH_EXPIRE_MIN_INTERVAL_SECONDS", "0")
    # Module reads the interval at import time — override the live value too.
    monkeypatch.setattr("bot.order_store._EXPIRE_STALE_MIN_INTERVAL_SECONDS", 0.0)
    # Prevent repo-root `.env` from undoing monkeypatched Telegram env vars.
    monkeypatch.setenv("POMICH_SKIP_LOCAL_ENV", "1")
    # Isolate session-family revocation state across tests (F04).
    rev_path = tmp_path_factory.mktemp("auth-revocations") / "auth_revocations.json"
    monkeypatch.setenv("POMICH_AUTH_REVOCATION_PATH", str(rev_path))
    from bot.auth_sessions import reset_auth_sessions_for_tests

    reset_auth_sessions_for_tests()


@pytest.fixture
def temp_store(monkeypatch, tmp_path):
    return use_temp_store(monkeypatch, tmp_path)
