from __future__ import annotations

from fastapi import APIRouter

from bot.api_deps import is_production_runtime

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict:
    payload = {
        "status": "ok",
        "protocol": "fastapi",
        "runtime": "production" if is_production_runtime() else "dev",
    }
    try:
        from bot.telegram_outbound import queue_stats

        payload["telegramQueue"] = queue_stats()
    except Exception:
        pass
    return payload
