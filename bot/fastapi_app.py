"""POMICH FastAPI application factory.

HTTP routes live in bot.routers.*; shared auth/config helpers live in bot.api_deps.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
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
from bot.routers import admin, auth, customers, events, health, orders, providers, telegram, ws
from bot.telegram_bot import notify_order_accepted, notify_order_cancelled, notify_order_created

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DIST_DIR = PROJECT_ROOT / "dist"
ASSETS_DIR = DIST_DIR / "assets"
_DIST_GEO_DIR = DIST_DIR / "geo"
_PUBLIC_GEO_DIR = PROJECT_ROOT / "public" / "geo"
GEO_DIR = _DIST_GEO_DIR if _DIST_GEO_DIR.is_dir() else _PUBLIC_GEO_DIR
DATA_GEO_DIR = PROJECT_ROOT / "data" / "geo"

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
    ws.router,
)

for router in _API_ROUTERS:
    app.include_router(router)
    app.include_router(router, prefix="/api")

if ASSETS_DIR.exists():
    app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")

def _resolve_geo_file(filename: str) -> Path | None:
    for base in (GEO_DIR, DATA_GEO_DIR):
        candidate = base / filename
        if candidate.is_file():
            return candidate
    return None


if GEO_DIR.exists():
    app.mount("/geo", StaticFiles(directory=GEO_DIR), name="geo")
elif DATA_GEO_DIR.exists():
    app.mount("/geo", StaticFiles(directory=DATA_GEO_DIR), name="geo")

_INDEX_NO_CACHE_HEADERS = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
}


def _resolve_dist_root_file(normalized: str) -> Path | None:
    """Serve Vite public/root artifacts (pomich-sw.js, favicon, etc.) before SPA fallback."""
    if not normalized or "/" in normalized or normalized.startswith("."):
        return None
    candidate = (DIST_DIR / normalized).resolve()
    if candidate.parent != DIST_DIR.resolve() or not candidate.is_file():
        return None
    return candidate


@app.get("/robots.txt")
def robots_txt():
    robots_path = DIST_DIR / "robots.txt"
    if robots_path.exists():
        return FileResponse(robots_path, media_type="text/plain")
    return {"detail": "robots.txt not built"}


@app.get("/")
@app.get("/{full_path:path}")
def serve_frontend(full_path: str = ""):
    normalized = str(full_path or "").lstrip("/")
    if normalized.startswith("geo/"):
        geo_name = normalized.removeprefix("geo/")
        geo_path = _resolve_geo_file(geo_name)
        if geo_path is not None:
            return FileResponse(geo_path, media_type="application/geo+json")
        raise HTTPException(status_code=404, detail="GeoJSON file not found")
    if normalized.startswith("assets/"):
        raise HTTPException(status_code=404, detail="Asset not found")

    root_file = _resolve_dist_root_file(normalized)
    if root_file is not None:
        headers = {"Cache-Control": "no-cache"} if root_file.name == "pomich-sw.js" else None
        return FileResponse(root_file, headers=headers)

    index_path = DIST_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path, headers=_INDEX_NO_CACHE_HEADERS)
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
