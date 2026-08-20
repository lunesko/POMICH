"""Phone lookup key + telegram outbound queue unit tests."""

from __future__ import annotations

import time

from bot.phone_lookup import normalize_ukraine_phone_digits, phone_lookup_key
from bot.telegram_outbound import enqueue_telegram, queue_stats, reset_telegram_queue_for_tests


def test_phone_lookup_key_is_stable_for_ua_formats(monkeypatch):
    monkeypatch.setenv("POMICH_PHONE_LOOKUP_SECRET", "test-lookup-secret")
    a = phone_lookup_key("+380 66 100 74 34")
    b = phone_lookup_key("0661007434")
    c = phone_lookup_key("380661007434")
    assert a and a == b == c
    assert len(a) == 64
    assert normalize_ukraine_phone_digits("0661007434") == "380661007434"


def test_telegram_outbound_queue_runs_jobs_off_caller(monkeypatch):
    monkeypatch.delenv("POMICH_TELEGRAM_QUEUE_INLINE", raising=False)
    monkeypatch.setenv("POMICH_TELEGRAM_QUEUE_INLINE", "0")
    reset_telegram_queue_for_tests()
    done = []

    def _job(value: str) -> None:
        time.sleep(0.05)
        done.append(value)

    started = time.monotonic()
    assert enqueue_telegram("unit-job", _job, "ok") is True
    # Caller returns immediately even though job sleeps.
    assert (time.monotonic() - started) < 0.05
    deadline = time.monotonic() + 2
    while not done and time.monotonic() < deadline:
        time.sleep(0.02)
    assert done == ["ok"]
    stats = queue_stats()
    assert stats["enqueued"] >= 1
    assert stats["completed"] >= 1
