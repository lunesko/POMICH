"""POMICH FastAPI application factory.

HTTP routes live in bot.routers.*; shared auth/config helpers live in bot.api_deps.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.gzip import GZipMiddleware

from bot.api_deps import (
    AuthPrincipal,
    get_cors_origins,
    is_production_runtime,
    runtime_config_errors,
    validate_runtime_config,
)
from bot.routers import admin, auth, customers, events, health, orders, providers, telegram, ws
from bot.telegram_bot import notify_dispatch_offers, notify_order_accepted, notify_order_cancelled, notify_order_created
from bot.runtime_store import get_engine, sql_storage_enabled
from bot.telegram_outbound import ensure_telegram_workers

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DIST_DIR = PROJECT_ROOT / "dist"
ASSETS_DIR = DIST_DIR / "assets"
_DIST_GEO_DIR = DIST_DIR / "geo"
_PUBLIC_GEO_DIR = PROJECT_ROOT / "public" / "geo"
GEO_DIR = _DIST_GEO_DIR if _DIST_GEO_DIR.is_dir() else _PUBLIC_GEO_DIR
DATA_GEO_DIR = PROJECT_ROOT / "data" / "geo"
_DIST_MAPS_DIR = DIST_DIR / "maps"
_PUBLIC_MAPS_DIR = PROJECT_ROOT / "public" / "maps"
MAPS_DIR = _DIST_MAPS_DIR if _DIST_MAPS_DIR.is_dir() else _PUBLIC_MAPS_DIR

# Backwards-compatible aliases used by tests and older imports.
_is_production_runtime = is_production_runtime
_runtime_config_errors = runtime_config_errors
_validate_runtime_config = validate_runtime_config
_get_cors_origins = get_cors_origins

validate_runtime_config()

class CachedStaticFiles(StaticFiles):
    def __init__(self, *args, cache_control: str = "public, max-age=31536000, immutable", **kwargs):
        super().__init__(*args, **kwargs)
        self.cache_control = cache_control

    def file_response(self, *args, **kwargs):
        response = super().file_response(*args, **kwargs)
        response.headers.setdefault("Cache-Control", self.cache_control)
        return response


app = FastAPI(title="POMICH MVP", version="0.1.0")


@app.on_event("startup")
def _warm_runtime_on_startup() -> None:
    ensure_telegram_workers()
    if sql_storage_enabled():
        get_engine()


app.add_middleware(GZipMiddleware, minimum_size=400)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_cors_origins(),
    allow_origin_regex=r"https://.*\.trycloudflare\.com",
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
    app.mount("/assets", CachedStaticFiles(directory=ASSETS_DIR), name="assets")

def _resolve_geo_file(filename: str) -> Path | None:
    for base in (GEO_DIR, DATA_GEO_DIR):
        candidate = base / filename
        if candidate.is_file():
            return candidate
    return None


def _resolve_maps_file(filename: str) -> Path | None:
    if not filename or filename.startswith(".") or ".." in filename.split("/"):
        return None
    for base in (MAPS_DIR, _PUBLIC_MAPS_DIR, _DIST_MAPS_DIR):
        candidate = (base / filename).resolve()
        try:
            candidate.relative_to(base.resolve())
        except ValueError:
            continue
        if not candidate.is_file():
            continue
        # Never serve Git LFS pointer stubs as images.
        try:
            head = candidate.read_bytes()[:64]
        except OSError:
            continue
        if head.startswith(b"version https://git-lfs.github.com/spec/v1"):
            continue
        return candidate
    return None


_GEO_CACHE_CONTROL = "public, max-age=3600"
_MAPS_CACHE_CONTROL = "public, max-age=86400"

if GEO_DIR.exists():
    app.mount("/geo", CachedStaticFiles(directory=GEO_DIR, cache_control=_GEO_CACHE_CONTROL), name="geo")
elif DATA_GEO_DIR.exists():
    app.mount("/geo", CachedStaticFiles(directory=DATA_GEO_DIR, cache_control=_GEO_CACHE_CONTROL), name="geo")

# Maps are served only via serve_frontend → _resolve_maps_file (not StaticFiles mount).
# A mount binds the directory at import time and breaks tests / can serve Git LFS pointers.

_INDEX_NO_CACHE_HEADERS = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
}

# Dotfiles and VCS/config paths must never fall through to SPA index.html (scanners get HTML 200).
_SENSITIVE_SPA_PREFIXES = (
    ".env",
    ".git",
    ".svn",
    ".hg",
    ".bzr",
    ".ds_store",
    ".aws",
    ".ssh",
    ".docker",
    ".npmrc",
    ".htaccess",
    ".htpasswd",
    "docker-compose",
    "compose.yaml",
    "compose.yml",
    "id_rsa",
    "id_ed25519",
    "credentials",
)


def _is_sensitive_spa_path(normalized: str) -> bool:
    lowered = normalized.lower().lstrip("/")
    if not lowered:
        return False
    if lowered.startswith(".") or "/." in lowered:
        return True
    return any(lowered == prefix or lowered.startswith(f"{prefix}/") or lowered.startswith(f"{prefix}.") for prefix in _SENSITIVE_SPA_PREFIXES)


def _resolve_dist_root_file(normalized: str) -> Path | None:
    """Serve Vite public/root artifacts (pomich-sw.js, favicon, etc.) before SPA fallback."""
    if not normalized or normalized.startswith("."):
        return None
    # Allow flat root files and one-level paths like cities/uzhhorod.html if present.
    if "/" in normalized and normalized.count("/") > 1:
        return None
    for base in (DIST_DIR, PROJECT_ROOT / "public"):
        candidate = (base / normalized).resolve()
        try:
            candidate.relative_to(base.resolve())
        except ValueError:
            continue
        if candidate.is_file():
            return candidate
    return None


_SEO_PUBLIC_PAGES: dict[str, dict[str, str]] = {
    "evakuator": {
        "title": "Евакуатор в Ужгороді та Україні — виклик через POMICH",
        "h1": "Евакуатор поруч",
        "lead": "Викликайте евакуатор через POMICH: підтвердіть місце — і ми знайдемо партнера поруч.",
    },
    "akumulyator": {
        "title": "Не заводиться авто / запуск АКБ — POMICH",
        "h1": "Не заводиться?",
        "lead": "Швидкий виклик допомоги з акумулятором поруч із вами.",
    },
    "zamina-kolesa": {
        "title": "Пробило колесо — допомога на дорозі POMICH",
        "h1": "Пробило колесо",
        "lead": "Заміна або ремонт колеса на місці через перевірених партнерів POMICH.",
    },
    "dostavka-palnogo": {
        "title": "Закінчилось пальне — доставка через POMICH",
        "h1": "Закінчилось пальне",
        "lead": "Доставка пального до вас без пошуку номерів і торгу по телефону.",
    },
    "partner": {
        "title": "Стати партнером POMICH — заявки поруч",
        "h1": "Стати партнером",
        "lead": "Приймайте реальні заявки поруч у Telegram. Безкоштовний вхід для пілоту в Ужгороді.",
    },
    "about": {
        "title": "Про POMICH — допомога автомобілістам на дорозі",
        "h1": "Про POMICH",
        "lead": "POMICH — платформа швидкої допомоги на дорозі: від проблеми до перевіреного виконавця поруч.",
    },
    "safety": {
        "title": "Безпека в POMICH",
        "h1": "Безпека",
        "lead": "POMICH не замінює екстрені служби 112. При ДТП з постраждалими спочатку викличте 112.",
    },
    "privacy": {
        "title": "Політика конфіденційності POMICH",
        "h1": "Політика конфіденційності",
        "lead": "POMICH обробляє дані профілю, геолокацію заявки та технічні логи лише для надання допомоги на дорозі, безпеки сервісу та зв’язку з вами.",
        "body_html": """
    <h2>Хто ми</h2>
    <p>POMICH — сервіс допомоги на дорозі (евакуатор, АКБ, колесо, пальне) через вебзастосунок і Telegram-ботів на домені <a href="https://pomich.help/">pomich.help</a>.</p>
    <h2>Які дані збираємо</h2>
    <ul>
      <li>Ім’я, телефон і місто профілю клієнта або партнера</li>
      <li>Геолокація місця поломки / подачі заявки (за вашою згодою в браузері або Telegram)</li>
      <li>Дані заявки: тип послуги, статус, історія повідомлень у межах сервісу</li>
      <li>Технічні логи (IP, пристрій, помилки) для безпеки та стабільності</li>
      <li>Telegram ID / chat ID, якщо ви відкриваєте Mini App через бота</li>
    </ul>
    <h2>Навіщо</h2>
    <p>Щоб знайти партнера поруч, виконати заявку, підтвердити особу (OTP), запобігти шахрайству та покращити сервіс.</p>
    <h2>З ким ділимось</h2>
    <p>Дані заявки передаємо лише залученому партнеру та інфраструктурі хостингу / Telegram API в обсязі, потрібному для доставки повідомлень. Не продаємо персональні дані.</p>
    <h2>Зберігання</h2>
    <p>Профіль і історія заявок зберігаються, поки існує обліковий запис або поки дані потрібні для законних цілей (безпека, спірні ситуації). Технічні логи — обмежений строк.</p>
    <h2>Ваші права</h2>
    <p>Можете запросити доступ, виправлення або видалення даних через підтримку в Telegram <a href="https://t.me/pomich_ua_bot">@pomich_ua_bot</a>.</p>
    <h2>Контакт</h2>
    <p class="meta">Оновлено: 21 вересня 2026 · POMICH · Україна</p>
