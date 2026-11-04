"""Transactional dispatch timers. PostgreSQL is the durable source of work."""
from __future__ import annotations

import hashlib
import os
import time
import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, Integer, String, Table, and_, delete, func, select, update
from bot import runtime_store as db

jobs = Table("dispatch_jobs", db._METADATA,
    Column("id", String(64), primary_key=True),
    Column("order_id", String(120), nullable=False, index=True),
    Column("kind", String(40), nullable=False),
    Column("state", String(20), nullable=False),
    Column("due_at", Integer, nullable=False, index=True),
    Column("available_at", Integer, nullable=False, index=True),
    Column("attempts", Integer, nullable=False),
    Column("lease", String(64)),
    Column("last_error", String(80)))

workers = Table("dispatch_workers", db._METADATA,
    Column("id", String(64), primary_key=True),
    Column("last_seen", Integer, nullable=False))


def enabled() -> bool:
    return db.sql_storage_enabled() and os.getenv("POMICH_DISPATCH_ASYNC", "0") == "1"


def _epoch(value) -> int | None:
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return int(parsed.replace(tzinfo=timezone.utc).timestamp()) if parsed.tzinfo is None else int(parsed.timestamp())
    except (ValueError, TypeError, OverflowError):
        return None


def schedule_order_jobs(connection, order: dict) -> None:
    """Must run in the transaction which writes the order/offers."""
    from bot.delivery_store import insert_once
    order_id = str(order.get("id") or "")
    if not order_id:
        return
    status = order.get("status")
    timers: list[tuple[str, int]] = []
    if status == "searching":
        info = order.get("dispatchInfo") or {}
        if not info.get("wave"):
            timers.append(("dispatch.start", _epoch(info.get("lastAutoRetryAt")) or _epoch(order.get("createdAt")) or int(time.time())))
        due = _epoch(info.get("nextWaveAt"))
        if due is not None:
            timers.append(("dispatch.next_wave", due))
        for expires in connection.execute(select(db.dispatch_offers.c.expires_at).where(
                db.dispatch_offers.c.order_id == order_id, db.dispatch_offers.c.status == "pending")).scalars():
            due = _epoch(expires)
            if due is not None:
                timers.append(("offer.expire", due))
        # All offers can be declined before their deadline; retries must not wait
        # for a browser read. Each wave has its own stable, deduplicated timer.
        if info.get("wave") and not info.get("exhaustedAt"):
            timers.append(("dispatch.retry", (_epoch(info.get("lastDispatchAt")) or int(time.time())) + 8))
    elif status == "accepted":
        from bot.order_store import _order_accepted_at, ACCEPTED_IDLE_TIMEOUT_SECONDS
        accepted = _order_accepted_at(order)
        if accepted is not None:
            timers.append(("order.accepted_timeout", int(accepted.replace(tzinfo=timezone.utc).timestamp()) + ACCEPTED_IDLE_TIMEOUT_SECONDS))
    for kind, due in timers:
        generation = f":retry={int((order.get('dispatchInfo') or {}).get('autoRetryCount') or 0)}" if kind == "dispatch.start" else ""
        key = hashlib.sha256(f"{order_id}:{kind}:{due}{generation}".encode()).hexdigest()
        insert_once(connection, jobs, dict(id=key, order_id=order_id, kind=kind,
            state="pending", due_at=due, available_at=due, attempts=0))


def claim(now: int | None = None) -> dict | None:
    now = int(time.time()) if now is None else now
    eligible = and_(jobs.c.state.in_(["pending", "processing"]), jobs.c.available_at <= now)
    with db.get_engine().begin() as connection:
        query = select(jobs.c.id).where(eligible).order_by(jobs.c.available_at, jobs.c.id).limit(1)
        if connection.dialect.name == "postgresql":
            query = query.with_for_update(skip_locked=True)
        key = connection.execute(query).scalar()
        if key is None:
            return None
        row = connection.execute(update(jobs).where(jobs.c.id == key, eligible).values(
            state="processing", attempts=jobs.c.attempts + 1, available_at=now + 120,
            lease=uuid.uuid4().hex).returning(*jobs.c)).mappings().first()
        return dict(row) if row else None


