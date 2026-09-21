"""Internal readiness and metrics — nginx-restricted; metrics also token-gated."""

from __future__ import annotations

import hmac
import os
import time

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import JSONResponse

from bot.api_deps import is_production_runtime

router = APIRouter(tags=["internal"])

_PROCESS_STARTED_AT = time.time()


def _internal_token_ok(provided: str | None) -> bool:
    expected = (
        os.environ.get("POMICH_INTERNAL_TOKEN") or os.environ.get("POMICH_HEALTH_DETAIL_TOKEN") or ""
    ).strip()
    if not expected:
        return not is_production_runtime()
    got = (provided or "").strip()
    if not got or len(got) != len(expected):
        return False
    return hmac.compare_digest(got, expected)


def _postgres_ready() -> tuple[bool, str]:
    try:
        from bot.runtime_store import get_engine, sql_storage_enabled

        if not sql_storage_enabled():
            return True, "sql_disabled"
        engine = get_engine()
        with engine.connect() as conn:
            conn.exec_driver_sql("SELECT 1")
        return True, "ok"
    except Exception as exc:  # noqa: BLE001 — readiness must never raise
        return False, type(exc).__name__


@router.get("/internal/ready")
def ready() -> JSONResponse:
    """App + PostgreSQL readiness (public path blocked at nginx; container-local OK)."""
    pg_ok, pg_detail = _postgres_ready()
    payload = {
        "status": "ok" if pg_ok else "not_ready",
        "postgres": pg_detail,
        "uptimeSeconds": int(time.time() - _PROCESS_STARTED_AT),
    }
    return JSONResponse(payload, status_code=200 if pg_ok else 503)


@router.get("/internal/metrics")
def metrics(
    x_pomich_internal_token: str | None = Header(default=None, alias="X-POMICH-Internal-Token"),
) -> dict:
    """Internal counters — require POMICH_INTERNAL_TOKEN (or HEALTH_DETAIL_TOKEN) in production."""
    if not _internal_token_ok(x_pomich_internal_token):
        raise HTTPException(status_code=404, detail="Not found")
    payload: dict = {
        "status": "ok",
        "uptimeSeconds": int(time.time() - _PROCESS_STARTED_AT),
        "runtime": "production" if is_production_runtime() else "dev",
    }
    try:
        from bot.telegram_outbound import queue_stats

        payload["telegramQueue"] = queue_stats()
    except Exception:
        pass
    try:
        from bot import realtime

        stats_fn = getattr(realtime, "realtime_stats", None)
        if callable(stats_fn):
            payload["realtime"] = stats_fn()
    except Exception:
        pass
    return payload
