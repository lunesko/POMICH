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
