"""One durable support case per order; independent of the order status writer."""
import os
import uuid
from pathlib import Path

from sqlalchemy import Column, JSON, String, Table, select, update
from bot import runtime_store
from bot.delivery_store import insert_once

cases = Table("support_cases", runtime_store._METADATA,
    Column("id", String(40), primary_key=True),
    Column("order_id", String(120), nullable=False, unique=True),
    Column("customer_id", String(120), nullable=False, index=True),
    Column("status", String(24), nullable=False, index=True),
    Column("created_at", String(40), nullable=False),
    Column("payload", JSON, nullable=False))


def _path():
    from bot.order_store import _default_store_path
    return Path(os.getenv("POMICH_SUPPORT_STORE_PATH") or _default_store_path().with_name("support_cases.json"))


def _load():
    path = _path()
    if not path.exists():
        return []
    # A damaged support file must fail visibly instead of discarding existing cases.
    import json
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


class SupportCaseOwnerUnavailable(ValueError):
    pass


def create_case(order: dict, customer_id: str, reason: str, description: str) -> dict:
    from bot.order_store import STORE_LOCK, _now_iso, _write_json_atomic
    now = _now_iso()
    payload = dict(id=f"SUP-{uuid.uuid4().hex[:12].upper()}", orderId=order["id"],
        customerId=customer_id, providerId=order.get("assignedProviderId") or order.get("partnerId"),
        orderStatus=order.get("status"), reason=reason, description=description,
        status="open", createdAt=now, updatedAt=now)
    if runtime_store.sql_storage_enabled():
        with runtime_store._locked_transaction() as conn:
            # Serialize against account erasure, including alias-owned orders.
            query = select(runtime_store.customers.c.payload).where(runtime_store.customers.c.id == customer_id)
            profile = conn.execute(runtime_store._for_update(query, conn.engine)).scalar_one_or_none()
            if profile is None or profile.get("accountStatus") == "disabled":
                raise SupportCaseOwnerUnavailable("customer_profile_unavailable")
            insert_once(conn, cases, dict(id=payload["id"], order_id=order["id"], customer_id=customer_id,
                status="open", created_at=now, payload=payload))
            return dict(conn.execute(select(cases.c.payload).where(cases.c.order_id == order["id"])).scalar_one())
    with STORE_LOCK:
        rows = _load()
        existing = next((row for row in rows if row["orderId"] == order["id"]), None)
        if existing:
            return existing
        rows.append(payload)
        _write_json_atomic(_path(), rows)
        return payload


def list_cases(*, order_id: str | None = None, offset: int = 0, limit: int = 200, status: str | None = None) -> list[dict]:
    offset, limit = max(0, offset), max(1, min(200, limit))
    statuses = {"open", "in_review"} if status == "unresolved" else {status} if status else None
    if runtime_store.sql_storage_enabled():
        query = select(cases.c.payload).order_by(cases.c.created_at.desc(), cases.c.id.desc()).offset(offset).limit(limit)
        if order_id:
            query = query.where(cases.c.order_id == order_id)
        if statuses:
            query = query.where(cases.c.status.in_(statuses))
        with runtime_store.get_engine().connect() as conn:
            return [dict(row) for row in conn.execute(query).scalars()]
    from bot.order_store import STORE_LOCK
    with STORE_LOCK:
        return sorted([row for row in _load() if (not order_id or row["orderId"] == order_id)
                       and (not statuses or row["status"] in statuses)],
            key=lambda row: (row["createdAt"], row["id"]), reverse=True)[offset:offset + limit]


def update_case(case_id: str, status: str, resolution: str) -> dict | None:
    from bot.order_store import STORE_LOCK, _now_iso, _write_json_atomic
    if runtime_store.sql_storage_enabled():
        with runtime_store.get_engine().begin() as conn:
            query = select(cases.c.payload).where(cases.c.id == case_id)
            if conn.dialect.name == "postgresql":
                query = query.with_for_update()
            row = conn.execute(query).scalar_one_or_none()
            if row is None:
                return None
            payload = {**row, "status": status, "resolution": resolution, "updatedAt": _now_iso()}
            conn.execute(update(cases).where(cases.c.id == case_id).values(status=status, payload=payload))
            return payload
    with STORE_LOCK:
        rows = _load()
        row = next((item for item in rows if item["id"] == case_id), None)
        if row is None:
            return None
        row.update(status=status, resolution=resolution, updatedAt=_now_iso())
        _write_json_atomic(_path(), rows)
        return row
