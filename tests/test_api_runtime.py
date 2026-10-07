import hashlib
from fastapi.testclient import TestClient
from bot import fastapi_app

from .support.api import _admin_session_headers, app, ADMIN_TOKEN


def test_fastapi_serves_health_and_api_prefix(monkeypatch) -> None:
    monkeypatch.setenv("POMICH_RUNTIME", "dev")
    monkeypatch.setenv("POMICH_ADMIN_TOKEN", ADMIN_TOKEN)
    client = TestClient(app)
    admin_headers = _admin_session_headers(client)

    health = client.get("/api/health")
    orders = client.get("/api/orders", headers=admin_headers)
    providers = client.get("/api/providers", headers=admin_headers)

    assert health.status_code == 200
    assert health.json() == {"status": "ok"}
    assert "telegramQueue" not in health.json()
    assert "protocol" not in health.json()
    # Dual registration removed — bare /health must not exist.
    assert client.get("/health").status_code == 404
    assert orders.status_code == 200
    assert isinstance(orders.json(), list)
    assert providers.status_code == 200
    assert isinstance(providers.json(), list)


def test_production_runtime_config_rejects_insecure_defaults(monkeypatch) -> None:
    monkeypatch.setenv("POMICH_RUNTIME", "production")
    monkeypatch.setenv("POMICH_CORS_ORIGINS", "*")
    monkeypatch.setenv("POMICH_ADMIN_TOKEN", "replace-me-admin-token")
    monkeypatch.delenv("POMICH_PROVIDER_TOKEN", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("POMICH_ENCRYPTION_KEY", raising=False)

    errors = fastapi_app._runtime_config_errors()

    assert any("POMICH_CORS_ORIGINS" in error for error in errors)
    assert any("POMICH_ADMIN_TOKEN" in error for error in errors)
    assert any("POMICH_PROVIDER_TOKEN" in error for error in errors)
    assert any("POMICH_CUSTOMER_SESSION_SECRET" in error for error in errors)
    assert any("POMICH_ENCRYPTION_KEY" in error for error in errors)
    assert any("DATABASE_URL" in error for error in errors)


def test_production_runtime_config_rejects_hardcoded_deploy_defaults(monkeypatch) -> None:
    monkeypatch.setenv("POMICH_RUNTIME", "production")
    monkeypatch.setenv("POMICH_CORS_ORIGINS", "https://pomich.help")
    monkeypatch.setenv("POMICH_ADMIN_TOKEN", "pomich-admin-secret-2026")
    monkeypatch.setenv("POMICH_PROVIDER_TOKEN", "pomich-provider-secret-2026")
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", "pomich-session-secret-2026-long-random")
    monkeypatch.setenv("POMICH_ENCRYPTION_KEY", "replace-with-generated-fernet-key")
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@localhost:5432/pomich_prod")
    monkeypatch.setenv("POMICH_STORAGE_BACKEND", "sql")

    errors = fastapi_app._runtime_config_errors()

    assert any("POMICH_ADMIN_TOKEN" in error for error in errors)
    assert any("POMICH_PROVIDER_TOKEN" in error for error in errors)
    assert any("POMICH_CUSTOMER_SESSION_SECRET" in error for error in errors)
    assert any("POMICH_ENCRYPTION_KEY" in error for error in errors)


def test_production_runtime_config_accepts_release_settings(monkeypatch) -> None:
    monkeypatch.setenv("POMICH_RUNTIME", "production")
    monkeypatch.setenv("POMICH_CORS_ORIGINS", "https://app.pomich.example,https://admin.pomich.example")
    monkeypatch.setenv("POMICH_ADMIN_TOKEN", "admin-secret-1234567890-release")
    monkeypatch.setenv("POMICH_PROVIDER_TOKEN", "provider-secret-1234567890-release")
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", "customer-secret-1234567890-release")
    monkeypatch.setenv("POMICH_ENCRYPTION_KEY", "0" * 44)
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@localhost:5432/pomich_prod")
    monkeypatch.setenv("POMICH_STORAGE_BACKEND", "sql")
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("VITE_TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.setenv("WEB_APP_URL", "https://app.pomich.example")

    assert fastapi_app._runtime_config_errors() == []


def test_production_runtime_config_rejects_sqlite_and_json_backend(monkeypatch) -> None:
    monkeypatch.setenv("POMICH_RUNTIME", "production")
    monkeypatch.setenv("POMICH_CORS_ORIGINS", "https://app.pomich.example")
    monkeypatch.setenv("POMICH_ADMIN_TOKEN", "admin-secret-1234567890-release")
    monkeypatch.setenv("POMICH_PROVIDER_TOKEN", "provider-secret-1234567890-release")
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", "customer-secret-1234567890-release")
    monkeypatch.setenv("POMICH_ENCRYPTION_KEY", "0" * 44)
    monkeypatch.setenv("DATABASE_URL", "sqlite:///release.db")
    monkeypatch.setenv("POMICH_STORAGE_BACKEND", "json")
    monkeypatch.delenv("POMICH_ALLOW_JSON_STORE_IN_PRODUCTION", raising=False)

    errors = fastapi_app._runtime_config_errors()

    assert any("PostgreSQL" in error or "PostGIS" in error for error in errors)
    assert any("POMICH_STORAGE_BACKEND=json" in error for error in errors)


def test_production_runtime_config_requires_telegram_public_url(monkeypatch) -> None:
    monkeypatch.setenv("POMICH_RUNTIME", "production")
    monkeypatch.setenv("POMICH_CORS_ORIGINS", "https://app.pomich.example")
    monkeypatch.setenv("POMICH_ADMIN_TOKEN", "admin-secret-1234567890-release")
    monkeypatch.setenv("POMICH_PROVIDER_TOKEN", "provider-secret-1234567890-release")
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", "customer-secret-1234567890-release")
    monkeypatch.setenv("POMICH_ENCRYPTION_KEY", "0" * 44)
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pass@localhost:5432/pomich_prod")
    monkeypatch.setenv("POMICH_STORAGE_BACKEND", "sql")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123456:telegram-token")
    monkeypatch.delenv("WEB_APP_URL", raising=False)

    errors = fastapi_app._runtime_config_errors()

    assert any("WEB_APP_URL" in error for error in errors)


def test_geo_static_files_served_before_spa_fallback(tmp_path, monkeypatch, temp_store):
    geo_dir = tmp_path / "dist" / "geo"
    geo_dir.mkdir(parents=True)
    border = geo_dir / "ukraine-border.geojson"
    border.write_text('{"type":"Feature","geometry":{"type":"Polygon","coordinates":[[[30,50],[31,50],[31,51],[30,51],[30,50]]]}}', encoding="utf-8")

    from importlib import reload

    reload(fastapi_app)
    # Patch after reload so request-time geo fallback can use the temp tree when needed.
    monkeypatch.setattr(fastapi_app, "DIST_DIR", tmp_path / "dist")
    monkeypatch.setattr(fastapi_app, "ASSETS_DIR", tmp_path / "dist" / "assets")
    monkeypatch.setattr(fastapi_app, "GEO_DIR", geo_dir)

    client = TestClient(fastapi_app.app)

    response = client.get("/geo/ukraine-border.geojson")
    assert response.status_code == 200
    assert response.json()["type"] == "Feature"


def test_maps_static_files_served_before_spa_fallback(tmp_path, monkeypatch, temp_store):
    maps_dir = tmp_path / "dist" / "maps"
    maps_dir.mkdir(parents=True)
    basemap = maps_dir / "ukraine-basemap.jpg"
    basemap.write_bytes(b"\xff\xd8\xff\xd9")  # minimal JPEG SOI/EOI

    from importlib import reload

    reload(fastapi_app)
    monkeypatch.setattr(fastapi_app, "DIST_DIR", tmp_path / "dist")
    monkeypatch.setattr(fastapi_app, "ASSETS_DIR", tmp_path / "dist" / "assets")
    monkeypatch.setattr(fastapi_app, "GEO_DIR", tmp_path / "dist" / "geo")
    monkeypatch.setattr(fastapi_app, "MAPS_DIR", maps_dir)
    monkeypatch.setattr(fastapi_app, "_DIST_MAPS_DIR", maps_dir)
    monkeypatch.setattr(fastapi_app, "_PUBLIC_MAPS_DIR", maps_dir)

    client = TestClient(fastapi_app.app)
    response = client.get("/maps/ukraine-basemap.jpg")
    assert response.status_code == 200
    assert "text/html" not in (response.headers.get("content-type") or "")
    assert response.content.startswith(b"\xff\xd8")


def test_robots_sitemap_and_seo_landings_are_indexable(monkeypatch, tmp_path, temp_store):
    public_dir = tmp_path / "public"
    public_dir.mkdir()
    (public_dir / "robots.txt").write_text("User-agent: *\nAllow: /\nSitemap: https://pomich.help/sitemap.xml\n", encoding="utf-8")
    (public_dir / "sitemap.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>',
        encoding="utf-8",
    )
    monkeypatch.setattr(fastapi_app, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(fastapi_app, "DIST_DIR", tmp_path / "dist")

    client = TestClient(fastapi_app.app)
    robots = client.get("/robots.txt")
    assert robots.status_code == 200
    assert "text/plain" in (robots.headers.get("content-type") or "")
    assert "Sitemap:" in robots.text

    sitemap = client.get("/sitemap.xml")
    assert sitemap.status_code == 200
    assert "xml" in (sitemap.headers.get("content-type") or "")

    landing = client.get("/evakuator")
    assert landing.status_code == 200
    assert "Евакуатор" in landing.text
    assert 'rel="canonical"' in landing.text
    assert "text/html" in (landing.headers.get("content-type") or "")


def test_unknown_paths_return_real_html_404(monkeypatch, tmp_path, temp_store):
    dist_dir = tmp_path / "dist"
    dist_dir.mkdir(parents=True)
    (dist_dir / "index.html").write_text("<!doctype html><html><body>POMICH</body></html>", encoding="utf-8")
    from importlib import reload
    reload(fastapi_app)
    monkeypatch.setattr(fastapi_app, "DIST_DIR", dist_dir)
    monkeypatch.setattr(fastapi_app, "ASSETS_DIR", dist_dir / "assets")
    monkeypatch.setattr(fastapi_app, "GEO_DIR", dist_dir / "geo")
    client = TestClient(fastapi_app.app)
    response = client.get("/definitely-not-real-page")
    assert response.status_code == 404
    assert "Сторінку не знайдено" in response.text
    assert "text/html" in (response.headers.get("content-type") or "")
    # Security headers present on HTML responses
    assert response.headers.get("x-content-type-options") == "nosniff"
    assert "max-age=" in (response.headers.get("strict-transport-security") or "")
    assert "Content-Security-Policy" in {k.title() for k in response.headers.keys()} or response.headers.get("content-security-policy")


def test_internal_ready_and_metrics(monkeypatch):
    monkeypatch.setenv("POMICH_INTERNAL_TOKEN", "internal-secret-token-xxxx")
    client = TestClient(app)
    ready = client.get("/internal/ready")
    assert ready.status_code in (200, 503)
    assert "postgres" in ready.json()
    denied = client.get("/internal/metrics")
    assert denied.status_code == 404
    ok = client.get("/internal/metrics", headers={"X-POMICH-Internal-Token": "internal-secret-token-xxxx"})
    assert ok.status_code == 200
    assert ok.json()["status"] == "ok"


def test_argon2id_password_hash_roundtrip():
    from bot.api_deps import hash_password, password_matches

    hashed = hash_password("correct-horse-battery")
    assert hashed.startswith("$argon2id$") or hashed.startswith("sha256:")
    assert password_matches({"passwordHash": hashed}, "correct-horse-battery")
    assert not password_matches({"passwordHash": hashed}, "wrong-password")
    # Legacy sha256 still works
    import hashlib
    legacy = "sha256:" + hashlib.sha256(b"legacy-pass").hexdigest()
    assert password_matches({"passwordHash": legacy}, "legacy-pass")


def test_public_health_hides_internals(monkeypatch):
    monkeypatch.setenv("POMICH_HEALTH_DETAIL_TOKEN", "detail-secret-token-xxxx")
    client = TestClient(app)
    public = client.get("/api/health")
    assert public.status_code == 200
    assert public.json() == {"status": "ok"}
    denied = client.get("/api/health/detail")
    assert denied.status_code == 404
    ok = client.get("/api/health/detail", headers={"X-POMICH-Health-Token": "detail-secret-token-xxxx"})
    assert ok.status_code == 200
    assert ok.json()["status"] == "ok"
    assert ok.json()["protocol"] == "fastapi"


def test_dist_root_static_files_served_before_spa_fallback(tmp_path, monkeypatch, temp_store):
    dist_dir = tmp_path / "dist"
    dist_dir.mkdir(parents=True)
    (dist_dir / "index.html").write_text("<!doctype html><html><body>POMICH</body></html>", encoding="utf-8")
    (dist_dir / "pomich-sw.js").write_text('const TILE_CACHE = "pomich-map-tiles-v2"\n', encoding="utf-8")

    from importlib import reload

    reload(fastapi_app)
    # Must patch after reload: import reassigns DIST_DIR to repo dist/, which is absent in CI.
    monkeypatch.setattr(fastapi_app, "DIST_DIR", dist_dir)
    monkeypatch.setattr(fastapi_app, "ASSETS_DIR", dist_dir / "assets")
    monkeypatch.setattr(fastapi_app, "GEO_DIR", dist_dir / "geo")

    client = TestClient(fastapi_app.app)

    sw = client.get("/pomich-sw.js")
    assert sw.status_code == 200
    assert "TILE_CACHE" in sw.text
    assert "text/html" not in (sw.headers.get("content-type") or "")

    index = client.get("/")
    assert index.status_code == 200
    assert "POMICH" in index.text
    assert "no-store" in (index.headers.get("cache-control") or "")
    assert "no-cache" in (index.headers.get("cache-control") or "")