def finish(job: dict, failed: bool) -> None:
    state = "dead" if failed and job["attempts"] >= 8 else "pending" if failed else "done"
    with db.get_engine().begin() as connection:
        connection.execute(update(jobs).where(jobs.c.id == job["id"], jobs.c.lease == job["lease"]).values(
            state=state, available_at=int(time.time()) + min(60, 2 ** job["attempts"]),
            lease=None, last_error="dispatch_failed" if failed else None))


def process_one() -> bool:
    job = claim()
    if job is None:
        return False
    try:
        from bot import order_store
        from bot.realtime import publish_order_event, publish_provider_event
        order = db.sql_get_order(job["order_id"])
        if order and order.get("status") in {"searching", "accepted"}:
            # Per-order advisory lock serializes different due timer kinds across
            # workers, without holding an order row while routing over HTTP.
            with db.get_engine().connect() as connection:
                postgres = connection.dialect.name == "postgresql"
                lock_key = int.from_bytes(hashlib.sha256(job["order_id"].encode()).digest()[:8], "big", signed=True)
                if postgres:
                    connection.exec_driver_sql("SELECT pg_advisory_lock(%s)", (lock_key,))
                try:
                    order = db.sql_get_order(job["order_id"])
                    if order and order.get("status") == "searching" and (
                            not (order.get("dispatchInfo") or {}).get("wave")
                            or (job["kind"] == "dispatch.next_wave" and (order.get("dispatchInfo") or {}).get("wave") == 1)):
                        order_store.dispatch_order(job["order_id"])
                    else:
                        order_store.expire_stale_and_notify(force=True, only_order_id=job["order_id"])
                finally:
                    if postgres:
                        connection.exec_driver_sql("SELECT pg_advisory_unlock(%s)", (lock_key,))
            order = db.sql_get_order(job["order_id"])
            publish_order_event(order)
            for offer in db.sql_offers_for_order(job["order_id"]):
                if offer.get("status") == "pending":
                    publish_provider_event(str(offer["providerId"]), "offers.changed", {"orderId": job["order_id"]})
    except Exception:
        import logging
        logging.getLogger(__name__).exception("Dispatch job failed: %s", job["id"])
        finish(job, True)
    else:
        finish(job, False)
    return True


def reconcile() -> None:
    """Recover timers for pre-release active orders and interrupted deployments."""
    last_id = ""
    while True:
        with db.get_engine().begin() as connection:
            page = connection.execute(select(db.orders.c.id, db.orders.c.payload).where(
                db.orders.c.status.in_(["searching", "accepted"]), db.orders.c.id > last_id)
                .order_by(db.orders.c.id).limit(200)).all()
            for order_id, order in page:
                schedule_order_jobs(connection, order)
        if not page:
            break
        last_id = page[-1][0]


def heartbeat(worker_id: str) -> None:
    from bot.delivery_store import insert_once
    now = int(time.time())
    with db.get_engine().begin() as connection:
        connection.execute(delete(workers).where(workers.c.last_seen < now - 86400))
        insert_once(connection, workers, dict(id=worker_id, last_seen=now))
        connection.execute(update(workers).where(workers.c.id == worker_id).values(last_seen=now))


def stats() -> dict:
    now = int(time.time())
    with db.get_engine().connect() as connection:
        counts = dict(connection.execute(select(jobs.c.state, func.count()).group_by(jobs.c.state)).all())
        oldest = connection.execute(select(func.min(jobs.c.due_at)).where(
            jobs.c.state.in_(["pending", "processing"]), jobs.c.due_at <= now)).scalar()
        last_seen = connection.execute(select(func.max(workers.c.last_seen))).scalar()
    return {**counts, "oldestDueSeconds": max(0, now - oldest) if oldest is not None else 0,
        "workerHealthy": last_seen is not None and now - last_seen < 30}
