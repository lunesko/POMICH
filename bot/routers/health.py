from __future__ import annotations

import hmac
import os

from fastapi import APIRouter, Header, HTTPException, Request

from bot.api_deps import is_production_runtime

router = APIRouter(tags=["health"])


def _detail_token_ok(provided: str | None) -> bool:
    expected = (os.environ.get("POMICH_HEALTH_DETAIL_TOKEN") or "").strip()
    if not expected:
        # Detail endpoint stays dark in production unless ops set a token.
        return not is_production_runtime()
    got = (provided or "").strip()
    if not got or len(got) != len(expected):
        return False
    return hmac.compare_digest(got, expected)


@router.get("/health")
def health() -> dict:
    """Public liveness — no runtime / queue internals (advertising-safe)."""
    return {"status": "ok"}


@router.get("/health/detail")
def health_detail(
    request: Request,
    x_pomich_health_token: str | None = Header(default=None, alias="X-POMICH-Health-Token"),
) -> dict:
    """Internal diagnostics. Requires POMICH_HEALTH_DETAIL_TOKEN in production."""
    if not _detail_token_ok(x_pomich_health_token):
        raise HTTPException(status_code=404, detail="Not found")
    payload: dict = {
        "status": "ok",
        "protocol": "fastapi",
        "runtime": "production" if is_production_runtime() else "dev",
        "path": request.url.path,
    }
    try:
        from bot.telegram_outbound import queue_stats

        payload["telegramQueue"] = queue_stats()
    except Exception:
        pass
    return payload
