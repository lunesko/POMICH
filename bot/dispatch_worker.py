"""Independent, restart-safe dispatch/notification worker: python -m bot.dispatch_worker."""
import logging
import signal
import threading
import time
import uuid

from bot import dispatch_jobs
from bot.telegram_outbound import ensure_telegram_workers


def main():
    if not dispatch_jobs.enabled():
        raise RuntimeError("Dispatch worker requires SQL storage and POMICH_DISPATCH_ASYNC=1")
    logging.basicConfig(level=logging.INFO)
    stopped = threading.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stopped.set())
    ensure_telegram_workers(force=True)
    worker_id = uuid.uuid4().hex
    next_reconcile = 0.0
    next_heartbeat = 0.0
    while not stopped.is_set():
        try:
            if time.monotonic() >= next_heartbeat:
                dispatch_jobs.heartbeat(worker_id)
                next_heartbeat = time.monotonic() + 5
            if time.monotonic() >= next_reconcile:
                dispatch_jobs.reconcile()
                next_reconcile = time.monotonic() + 300
            if not dispatch_jobs.process_one():
                stopped.wait(0.5)
        except Exception:
            logging.getLogger(__name__).exception("Worker unavailable; persisted jobs will be retried")
            stopped.wait(2)


if __name__ == "__main__":
    main()
