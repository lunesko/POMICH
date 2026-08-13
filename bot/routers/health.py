from __future__ import annotations

from fastapi import APIRouter

from bot.api_deps import is_production_runtime

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "protocol": "fastapi", "runtime": "production" if is_production_runtime() else "dev"}