""",
    },
    "cities/uzhhorod": {
        "title": "Допомога на дорозі в Ужгороді — POMICH",
        "h1": "Допомога в Ужгороді",
        "lead": "Пілот POMICH: евакуатор, АКБ, колесо, пальне — виклик за хвилини.",
    },
}


def _seo_landing_html(slug: str, page: dict[str, str]) -> str:
    title = page["title"]
    h1 = page["h1"]
    lead = page["lead"]
    canonical = f"https://pomich.help/{slug}"
    extra = page.get("body_html", "")
    return f"""<!doctype html>
<html lang="uk">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title}</title>
  <meta name="description" content="{lead}" />
  <link rel="canonical" href="{canonical}" />
  <meta property="og:title" content="{title}" />
  <meta property="og:description" content="{lead}" />
  <meta property="og:url" content="{canonical}" />
  <meta property="og:type" content="website" />
  <meta property="og:image" content="https://pomich.help/og-cover.jpg" />
  <meta property="og:locale" content="uk_UA" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="robots" content="index,follow" />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="icon" href="/favicon.ico" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@700;800&family=Sora:wght@600;700&display=swap" rel="stylesheet" />
  <style>
    body{{margin:0;font-family:Sora,system-ui,sans-serif;background:#0B1220;color:#F1F5F9;line-height:1.55}}
    main{{max-width:40rem;margin:0 auto;padding:2rem 1.25rem 4rem}}
    h1{{font-family:Outfit,Sora,sans-serif;font-size:clamp(1.75rem,4vw,2.25rem);letter-spacing:-.03em;margin:0 0 .75rem}}
    h2{{font-size:1.05rem;margin:1.5rem 0 .5rem;letter-spacing:-.02em}}
    a{{color:#4ade80}}
    .cta{{display:inline-block;margin-top:1.25rem;padding:.75rem 1.1rem;border-radius:12px;background:linear-gradient(135deg,#16A36A,#0B7A4D);color:#fff;font-weight:800;text-decoration:none}}
    ul{{padding-left:1.1rem}}
    .meta{{color:#94A3B8;font-size:.9rem}}
  </style>
</head>
<body>
  <main>
    <p><a href="/">POMICH</a></p>
    <h1>{h1}</h1>
    <p>{lead}</p>
    {extra}
    <p><a class="cta" href="/?utm_source=seo&amp;utm_campaign={slug}">Відкрити застосунок</a></p>
    <p class="meta">Telegram: <a href="https://t.me/pomich_ua_bot">@pomich_ua_bot</a></p>
    <h2>Послуги</h2>
    <ul>
      <li><a href="/evakuator">Евакуатор</a></li>
      <li><a href="/akumulyator">Не заводиться</a></li>
      <li><a href="/zamina-kolesa">Пробило колесо</a></li>
      <li><a href="/dostavka-palnogo">Закінчилось пальне</a></li>
      <li><a href="/cities/uzhhorod">Ужгород</a></li>
      <li><a href="/partner">Партнерам</a></li>
      <li><a href="/privacy">Конфіденційність</a></li>
      <li><a href="/safety">Безпека</a></li>
    </ul>
  </main>
</body>
</html>
"""


def _media_type_for_root_file(path: Path) -> str | None:
    suffix = path.suffix.lower()
    return {
        ".txt": "text/plain; charset=utf-8",
        ".xml": "application/xml",
        ".webmanifest": "application/manifest+json",
        ".json": "application/json",
        ".ico": "image/x-icon",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".svg": "image/svg+xml",
    }.get(suffix)


@app.get("/robots.txt")
def robots_txt():
    for candidate in (DIST_DIR / "robots.txt", PROJECT_ROOT / "public" / "robots.txt"):
        if candidate.is_file():
            return FileResponse(candidate, media_type="text/plain; charset=utf-8")
    raise HTTPException(status_code=404, detail="robots.txt not found")


@app.get("/sitemap.xml")
def sitemap_xml():
    for candidate in (DIST_DIR / "sitemap.xml", PROJECT_ROOT / "public" / "sitemap.xml"):
        if candidate.is_file():
            return FileResponse(candidate, media_type="application/xml")
    raise HTTPException(status_code=404, detail="sitemap.xml not found")


@app.get("/")
@app.get("/{full_path:path}")
def serve_frontend(full_path: str = ""):
    normalized = str(full_path or "").lstrip("/")
    if _is_sensitive_spa_path(normalized):
        raise HTTPException(status_code=404, detail="Not found")
    if normalized.startswith("geo/"):
        geo_name = normalized.removeprefix("geo/")
        geo_path = _resolve_geo_file(geo_name)
        if geo_path is not None:
            return FileResponse(
                geo_path,
                media_type="application/geo+json",
                headers={"Cache-Control": _GEO_CACHE_CONTROL},
            )
        raise HTTPException(status_code=404, detail="GeoJSON file not found")
    if normalized.startswith("assets/"):
        raise HTTPException(status_code=404, detail="Asset not found")
    if normalized.startswith("maps/"):
        maps_name = normalized.removeprefix("maps/")
        maps_path = _resolve_maps_file(maps_name)
        if maps_path is not None:
            media = "image/webp" if maps_path.suffix.lower() == ".webp" else None
            return FileResponse(
                maps_path,
                media_type=media,
                headers={"Cache-Control": _MAPS_CACHE_CONTROL},
            )
        raise HTTPException(status_code=404, detail="Map asset not found")

    seo_page = _SEO_PUBLIC_PAGES.get(normalized.rstrip("/"))
    if seo_page is not None:
        return HTMLResponse(
            _seo_landing_html(normalized.rstrip("/"), seo_page),
            headers={"Cache-Control": "public, max-age=300"},
        )

    root_file = _resolve_dist_root_file(normalized)
    if root_file is not None:
        headers = {"Cache-Control": "no-cache"} if root_file.name == "pomich-sw.js" else {"Cache-Control": "public, max-age=86400"}
        media = _media_type_for_root_file(root_file)
        return FileResponse(root_file, media_type=media, headers=headers)

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
