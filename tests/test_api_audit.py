from fastapi.testclient import TestClient
from bot.fastapi_app import app


def test_telegram_cors_preflight():
    client = TestClient(app)
    response = client.options("/api/auth/customer/telegram/session", headers={
        "Origin": "http://localhost:5173",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type,x-telegram-init-data,x-pomich-telegram-bot",
    })
    assert response.status_code == 200
    allowed = response.headers["access-control-allow-headers"].lower()
    assert "x-telegram-init-data" in allowed
    assert "x-pomich-telegram-bot" in allowed


def test_pii_failure_returns_service_unavailable_without_modifying_store(monkeypatch, tmp_path, temp_store):
    from bot import order_store
    from bot.field_encryption import generate_encryption_key
    temp_store()
    monkeypatch.setenv("POMICH_ENCRYPTION_KEY", generate_encryption_key())
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", "test-session-secret-xxxxxxxx")
    client = TestClient(app)
    session = client.post("/api/auth/customer/guest/session", json={}).json()
    customer_id = session["customerId"]
    order_store.update_customer_profile(customer_id, {"phone": "+380991234876"})
    original = (tmp_path / "customers.json").read_bytes()
    monkeypatch.setenv("POMICH_ENCRYPTION_KEY", generate_encryption_key())
    response = client.get(f"/api/customers/{customer_id}/profile", headers={"Authorization": f"Bearer {session['accessToken']}"})
    assert response.status_code == 503
    assert response.json() == {"detail": "profile_storage_unavailable"}
    assert (tmp_path / "customers.json").read_bytes() == original


def test_application_limits_auth_requests_and_returns_retry_after(monkeypatch):
    from bot import rate_limits
    rate_limits._LOCAL.clear()
    monkeypatch.setenv("POMICH_RATE_LIMITS_ENABLED", "1")
    monkeypatch.setenv("POMICH_RATE_LIMIT_LOGIN_PER_MINUTE", "2")
    client = TestClient(app)
    for _ in range(2):
        assert client.post("/api/auth/customer/guest/session", json={}).status_code == 200
    limited = client.post("/api/auth/customer/guest/session", json={})
    assert limited.status_code == 429
    assert int(limited.headers["retry-after"]) > 0
    assert limited.json()["detail"]["code"] == "rate_limit_exceeded"
    assert "content-security-policy" in limited.headers
    assert client.get("/api/health").status_code == 200


def test_crash_reporting_accepts_only_anonymous_category():
    client = TestClient(app)
    assert client.post('/api/telemetry/crashes', json={'category': 'render_error'}).status_code == 204
    assert client.post('/api/telemetry/crashes', json={'category': 'render_error', 'message': 'private'}).status_code == 400
    assert client.post('/api/telemetry/crashes', json={'category': []}).status_code == 400
    assert client.post('/api/telemetry/crashes', content=b'x' * 129).status_code == 413
