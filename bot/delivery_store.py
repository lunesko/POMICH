"""Transactional Telegram outbox. Rows contain references, not credential/PII copies."""
from __future__ import annotations

import hashlib
import time
import uuid
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, String, Table, and_, select, update
from bot import runtime_store

outbox = Table("telegram_outbox", runtime_store._METADATA,
    Column("id", String(64), primary_key=True),
    Column("kind", String(40), nullable=False),
    Column("order_id", String(120), nullable=False),
    Column("offer_id", String(120)),
    Column("state", String(24), nullable=False),
    Column("attempts", Integer, nullable=False),
    Column("available_at", Integer, nullable=False, index=True),
    Column("lease", String(64)),
    Column("last_error", String(120)))


def insert_once(connection, table, values):
    if connection.dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    return connection.execute(insert(table).values(**values).on_conflict_do_nothing()
        .returning(*table.primary_key.columns)).first()


def schedule_order_notifications(connection, order: dict) -> None:
    """Called inside the transaction that persists the order and its dispatch events."""
    order_id = str(order.get("id") or "")
    if not order_id:
        return
    jobs = []
    if order.get("notify") and order.get("chatId"):
        jobs.append(("created", ""))
    if order.get("status") == "accepted" and order.get("assignedProviderId"):
        jobs.append(("accepted", ""))
    if order.get("status") == "cancelled":
        jobs.append(("cancelled", ""))
    for event in order.get("dispatchEvents") or []:
        if event.get("type") == "OFFER_CREATED" and event.get("offerId"):
            jobs.append(("offer", str(event["offerId"])))
    for kind, offer_id in jobs:
        key = hashlib.sha256(f"{order_id}:{kind}:{offer_id}".encode()).hexdigest()
        insert_once(connection, outbox, dict(id=key, kind=kind, order_id=order_id, offer_id=offer_id,
            state="pending", attempts=0, available_at=int(time.time())))


def claim_job(now: int | None = None) -> dict | None:
    now = int(time.time()) if now is None else now
    eligible = and_(outbox.c.state.in_(["pending", "processing"]), outbox.c.available_at <= now)
    with runtime_store.get_engine().begin() as connection:
        query = select(outbox.c.id).where(eligible).order_by(outbox.c.available_at, outbox.c.id).limit(1)
        if connection.dialect.name == "postgresql":
            query = query.with_for_update(skip_locked=True)
        row = connection.execute(query).first()
        if row is None:
            return None
        leased = connection.execute(update(outbox).where(outbox.c.id == row[0], eligible)
            .values(state="processing", attempts=outbox.c.attempts + 1,
                    available_at=now + 300, lease=uuid.uuid4().hex)
            .returning(*outbox.c)).mappings().first()
        return dict(leased) if leased else None


def finish_job(job: dict, *, failed: bool, now: int | None = None) -> None:
    now = int(time.time()) if now is None else now
    state = "dead" if failed and job["attempts"] >= 8 else "pending" if failed else "done"
    with runtime_store.get_engine().begin() as connection:
        connection.execute(update(outbox).where(outbox.c.id == job["id"], outbox.c.lease == job["lease"])
            .values(state=state, available_at=now + min(300, 2 ** job["attempts"]),
                    last_error="telegram_delivery_failed" if failed else None, lease=None))


def deliver_job(job: dict) -> None:
    from bot import telegram_bot, order_store
    order = order_store.get_order(job["order_id"])
    if not order:
        return
    kind = job["kind"]
    if kind == "created":
        if order.get("status") != "searching":
            return
        result = telegram_bot._notify_order_created_sync(str(order.get("chatId") or ""), order)
    elif kind == "accepted":
        if order.get("status") != "accepted":
            return
        result = telegram_bot._notify_order_accepted_sync(order)
    elif kind == "cancelled":
        result = telegram_bot._notify_order_cancelled_sync(order)
    elif kind == "offer":
        if order.get("status") != "searching":
            return
        offers = runtime_store.sql_offers_for_order(job["order_id"])
        offers = [offer for offer in offers if str(offer.get("id")) == job["offer_id"] and offer.get("status") == "pending"]
        if not offers:
            return
        expires = order_store._parse_iso(offers[0].get("expiresAt"))
        if expires is not None and expires <= datetime.now(timezone.utc).replace(tzinfo=None):
            return
        result = telegram_bot._notify_dispatch_offers_sync(order, offers)
    else:
        raise ValueError("unsupported_outbox_job")
    results = result if isinstance(result, list) else [result]
    if any(isinstance(item, dict) and item.get("ok") is False for item in results):
        raise RuntimeError("telegram_delivery_failed")


def process_one() -> bool:
    job = claim_job()
    if job is None:
        return False
    try:
        deliver_job(job)
    except Exception:
        finish_job(job, failed=True)
    else:
        finish_job(job, failed=False)
    return True


def outbox_stats() -> dict:
    from sqlalchemy import func
    now = int(time.time())
    with runtime_store.get_engine().connect() as connection:
        counts = dict(connection.execute(select(outbox.c.state, func.count()).group_by(outbox.c.state)).all())
        oldest = connection.execute(select(func.min(outbox.c.available_at)).where(
            outbox.c.state.in_(["pending", "processing"]))).scalar_one_or_none()
    counts["oldestPendingSeconds"] = max(0, now - int(oldest)) if oldest is not None else 0
    return counts
