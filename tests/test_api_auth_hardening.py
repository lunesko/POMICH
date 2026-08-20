"""API auth hardening: order IDOR, nearby pins, webhooks."""

from __future__ import annotations

from fastapi.testclient import TestClient

from bot.fastapi_app import app
from bot.order_store import save_order
import tests.test_fastapi_app as fastapi_tests


def test_read_order_requires_participant(monkeypatch, tmp_path) -> None:
    fastapi_tests._use_temp_store(monkeypatch, tmp_path)
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", "test-customer-secret-xxxxxxxx")
    monkeypatch.setenv("POMICH_PROVIDER_TOKEN", "test-provider-secret-xxxxxxxx")
    client = TestClient(app)

    guest = client.post("/api/auth/customer/guest/session", json={}).json()
    order = save_order(
        {
            "service": "tow",
            "status": "searching",
            "customerId": guest["customerId"],
            "customerCoordinates": {"lat": 48.62, "lng": 22.28},
        }
    )

    assert client.get(f"/api/orders/{order['id']}").status_code == 401
    assert client.get("/api/orders/PM-DOES-NOT-EXIST").status_code == 401
    other = client.post("/api/auth/customer/guest/session", json={}).json()
    forbidden = client.get(
        f"/api/orders/{order['id']}",
        headers={"Authorization": f"Bearer {other['accessToken']}"},
    )
    assert forbidden.status_code == 403
    allowed = client.get(
        f"/api/orders/{order['id']}",
        headers={"Authorization": f"Bearer {guest['accessToken']}"},
    )
    assert allowed.status_code == 200
    assert allowed.json()["id"] == order["id"]


def test_create_order_requires_session(monkeypatch, tmp_path) -> None:
    fastapi_tests._use_temp_store(monkeypatch, tmp_path)
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", "test-customer-secret-xxxxxxxx")
    client = TestClient(app)
    bare = client.post(
        "/api/orders",
        json={"service": "tow", "customerCoordinates": {"lat": 48.62, "lng": 22.28}},
    )
    assert bare.status_code == 401
    guest = client.post("/api/auth/customer/guest/session", json={}).json()
    created = client.post(
        "/api/orders",
        headers={"Authorization": f"Bearer {guest['accessToken']}"},
        json={"service": "tow", "customerCoordinates": {"lat": 48.62, "lng": 22.28}},
    )
    assert created.status_code == 201


def test_nearby_orders_require_provider_session(monkeypatch, tmp_path) -> None:
    fastapi_tests._use_temp_store(monkeypatch, tmp_path)
    monkeypatch.setenv("POMICH_PROVIDER_TOKEN", "test-provider-secret-xxxxxxxx")
    client = TestClient(app)
    save_order(
        {
            "id": "PM-OPEN",
            "service": "tow",
            "status": "searching",
            "customerCoordinates": {"lat": 48.6208, "lng": 22.2879},
        }
    )
    assert (
        client.get("/api/map/orders/nearby", params={"lat": 48.6208, "lng": 22.2879, "radius_km": 20}).status_code
        == 401
    )
    session = client.post(
        "/api/auth/provider/session",
        headers={"X-POMICH-Provider-Token": "test-provider-secret-xxxxxxxx"},
        json={"providerId": "p1"},
    ).json()
    response = client.get(
        "/api/map/orders/nearby",
        params={"lat": 48.6208, "lng": 22.2879, "radius_km": 20},
        headers={"Authorization": f"Bearer {session['accessToken']}"},
    )
    assert response.status_code == 200
    assert {item["id"] for item in response.json()} == {"PM-OPEN"}


def test_telegram_webhook_requires_secret_in_production(monkeypatch) -> None:
    monkeypatch.setenv("POMICH_RUNTIME", "production")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123:ABC")
    monkeypatch.delenv("TELEGRAM_WEBHOOK_SECRET", raising=False)
    monkeypatch.delenv("TELEGRAM_CUSTOMER_WEBHOOK_SECRET", raising=False)
    monkeypatch.setattr(
        "bot.routers.telegram.handle_update",
        lambda payload, bot_kind="customer": {"handled": True, "chatId": "1", "botKind": bot_kind},
    )
    client = TestClient(app)
    response = client.post("/api/telegram/webhook", json={"update_id": 1, "message": {"chat": {"id": 1}, "text": "/start"}})
    assert response.status_code == 503

    monkeypatch.setenv("TELEGRAM_WEBHOOK_SECRET", "webhook-secret-value")
    denied = client.post("/api/telegram/webhook", json={"update_id": 1, "message": {"chat": {"id": 1}, "text": "/start"}})
    assert denied.status_code == 401
    ok = client.post(
        "/api/telegram/webhook",
        headers={"X-Telegram-Bot-Api-Secret-Token": "webhook-secret-value"},
        json={"update_id": 1, "message": {"chat": {"id": 1}, "text": "/start"}},
    )
    assert ok.status_code == 200
    assert ok.json()["ok"] is True
