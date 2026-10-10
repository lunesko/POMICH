"""A caller-scoped create key is committed in the same transaction as its order."""
import hashlib
import json
import time
from sqlalchemy import Column, Integer, String, Table, delete, select
from bot import runtime_store
from bot.delivery_store import insert_once

keys = Table("order_creation_keys", runtime_store._METADATA,
    Column("id", String(64), primary_key=True),
    Column("fingerprint", String(64), nullable=False),
    Column("order_id", String(120), nullable=False),
    Column("expires", Integer, nullable=False, index=True))


class IdempotencyConflict(ValueError):
    pass


def fingerprint(payload: dict) -> str:
    data = {key: value for key, value in payload.items() if key not in {
        "telegramInitData", "telegramUsername", "telegramFirstName", "telegramUserId", "chatId"}}
    return hashlib.sha256(json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()


def scoped_key(customer_id: str, key: str) -> str:
    return hashlib.sha256(json.dumps([customer_id, key], separators=(",", ":")).encode()).hexdigest()


def claim(connection, customer_id: str, key: str, request_hash: str, order_id: str) -> dict | None:
    digest = scoped_key(customer_id, key)
    now = int(time.time())
    connection.execute(delete(keys).where(keys.c.id == digest, keys.c.expires <= now))
    inserted = insert_once(connection, keys, dict(id=digest, fingerprint=request_hash,
        order_id=order_id, expires=now + 86400))
    if inserted is not None:
        return None
    row = connection.execute(select(keys).where(keys.c.id == digest)).mappings().one()
    if row["fingerprint"] != request_hash:
        raise IdempotencyConflict("idempotency_key_payload_mismatch")
    existing = connection.execute(select(runtime_store.orders.c.payload)
        .where(runtime_store.orders.c.id == row["order_id"])).first()
    if existing is None:
        raise IdempotencyConflict("idempotency_result_unavailable")
    return dict(existing[0])
