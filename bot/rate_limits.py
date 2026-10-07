"""Application-level fixed-window limits, atomic across SQL workers."""
import asyncio
import hashlib
import os
import threading
import time
from sqlalchemy import Column, Integer, String, Table, delete
from starlette.responses import JSONResponse
from bot.storage.schema import _METADATA

api_rate_limits = Table(
    "api_rate_limits", _METADATA,
    Column("key", String(64), primary_key=True),
    Column("count", Integer, nullable=False),
    Column("expires_at", Integer, nullable=False),
)
_LOCAL_LOCK = threading.Lock()
_LOCAL: dict[str, tuple[int, int]] = {}


def _take(key: str, expires: int) -> int:
    from bot.runtime_store import sql_storage_enabled, get_engine
    now = int(time.time())
    if sql_storage_enabled():
        engine = get_engine()
        if engine.dialect.name == "postgresql":
            from sqlalchemy.dialects.postgresql import insert
        else:
            from sqlalchemy.dialects.sqlite import insert
        statement = insert(api_rate_limits).values(key=key, count=1, expires_at=expires)
        statement = statement.on_conflict_do_update(index_elements=[api_rate_limits.c.key],
            set_={"count": api_rate_limits.c.count + 1}).returning(api_rate_limits.c.count)
        with engine.begin() as connection:
            connection.execute(delete(api_rate_limits).where(api_rate_limits.c.expires_at <= now))
            return int(connection.execute(statement).scalar_one())
    with _LOCAL_LOCK:
        for stale in [key for key, (_, expiry) in _LOCAL.items() if expiry <= now]:
            del _LOCAL[stale]
        count = _LOCAL.get(key, (0, expires))[0] + 1
        _LOCAL[key] = (count, expires)
        return count


class ApiRateLimitMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        runtime = (os.getenv("POMICH_RUNTIME") or os.getenv("VITE_APP_ENV") or "dev").strip().lower()
        enabled = os.getenv("POMICH_RATE_LIMITS_ENABLED", "1" if runtime in {"prod", "production"} else "0")
        path = scope.get("path", "")
        if (scope["type"] != "http" or enabled.strip().lower() not in {"1", "true", "yes", "on"} or not path.startswith("/api/")
                or scope.get("method") == "OPTIONS" or path.startswith(("/api/telegram/", "/api/health", "/api/events/", "/api/ws/"))):
            await self.app(scope, receive, send)
            return
        group = "login" if "/auth/" in path else "read" if scope["method"] in {"GET", "HEAD"} else "write"
        default = {"login": 20, "read": 600, "write": 120}[group]
        limit = max(1, int(os.getenv(f"POMICH_RATE_LIMIT_{group.upper()}_PER_MINUTE", str(default))))
        now = int(time.time())
        expires = (now // 60 + 1) * 60
        # Do not trust X-Forwarded-For or arbitrary tokens; uvicorn resolves trusted proxy IPs.
        host = (scope.get("client") or ("unknown",))[0]
        key = hashlib.sha256(f"{host}:{group}:{now // 60}".encode()).hexdigest()
        count = await asyncio.to_thread(_take, key, expires)
        if count > limit:
            response = JSONResponse(status_code=429, content={"detail": {"code": "rate_limit_exceeded",
                "retryAfterSeconds": expires - now}}, headers={"Retry-After": str(expires - now)})
            await response(scope, receive, send)
            return
        await self.app(scope, receive, send)
