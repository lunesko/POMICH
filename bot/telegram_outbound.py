"""In-process outbound Telegram job queue.

Keeps Bot API HTTP calls off the FastAPI request path so dispatch peaks and
OTP delivery do not stall login, accept, or map/cabinet reads.
"""

from __future__ import annotations

import os
import queue
import threading
import time
from typing import Any, Callable

JobFn = Callable[..., Any]

_JOBS: queue.Queue[tuple[str, JobFn, tuple[Any, ...], dict[str, Any]] | None] = queue.Queue(
    maxsize=int(os.getenv("POMICH_TELEGRAM_QUEUE_MAXSIZE", "5000") or "5000")
)
_WORKER_COUNT = max(1, int(os.getenv("POMICH_TELEGRAM_QUEUE_WORKERS", "2") or "2"))
_STARTED = False
_START_LOCK = threading.Lock()
_STATS_LOCK = threading.Lock()
_STATS = {
    "enqueued": 0,
    "completed": 0,
    "failed": 0,
    "dropped": 0,
    "sync_fallback": 0,
}


def queue_stats() -> dict[str, Any]:
    with _STATS_LOCK:
        stats = dict(_STATS)
    stats["pending"] = _JOBS.qsize()
    stats["workers"] = _WORKER_COUNT
    return stats


def _bump(key: str, amount: int = 1) -> None:
    with _STATS_LOCK:
        _STATS[key] = int(_STATS.get(key) or 0) + amount


def _worker_loop(worker_id: int) -> None:
    while True:
        item = _JOBS.get()
        if item is None:
            _JOBS.task_done()
            break
        name, fn, args, kwargs = item
        started = time.monotonic()
        try:
            fn(*args, **kwargs)
            _bump("completed")
        except Exception as exc:
            _bump("failed")
            print(
                f"[POMICH TG QUEUE] worker={worker_id} job={name} failed after "
                f"{(time.monotonic() - started):.2f}s: {exc}",
                flush=True,
            )
        finally:
            _JOBS.task_done()


def ensure_telegram_workers() -> None:
    global _STARTED
    if _STARTED:
        return
    with _START_LOCK:
        if _STARTED:
            return
        for index in range(_WORKER_COUNT):
            thread = threading.Thread(
                target=_worker_loop,
                args=(index + 1,),
                name=f"pomich-tg-outbound-{index + 1}",
                daemon=True,
            )
            thread.start()
        _STARTED = True
        print(f"[POMICH TG QUEUE] started {_WORKER_COUNT} worker(s)", flush=True)


def enqueue_telegram(name: str, fn: JobFn, *args: Any, **kwargs: Any) -> bool:
    """Queue a Telegram-side effect. Returns False if the job had to run inline."""
    inline = str(os.getenv("POMICH_TELEGRAM_QUEUE_INLINE") or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    if inline:
        _bump("enqueued")
        _bump("sync_fallback")
        try:
            fn(*args, **kwargs)
            _bump("completed")
        except Exception as exc:
            _bump("failed")
            print(f"[POMICH TG QUEUE] inline {name} failed: {exc}", flush=True)
            raise
        return False

    ensure_telegram_workers()
    try:
        _JOBS.put_nowait((str(name or getattr(fn, "__name__", "job")), fn, args, kwargs))
        _bump("enqueued")
        return True
    except queue.Full:
        _bump("dropped")
        _bump("sync_fallback")
        print(f"[POMICH TG QUEUE] full; running {name} inline", flush=True)
        try:
            fn(*args, **kwargs)
            _bump("completed")
        except Exception as exc:
            _bump("failed")
            print(f"[POMICH TG QUEUE] inline {name} failed: {exc}", flush=True)
        return False


def flush_telegram_queue(timeout_seconds: float = 2.0) -> None:
    """Wait until queued jobs finish (tests / diagnostics)."""
    deadline = time.monotonic() + max(0.05, float(timeout_seconds))
    while time.monotonic() < deadline:
        if _JOBS.unfinished_tasks == 0:
            return
        time.sleep(0.01)
    # Best-effort: do not hang callers forever.
    return


def reset_telegram_queue_for_tests() -> None:
    """Drain pending jobs without stopping daemon workers (pytest helper)."""
    while True:
        try:
            _JOBS.get_nowait()
            _JOBS.task_done()
        except queue.Empty:
            break
    with _STATS_LOCK:
        for key in _STATS:
            _STATS[key] = 0
