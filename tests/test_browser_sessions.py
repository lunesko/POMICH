from fastapi.testclient import TestClient

from bot.fastapi_app import app
from bot import browser_sessions


def test_customer_cookie_restores_only_its_role(monkeypatch) -> None:
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", "test-customer-secret-xxxxxxxx")
    client = TestClient(app)
    issued = client.post("/api/auth/customer/guest/session", json={})
    assert issued.status_code == 200
    cookie = issued.headers["set-cookie"]
    assert "pomich_customer_session=" in cookie
    assert "HttpOnly" in cookie and "SameSite=lax" in cookie
    assert "Path=/api/auth/browser/" in cookie

    restored = client.post("/api/auth/browser/restore", json={"role": "customer"})
    assert restored.status_code == 200
    assert restored.json()["customerId"] == issued.json()["customerId"]
    assert client.post("/api/auth/browser/restore", json={"role": "admin"}).status_code == 401

    assert client.post("/api/auth/browser/logout").status_code == 204
    assert client.post("/api/auth/browser/restore", json={"role": "customer"}).status_code == 401


def test_cross_origin_cannot_restore_or_logout(monkeypatch) -> None:
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", "test-customer-secret-xxxxxxxx")
    client = TestClient(app)
    assert client.post("/api/auth/customer/guest/session", json={}).status_code == 200
    headers = {"Origin": "https://attacker.invalid"}
    assert client.post("/api/auth/browser/restore", headers=headers, json={"role": "customer"}).status_code == 403
    assert client.post("/api/auth/browser/logout", headers=headers).status_code == 403
    assert client.post("/api/auth/browser/restore", json={"role": "customer"}).status_code == 200


def test_production_cookie_requires_https_and_allowlisted_origin(monkeypatch) -> None:
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", "test-customer-secret-xxxxxxxx")
    monkeypatch.setattr(browser_sessions, "is_production_runtime", lambda: True)
    monkeypatch.setattr(browser_sessions, "get_cors_origins", lambda: ["https://testserver"])
    client = TestClient(app)
    issued = client.post("/api/auth/customer/guest/session", json={})
    assert "Secure" in issued.headers["set-cookie"]
    assert client.post("/api/auth/browser/restore", json={"role": "customer"}).status_code == 403
    assert client.post("/api/auth/browser/restore", headers={"Origin": "https://testserver"}, json={"role": "customer"}).status_code == 401
    https_client = TestClient(app, base_url="https://testserver")
    https_client.cookies.update(client.cookies)
    restored = https_client.post("/api/auth/browser/restore", headers={"Origin": "https://testserver"}, json={"role": "customer"})
    assert restored.status_code == 200


def test_login_preferences_and_absolute_deadline(monkeypatch) -> None:
    from bot import api_deps
    from bot.routers import auth

    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", "test-customer-secret-xxxxxxxx")
    monkeypatch.setattr(auth, "find_registered_customer_by_phone", lambda phone: {"id": "tg-123"})
    monkeypatch.setattr(auth, "confirm_customer_verification_code", lambda customer, code: {"id": customer})
    monkeypatch.setattr(auth, "build_user_account_status", lambda customer: {})
    clock = [2_000_000_000]
    monkeypatch.setattr(browser_sessions.time, "time", lambda: clock[0])

    for remember, duration in [(False, 43200), (True, 2592000)]:
        client = TestClient(app)
        issued = client.post("/api/auth/customer/phone/login/confirm", json={
            "phone": "+380935718207", "code": "123456", "rememberMe": remember,
        })
        assert issued.status_code == 200
        data = issued.json()
        deadline = clock[0] + duration
        assert data["sessionExpiresAt"] == deadline
        assert data["rememberMe"] is remember
        assert data["expiresAt"] <= clock[0] + api_deps.session_ttl_seconds()
        cookie = issued.headers["set-cookie"]
        assert ("Max-Age=" in cookie) is remember
        if remember:
            assert "Max-Age=2592000" in cookie
        clock[0] += 3600
        restored = client.post("/api/auth/browser/restore", json={"role": "customer"})
        assert restored.status_code == 200
        assert restored.json()["sessionExpiresAt"] == deadline
        assert restored.json()["rememberMe"] is remember
        if remember:
            assert "Max-Age=2588400" in restored.headers["set-cookie"]
        clock[0] = deadline
        assert client.post("/api/auth/browser/restore", json={"role": "customer"}).status_code == 401


def test_partner_session_inherits_customer_deadline(monkeypatch) -> None:
    from bot.routers import auth
    from bot.api_deps import verify_role_session

    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", "test-customer-secret-xxxxxxxx")
    monkeypatch.setenv("POMICH_PROVIDER_TOKEN", "test-provider-secret-xxxxxxxx")
    monkeypatch.setattr(auth, "resolve_linked_provider_id", lambda customer: "partner-123")
    monkeypatch.setattr(auth, "get_customer_profile", lambda customer: {"linkedProviderId": "partner-123"})
    monkeypatch.setattr(auth, "ensure_linked_provider_profile", lambda customer: None)
    monkeypatch.setattr(auth, "sync_linked_provider_phone_verification_from_customer", lambda provider: None)
    customer = browser_sessions.issue_browser_login("customer", "tg-123", "test-customer-secret-xxxxxxxx", remember_me=True)
    response = TestClient(app).post("/api/auth/provider/self/session", json={"customerId": "tg-123"},
                                    headers={"Authorization": f"Bearer {customer['accessToken']}"})
    assert response.status_code == 200
    assert response.json()["sessionExpiresAt"] == customer["sessionExpiresAt"]
    assert response.json()["rememberMe"] is True
    assert "Max-Age=" in response.headers["set-cookie"]
    principal = verify_role_session(response.json()["accessToken"], "provider", "test-provider-secret-xxxxxxxx")
    assert principal.browser_expires_at == customer["sessionExpiresAt"]


def test_partner_password_login_uses_remember_choice(monkeypatch) -> None:
    from bot.routers import auth
    monkeypatch.setenv("POMICH_PROVIDER_TOKEN", "test-provider-secret-xxxxxxxx")
    monkeypatch.setattr(auth, "find_provider_account", lambda *args: {"providerId": "partner-123"})
    client = TestClient(app)
    remembered = client.post("/api/auth/provider/login", json={"login": "partner", "password": "test", "rememberMe": True})
    assert remembered.status_code == 200
    assert remembered.json()["rememberMe"] is True
    assert "Max-Age=2592000" in remembered.headers["set-cookie"]
    standard = client.post("/api/auth/provider/login", json={"login": "partner", "password": "test"})
    assert standard.status_code == 200
    assert standard.json()["rememberMe"] is False
    assert "Max-Age=" not in standard.headers["set-cookie"]
