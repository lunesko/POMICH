"""Customer export/erasure and the agreed 180-day terminal-order retention."""
from datetime import datetime, timedelta, timezone
import logging
import threading
from sqlalchemy import delete, select, update, or_
from fastapi import HTTPException
from bot import runtime_store as db, session_registry
from bot.delivery_store import outbox
from bot.order_idempotency import keys

TERMINAL = ("completed", "cancelled")
RETENTION_DAYS = 180
_STOP = threading.Event()
_THREAD = None


def _require_sql():
    if not db.sql_storage_enabled():
        raise HTTPException(status_code=503, detail="data_lifecycle_requires_sql")


def _delete_orders(connection, ids):
    if not ids:
        return
    for table in (db.order_events, db.dispatch_offers, outbox, keys):
        connection.execute(delete(table).where(table.c.order_id.in_(ids)))
    connection.execute(delete(db.orders).where(db.orders.c.id.in_(ids)))
    # Legacy whole-collection snapshots must not preserve deleted personal data.
    connection.execute(delete(db.runtime_collections).where(db.runtime_collections.c.name.in_(
        ["orders", "offers", "customers", "telegram_sessions"])))
    row = connection.execute(select(db.runtime_collections).where(db.runtime_collections.c.name == "ops_log")).mappings().first()
    if row and isinstance(row["payload"], list):
        connection.execute(update(db.runtime_collections).where(db.runtime_collections.c.name == "ops_log")
            .values(payload=[item for item in row["payload"] if item.get("orderId") not in ids]))


def purge_expired_orders(*, now=None, dry_run=True) -> dict:
    _require_sql()
    now = now or datetime.now(timezone.utc).replace(tzinfo=None)
    cutoff = now - timedelta(days=RETENTION_DAYS)
    with db.get_engine().begin() as connection:
        query = select(db.orders.c.id).where(db.orders.c.status.in_(TERMINAL),
            db.orders.c.updated_at < cutoff.isoformat()).order_by(db.orders.c.updated_at).limit(1000)
        if connection.dialect.name == "postgresql":
            query = query.with_for_update(skip_locked=True)
        ids = list(connection.execute(query).scalars())
        if not dry_run:
            _delete_orders(connection, ids)
    return {"matched": len(ids), "deleted": 0 if dry_run else len(ids), "retentionDays": RETENTION_DAYS}


def export_customer(customer_id: str) -> dict:
    from bot.order_store import get_customer_profile
    _require_sql()
    profile = dict(get_customer_profile(customer_id) or {})
    # Internal verification proofs are not needed for a personal data download.
    profile.pop("otp", None)
    owned = db.orders.c.customer_id == customer_id
    if customer_id.startswith("tg-"):
        owned = or_(owned, db.orders.c.chat_id == customer_id[3:])
    with db.get_engine().connect() as connection:
        orders = list(connection.execute(select(db.orders.c.payload).where(owned)).scalars())
    return {"customerId": customer_id, "profile": profile, "orders": orders,
        "exportedAt": datetime.now(timezone.utc).isoformat()}


def erase_customer(customer_id: str) -> dict:
    from bot import otp_verification
    _require_sql()
    with db.get_engine().begin() as connection:
        # Lock the profile so account changes cannot race the eligibility check.
        query = select(db.customers).where(db.customers.c.id == customer_id)
        if connection.dialect.name == "postgresql":
            query = query.with_for_update()
        profile = connection.execute(query).mappings().first()
        if profile and profile["payload"].get("linkedProviderId"):
            raise HTTPException(status_code=409, detail="linked_provider_requires_support_erasure")
        owned = db.orders.c.customer_id == customer_id
        if customer_id.startswith("tg-"):
            owned = or_(owned, db.orders.c.chat_id == customer_id[3:])
        rows = connection.execute(select(db.orders.c.id, db.orders.c.status).where(owned)).all()
        if any(row.status not in TERMINAL for row in rows):
            raise HTTPException(status_code=409, detail="active_orders_prevent_erasure")
        _delete_orders(connection, [row.id for row in rows])
        connection.execute(delete(db.customers).where(db.customers.c.id == customer_id))
        connection.execute(delete(db.runtime_collections).where(db.runtime_collections.c.name.in_(["customers", "telegram_sessions"])))
        if customer_id.startswith("tg-"):
            connection.execute(delete(db.sessions).where(db.sessions.c.chat_id == customer_id[3:]))
        connection.execute(update(session_registry.sessions).where(session_registry.sessions.c.role == "customer",
            session_registry.sessions.c.subject == customer_id).values(revoked=1))
    # OTP records are a separate local store; remove the challenge as well.
    with otp_verification.STORE_LOCK:
        records = otp_verification._load_otp_store()
        records.pop(customer_id, None)
        otp_verification._save_otp_store(records)
    return {"deleted": True, "customerId": customer_id, "deletedOrders": len(rows)}


def _run():
    while not _STOP.is_set():
        try:
            result = purge_expired_orders(dry_run=False)
            if result["deleted"]:
                logging.getLogger(__name__).info("Retention removed %s terminal orders", result["deleted"])
        except Exception:
            logging.getLogger(__name__).exception("Retention job failed")
        _STOP.wait(3600)


def start():
    global _THREAD
    if not db.sql_storage_enabled() or (_THREAD and _THREAD.is_alive()):
        return
    _STOP.clear()
    _THREAD = threading.Thread(target=_run, name="pomich-retention", daemon=True)
    _THREAD.start()


def stop():
    _STOP.set()
    if _THREAD:
        _THREAD.join(timeout=3)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Delete eligible terminal orders; default is dry-run")
    print(purge_expired_orders(dry_run=not parser.parse_args().apply))
