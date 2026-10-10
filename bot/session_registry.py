"""Durable session families; PostgreSQL in production, SQLite for local JSON mode."""
from __future__ import annotations

import os
import uuid
import time
from functools import lru_cache
from pathlib import Path

from sqlalchemy import Column, Integer, String, Table, create_engine, delete, insert, select, update

from bot import runtime_store

sessions = Table(
    "auth_session_families", runtime_store._METADATA,
    Column("id", String(64), primary_key=True),
    Column("role", String(24), nullable=False),
    Column("subject", String(120), nullable=False),
    Column("expires", Integer, nullable=False),
    Column("revoked", Integer, nullable=False, default=0),
)

refreshes = Table("auth_refresh_generations", runtime_store._METADATA,
    Column("id", String(64), primary_key=True),
    Column("generation", Integer, nullable=False),
    Column("rotated_at", Integer, nullable=False))


def rotate_refresh(sid: str, generation: int) -> int:
    """Rotate once; tolerate parallel tabs for 10s without extending the grace.

    Generations are signed inside the cookie. Reuse outside the short overlap
    revokes the whole family, including its outstanding access tokens.
    """
    now = int(time.time())
    result = None
    with _engine().begin() as connection:
        # A write lock serializes rotations on both SQLite and PostgreSQL.
        active = connection.execute(update(sessions).where(sessions.c.id == sid,
            sessions.c.revoked == 0, sessions.c.expires > now).values(revoked=0)).rowcount
        if active:
            row = connection.execute(select(refreshes).where(refreshes.c.id == sid)).mappings().first()
            if row is None and generation == 0:
                connection.execute(insert(refreshes).values(id=sid, generation=1, rotated_at=now))
                result = 1
            elif row and generation == row["generation"]:
                result = generation + 1
                connection.execute(update(refreshes).where(refreshes.c.id == sid)
                    .values(generation=result, rotated_at=now))
            elif row and generation == row["generation"] - 1 and now - row["rotated_at"] <= 10:
                result = row["generation"]
            else:
                connection.execute(update(sessions).where(sessions.c.id == sid).values(revoked=1))
    if result is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="refresh_reuse_or_revoked")
    return result


@lru_cache(maxsize=128)
def _local_engine(filename: str):
    path = Path(filename)
    path.parent.mkdir(parents=True, exist_ok=True)
    # A separate persistent local database keeps logout valid across restarts.
    engine = create_engine("sqlite:///" + path.as_posix(), connect_args={"check_same_thread": False})
    tables = [sessions, refreshes]
    for name in ("realtime_tickets", "realtime_account_locks", "realtime_connection_leases"):
        table = runtime_store._METADATA.tables.get(name)
        if table is not None:
            tables.append(table)
    runtime_store._METADATA.create_all(engine, tables=tables)
    return engine


def _engine():
    if runtime_store.sql_storage_enabled():
        return runtime_store.get_engine()
    return _local_engine(os.getenv("POMICH_AUTH_DB_PATH", "data/auth-sessions.sqlite3"))


def create_family(role: str, subject: str, expires: int) -> str:
    sid = uuid.uuid4().hex
    with _engine().begin() as connection:
        connection.execute(delete(sessions).where(sessions.c.expires <= int(time.time())))
        connection.execute(insert(sessions).values(id=sid, role=role, subject=subject, expires=expires, revoked=0))
    return sid


def family_active(sid: str, role: str, subject: str, now: int) -> bool:
    with _engine().connect() as connection:
        return connection.execute(select(sessions.c.id).where(
            sessions.c.id == sid, sessions.c.role == role, sessions.c.subject == subject,
            sessions.c.revoked == 0, sessions.c.expires > now,
        )).first() is not None


def revoke_family(sid: str) -> None:
    with _engine().begin() as connection:
        connection.execute(update(sessions).where(sessions.c.id == sid).values(revoked=1))


def revoke_subject(role: str, subject: str) -> None:
    with _engine().begin() as connection:
        connection.execute(update(sessions).where(sessions.c.role == role, sessions.c.subject == subject).values(revoked=1))
