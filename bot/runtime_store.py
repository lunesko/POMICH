import json
import os
import threading
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Column, DateTime, MetaData, String, Table, create_engine, delete, insert, select
from sqlalchemy.engine import Engine

_STORE_LOCK = threading.RLock()
_ENGINE: Engine | None = None
_ENGINE_URL: str | None = None
_METADATA = MetaData()

runtime_collections = Table(
    "pomich_runtime_collections",
    _METADATA,
    Column("name", String(80), primary_key=True),
    Column("payload", JSON, nullable=False),
    Column("updated_at", DateTime, nullable=False),
)


def _database_url() -> str:
    url = (os.getenv("DATABASE_URL") or "").strip()
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url.removeprefix("postgres://")
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url.removeprefix("postgresql://")
    return url


def sql_storage_enabled() -> bool:
    backend = (os.getenv("POMICH_STORAGE_BACKEND") or "").strip().lower()
    if backend in {"json", "file", "files"}:
        return False
    if backend in {"sql", "database", "postgres", "postgresql"}:
        return bool(_database_url())
    return bool(_database_url())


def get_engine() -> Engine:
    global _ENGINE, _ENGINE_URL
    url = _database_url()
    if not url:
        raise RuntimeError("DATABASE_URL is required for SQL runtime storage")

    with _STORE_LOCK:
        if _ENGINE is None or _ENGINE_URL != url:
            connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
            _ENGINE = create_engine(url, future=True, pool_pre_ping=True, connect_args=connect_args)
            _ENGINE_URL = url
            _METADATA.create_all(_ENGINE)
        return _ENGINE


def reset_runtime_store_for_tests() -> None:
    global _ENGINE, _ENGINE_URL
    with _STORE_LOCK:
        if _ENGINE is not None:
            _ENGINE.dispose()
        _ENGINE = None
        _ENGINE_URL = None


def _json_safe_copy(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False))


def load_collection(name: str) -> tuple[bool, Any]:
    engine = get_engine()
    with engine.begin() as connection:
        row = connection.execute(
            select(runtime_collections.c.payload).where(runtime_collections.c.name == name)
        ).first()

    if row is None:
        return False, None
    return True, _json_safe_copy(row[0])


def save_collection(name: str, payload: Any) -> Any:
    stored_payload = _json_safe_copy(payload)
    engine = get_engine()
    with engine.begin() as connection:
        connection.execute(delete(runtime_collections).where(runtime_collections.c.name == name))
        connection.execute(
            insert(runtime_collections).values(
                name=name,
                payload=stored_payload,
                updated_at=datetime.utcnow(),
            )
        )
    return _json_safe_copy(stored_payload)
