from __future__ import annotations

from fastapi import APIRouter, HTTPException
from sqlalchemy import text

from bot.api_deps import is_production_runtime
from bot.runtime_store import get_engine, sql_storage_enabled

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict:
    payload = {
        "status": "ok",
        "protocol": "fastapi",
        "runtime": "production" if is_production_runtime() else "dev",
    }
    try:
        if sql_storage_enabled():
            engine = get_engine()
            with engine.connect() as connection:
                connection.execute(text("SELECT 1"))
            payload["storage"] = {"backend": "sql", "ok": True, "dialect": engine.dialect.name}
        else:
            payload["storage"] = {"backend": "json", "ok": True}
    except Exception as exc:
        payload["status"] = "degraded"
        payload["storage"] = {"backend": "sql", "ok": False, "error": exc.__class__.__name__}
        raise HTTPException(status_code=503, detail=payload) from exc
    try:
        from bot.telegram_outbound import queue_stats

        payload["telegramQueue"] = queue_stats()
    except Exception:
        pass
    return payload
