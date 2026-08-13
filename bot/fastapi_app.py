"""POMICH FastAPI application factory.

HTTP routes live in bot.routers.*; shared auth/config helpers live in bot.api_deps.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from bot.api_deps import (
    AuthPrincipal,
    get_cors_origins,
    is_production_runtime,
    runtime_config_errors,
    validate_runtime_config,
)
from bot.routers import admin, auth, customers, events, health, orders, providers, telegram
from bot.telegram_bot import notify_order_accepted, notify_order_cancelled, notify_order_created

DIST_DIR = Path(__file__).resolve().parent.parent / "dist"
ASSETS_DIR = DIST_DIR / "assets"

# Backwards-compatible aliases used by tests and older imports.
_is_production_runtime = is_production_runtime
_runtime_config_errors = runtime_config_errors
_validate_runtime_config = validate_runtime_config
_get_cors_origins = get_cors_origins

validate_runtime_config()

app = FastAPI(title="POMICH MVP", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_API_ROUTERS = (
    health.router,
    admin.router,
    auth.router,
    customers.router,
    providers.router,
    orders.router,
    telegram.router,
    events.router,
)

for router in _API_ROUTERS:
    app.include_router(router)
    app.include_router(router, prefix="/api")

if ASSETS_DIR.exists():
    app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")


@app.get("/robots.txt")
def robots_txt():
    robots_path = DIST_DIR / "robots.txt"
    if robots_path.exists():
        return FileResponse(robots_path, media_type="text/plain")
    return {"detail": "robots.txt not built"}


@app.get("/")
@app.get("/{full_path:path}")
def serve_frontend(full_path: str = ""):
    index_path = DIST_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return {"detail": "Frontend build is missing. Run npm run build first."}


__all__ = [
    "AuthPrincipal",
    "app",
    "notify_order_accepted",
    "notify_order_cancelled",
    "notify_order_created",
    "_get_cors_origins",
    "_is_production_runtime",
    "_runtime_config_errors",
    "_validate_runtime_config",
]
