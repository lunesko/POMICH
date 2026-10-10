"""Database-backed per-account connection leases shared by all API workers."""
import hashlib
import os
import time
import uuid
from fastapi import HTTPException
from sqlalchemy import Column, Integer, String, Table, delete, func, insert, select, update
from bot import runtime_store, session_registry
from bot.delivery_store import insert_once

buckets = Table("realtime_account_locks", runtime_store._METADATA,
    Column("id", String(64), primary_key=True), Column("touched", Integer, nullable=False))
leases = Table("realtime_connection_leases", runtime_store._METADATA,
    Column("id", String(64), primary_key=True),
    Column("owner", String(64), nullable=False, index=True),
    Column("expires", Integer, nullable=False, index=True))


def acquire(principal) -> str:
    owner = hashlib.sha256(f"{principal.role}:{principal.subject_id}".encode()).hexdigest()
    now, lease = int(time.time()), uuid.uuid4().hex
    limit = max(1, min(32, int(os.getenv("POMICH_REALTIME_CONNECTION_LIMIT", "6"))))
    with session_registry._engine().begin() as connection:
        insert_once(connection, buckets, dict(id=owner, touched=now))
        connection.execute(update(buckets).where(buckets.c.id == owner).values(touched=now))
        connection.execute(delete(leases).where(leases.c.expires <= now))
        count = connection.scalar(select(func.count()).select_from(leases).where(leases.c.owner == owner))
        if count >= limit:
            raise HTTPException(status_code=429, detail="realtime_connection_limit", headers={"Retry-After": "45"})
        connection.execute(insert(leases).values(id=lease, owner=owner, expires=min(now + 45, principal.expires_at)))
    return lease


def guard(principal, lease: str):
    from bot.realtime_auth import principal_active
    renewed = 0
    def active():
        nonlocal renewed
        if not principal_active(principal):
            return False
        now = int(time.time())
        if now - renewed >= 15:
            with session_registry._engine().begin() as connection:
                found = connection.execute(update(leases).where(leases.c.id == lease, leases.c.expires > now)
                    .values(expires=min(now + 45, principal.expires_at))).rowcount
            if not found:
                return False
            renewed = now
        return True
    return active


def release(lease: str) -> None:
    with session_registry._engine().begin() as connection:
        connection.execute(delete(leases).where(leases.c.id == lease))
