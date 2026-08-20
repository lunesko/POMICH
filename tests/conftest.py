import os

import pytest


@pytest.fixture(autouse=True)
def _telegram_queue_inline_by_default(monkeypatch):
    """Keep Telegram notify assertions deterministic in unit tests."""
    monkeypatch.setenv("POMICH_TELEGRAM_QUEUE_INLINE", "1")
    monkeypatch.setenv("POMICH_EXPIRE_MIN_INTERVAL_SECONDS", "0")
    # Module reads the interval at import time — override the live value too.
    monkeypatch.setattr("bot.order_store._EXPIRE_STALE_MIN_INTERVAL_SECONDS", 0.0)
