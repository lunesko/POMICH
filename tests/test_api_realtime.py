from fastapi.testclient import TestClient
from bot import order_store

from .support.api import _use_provider_auth, _customer_session_headers, app, CUSTOMER_SESSION_SECRET


def test_customer_phone_login_send_allows_duplicate_registered_phone(monkeypatch, tmp_path, temp_store) -> None:
    """Login OTP must not 500 when guest + tg rows share the same phone."""
    temp_store()
    otp_path = tmp_path / "otp_codes.json"
    monkeypatch.setattr("bot.otp_verification._default_otp_store_path", lambda: otp_path)
    monkeypatch.setattr("bot.otp_verification._generate_otp_code", lambda: "778899")
    monkeypatch.setattr("bot.otp_verification._send_telegram_otp", lambda chat_id, code, **kwargs: 654)
    monkeypatch.setenv("POMICH_OTP_SECRET", "test-otp-secret")

    now = "2026-08-12T12:00:00Z"
    order_store.save_customer_profiles(
        [
            {
                "id": "tg-829741830",
                "name": "Vitaliy",
                "phone": "+380661007434",
                "createdAt": now,
                "updatedAt": now,
            },
            {
                "id": "guest-dup-vitaliy",
                "name": "Vitaliy Guest",
                "phone": "+380661007434",
                "createdAt": now,
                "updatedAt": now,
            },
        ]
    )

    client = TestClient(app)
    # Old bug: login send re-patched phone and hit phone_already_registered ? 500.
    send_response = client.post("/api/auth/customer/phone/login/send", json={"phone": "+380661007434"})
    assert send_response.status_code == 200
    assert send_response.json()["channel"] == "telegram"

    # Registration/profile update still rejects taking an already-registered phone.
    headers = _customer_session_headers(client, "guest-new-other")
    conflict = client.patch(
        "/api/customers/guest-new-other/profile",
        headers=headers,
        json={"name": "Other", "phone": "+380661007434", "city": "Uzhhorod"},
    )
    assert conflict.status_code == 409
    assert conflict.json()["detail"] == "phone_already_registered"


def test_verify_send_allows_own_provider_phone_with_tg_duplicate(monkeypatch, tmp_path, temp_store) -> None:
    """Partner OTP must not 409 when provider-{guest} already holds the phone."""
    temp_store()
    otp_path = tmp_path / "otp_codes.json"
    monkeypatch.setattr("bot.otp_verification._default_otp_store_path", lambda: otp_path)
    monkeypatch.setattr("bot.otp_verification._generate_otp_code", lambda: "778899")
    monkeypatch.setattr("bot.otp_verification._send_telegram_otp", lambda chat_id, code, **kwargs: 829741830)
    monkeypatch.setenv("POMICH_OTP_SECRET", "test-otp-secret")
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", CUSTOMER_SESSION_SECRET)
    customer_path = tmp_path / "customers.json"
    provider_path = tmp_path / "providers.json"
    order_store.update_customer_profile(
        "tg-829741830",
        {"name": "PowerGear", "phone": "+380635236801", "city": "Ужгород"},
        customer_path,
    )
    order_store.update_customer_profile(
        "guest-browser",
        {"name": "PowerGear", "city": "Ужгород"},
        customer_path,
    )
    order_store.update_provider_profile(
        "provider-guest-browser",
        {
            "name": "PowerGear",
            "phone": "+380635236801",
            "city": "Ужгород",
            "vehicle": "Volkswagen Crafter",
            "plate": "BX5874HX",
            "specialties": ["tow"],
            "serviceRadiusKm": 15,
            "registeredAt": "2026-08-12T12:00:00Z",
        },
        provider_path,
    )

    client = TestClient(app)
    headers = _customer_session_headers(client, "guest-browser")
    send_response = client.post(
        "/api/auth/customer/verify/send",
        headers=headers,
        json={"channel": "telegram", "phone": "+380635236801"},
    )
    assert send_response.status_code == 200
    assert send_response.json()["channel"] == "telegram"


def test_sse_order_events_not_found(monkeypatch, tmp_path, temp_store) -> None:
    temp_store()
    client = TestClient(app)
    response = client.get("/api/events/orders/missing-order")
    assert response.status_code == 404


def test_sse_provider_events_require_auth(monkeypatch, tmp_path, temp_store) -> None:
    temp_store()
    _use_provider_auth(monkeypatch)
    client = TestClient(app)
    denied = client.get("/api/events/providers/provider-oleksandr")
    assert denied.status_code == 401


def test_ws_order_events_handshake_and_broadcast(monkeypatch, tmp_path, temp_store) -> None:
    temp_store()
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", CUSTOMER_SESSION_SECRET)
    from bot import realtime

    realtime.reset_realtime_for_tests()
    client = TestClient(app)
    customer_headers = _customer_session_headers(client)
    created = client.post(
        "/api/orders",
        headers=customer_headers,
        json={
            "service": "tow",
            "status": "searching",
            "customerCoordinates": {"lat": 48.6208, "lng": 22.2879},
        },
    )
    order = created.json()
    token = customer_headers["Authorization"].removeprefix("Bearer ").strip()
    try:
        with client.websocket_connect(f"/api/ws/orders/{order['id']}?access_token={token}") as websocket:
            connected = websocket.receive_json()
            assert connected["type"] == "connected"
            assert connected["channel"] == realtime.channel_for_order(order["id"])

            realtime.publish_order_event({"id": order["id"], "status": "accepted"}, "order.accepted")
            message = websocket.receive_json()
            assert message["type"] == "order.accepted"
            assert message["payload"]["status"] == "accepted"
    finally:
        realtime.reset_realtime_for_tests()


def test_ws_order_events_not_found(monkeypatch, tmp_path, temp_store) -> None:
    temp_store()
    client = TestClient(app)
    try:
        with client.websocket_connect("/api/ws/orders/missing-order") as websocket:
            websocket.receive_json()
        assert False, "expected websocket handshake to fail"
    except Exception:
        pass


def test_ws_provider_events_require_auth(monkeypatch, tmp_path, temp_store) -> None:
    temp_store()
    _use_provider_auth(monkeypatch)
    client = TestClient(app)
    try:
        with client.websocket_connect("/api/ws/providers/provider-oleksandr") as websocket:
            websocket.receive_json()
        assert False, "expected websocket auth failure"
    except Exception:
        pass
