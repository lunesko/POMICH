"""Transactional OTP persistence shared by every API worker.

The SQL lock serializes destination-wide cooldown checks as well as confirmation
attempts. Development can continue using the explicit JSON-file fallback.
"""
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime
from typing import Any

from sqlalchemy import Column, DateTime, Index, JSON, String, Table, delete, insert, select, text, update
from bot.runtime_store import _METADATA, get_engine

otp_codes = Table(
    "otp_codes", _METADATA,
    Column("customer_id", String(120), primary_key=True),
    Column("expires_at", DateTime),
    Column("payload", JSON, nullable=False),
)
Index("idx_otp_codes_expiry", otp_codes.c.expires_at)
_CONNECTION = ContextVar("otp_sql_connection", default=None)
# Stable database-wide advisory lock: checks span customer IDs and destinations.
_OTP_LOCK_ID = 1347374409


@contextmanager
def transaction(*, commit_errors: tuple[type[Exception], ...] = ()):
    existing = _CONNECTION.get()
    if existing is not None:
        yield
        return
    engine = get_engine()
    with engine.connect() as connection:
        if engine.dialect.name == "sqlite":
            connection.exec_driver_sql("BEGIN IMMEDIATE")
        else:
            connection.begin()
            connection.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": _OTP_LOCK_ID})
        token = _CONNECTION.set(connection)
        try:
            yield
        except commit_errors:
            # Invalid-code/expired responses intentionally persist attempts/deletions.
            connection.commit()
            raise
        except BaseException:
            connection.rollback()
            raise
        else:
            connection.commit()
        finally:
            _CONNECTION.reset(token)


def _connection():
    connection = _CONNECTION.get()
    if connection is None:
        raise RuntimeError("OTP SQL reads/writes require an OTP transaction")
    return connection


def load() -> dict[str, Any]:
    return {row.customer_id: dict(row.payload) for row in _connection().execute(select(otp_codes))}


def save(store: dict[str, Any]) -> None:
    connection = _connection()
    present = set(connection.execute(select(otp_codes.c.customer_id)).scalars())
    for customer_id, record in store.items():
        expires = record.get("expiresAt")
        expiry = datetime.fromisoformat(expires.replace("Z", "+00:00")).replace(tzinfo=None) if expires else None
        values = {"expires_at": expiry, "payload": record}
        if customer_id in present:
            connection.execute(update(otp_codes).where(otp_codes.c.customer_id == customer_id).values(**values))
        else:
            connection.execute(insert(otp_codes).values(customer_id=customer_id, **values))
    removed = present - set(store)
    if removed:
        connection.execute(delete(otp_codes).where(otp_codes.c.customer_id.in_(removed)))
