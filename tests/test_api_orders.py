from fastapi.testclient import TestClient
from bot import order_store

from .support.api import _api_provider, _use_provider_auth, _provider_session_headers, _admin_session_headers, _customer_session_headers, app, ADMIN_TOKEN, CUSTOMER_SESSION_SECRET


def test_fastapi_create_order_persists_customer_comment(monkeypatch, tmp_path, temp_store) -> None:
    temp_store()
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", CUSTOMER_SESSION_SECRET)
    client = TestClient(app)
    customer_headers = _customer_session_headers(client)

    created = client.post(
        "/api/orders",
        headers=customer_headers,
        json={
            "service": "tow",
            "status": "searching",
            "customerComment": "Ключі в бардачку",
        },
    )

    assert created.status_code == 201
    payload = created.json()
    assert payload["customerComment"] == "Ключі в бардачку"


def test_fastapi_rejects_invalid_order_transition(monkeypatch) -> None:
    monkeypatch.setenv("POMICH_ADMIN_TOKEN", ADMIN_TOKEN)
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", CUSTOMER_SESSION_SECRET)
    client = TestClient(app)
    admin_headers = _admin_session_headers(client)
    customer_headers = _customer_session_headers(client)

    created = client.post("/api/orders", headers=customer_headers, json={"service": "tow", "status": "searching"})
    response = client.patch(
        f"/api/orders/{created.json()['id']}/status",
        json={"status": "completed"},
        headers=admin_headers,
    )

    assert response.status_code == 409


def test_fastapi_dispatches_order_and_first_offer_acceptance_wins(monkeypatch, tmp_path, temp_store) -> None:
    temp_store()
    _use_provider_auth(monkeypatch)
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", CUSTOMER_SESSION_SECRET)
    order_store.save_providers(
        [
            _api_provider("p1", 48.6218, 22.2879),
            _api_provider("p2", 48.6228, 22.2879),
        ],
    )
    client = TestClient(app)
    customer_headers = _customer_session_headers(client)
    first_provider_headers = _provider_session_headers(client, "p1")
    second_provider_headers = _provider_session_headers(client, "p2")

    created = client.post(
        "/api/orders",
        headers=customer_headers,
        json={
            "service": "tow",
            "status": "searching",
            "customerCoordinates": {"lat": 48.6208, "lng": 22.2879},
            "customerLocation": "Uzhhorod",
        },
    )

    assert created.status_code == 201
    created_order = created.json()
    assert created_order["dispatchState"] == "OFFERS_SENT"
    assert created_order["dispatchInfo"]["offersSent"] == 2

    first_offer = client.get("/api/providers/p1/offers", headers=first_provider_headers).json()[0]
    second_offer = client.get("/api/providers/p2/offers", headers=second_provider_headers).json()[0]
    accepted = client.post(
        f"/api/providers/p1/offers/{first_offer['id']}/accept",
        headers=first_provider_headers,
        json={"proposedPrice": 1200},
    )
    lost = client.post(
        f"/api/providers/p2/offers/{second_offer['id']}/accept",
        headers=second_provider_headers,
        json={"proposedPrice": 1300},
    )

    assert accepted.status_code == 200
    assert accepted.json()["order"]["status"] == "accepted"
    assert accepted.json()["order"]["partnerProposedPrice"] == 1200
    assert accepted.json()["provider"]["status"] == "busy"
    assert lost.status_code == 409
    assert lost.json()["detail"]["code"] == "ORDER_ALREADY_ACCEPTED"

    order = client.get(f"/api/orders/{created_order['id']}", headers=customer_headers).json()
    assert order["assignedProviderId"] == "p1"
    assert order["status"] == "accepted"
    assert order["partnerProposedPrice"] == 1200
    assert order["providerName"] == order["assignedProvider"]["name"]
    assert {offer["status"] for offer in order["offers"]} == {"accepted", "lost"}


def test_fastapi_cancel_order_notifies_partner(monkeypatch, tmp_path, temp_store) -> None:
    temp_store()
    _use_provider_auth(monkeypatch)
    monkeypatch.setenv("POMICH_ADMIN_TOKEN", ADMIN_TOKEN)
    order_store.save_providers([_api_provider("p1", 48.6218, 22.2879)])
    client = TestClient(app)
    provider_headers = _provider_session_headers(client, "p1")
    customer_id = "guest-customer-cancel"
    customer_headers = _customer_session_headers(client, customer_id)

    created_order = client.post(
        "/api/orders",
        headers=customer_headers,
        json={
            "service": "tow",
            "status": "searching",
            "customerCoordinates": {"lat": 48.6208, "lng": 22.2879},
        },
    ).json()
    assert created_order["customerId"] == customer_id
    sent_messages: list[dict[str, str]] = []

    def _fake_notify(order: dict) -> list[dict]:
        sent_messages.append({"id": str(order.get("id")), "status": str(order.get("status"))})
        return [{"ok": True}]

    monkeypatch.setattr("bot.routers.orders.notify_order_cancelled", _fake_notify)

    unauthenticated = client.post(f"/api/orders/{created_order['id']}/cancel")
    assert unauthenticated.status_code == 401

    other_headers = _customer_session_headers(client, "guest-customer-other")
    forbidden = client.post(f"/api/orders/{created_order['id']}/cancel", headers=other_headers)
    assert forbidden.status_code == 403

    cancelled = client.post(f"/api/orders/{created_order['id']}/cancel", headers=customer_headers)
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    assert sent_messages == [{"id": created_order["id"], "status": "cancelled"}]

    offers = client.get("/api/providers/p1/offers", headers=provider_headers).json()
    assert offers == []


def test_fastapi_provider_can_cancel_assigned_order(monkeypatch, tmp_path, temp_store) -> None:
    temp_store()
    _use_provider_auth(monkeypatch)
    order_store.save_providers([_api_provider("p1", 48.6218, 22.2879)])
    client = TestClient(app)
    provider_headers = _provider_session_headers(client, "p1")
    customer_headers = _customer_session_headers(client, "guest-customer-provider-cancel")

    created_order = client.post(
        "/api/orders",
        headers=customer_headers,
        json={
            "service": "tow",
            "status": "searching",
            "customerCoordinates": {"lat": 48.6208, "lng": 22.2879},
        },
    ).json()
    offer = client.get("/api/providers/p1/offers", headers=provider_headers).json()[0]
    client.post(
        f"/api/providers/p1/offers/{offer['id']}/accept",
        headers=provider_headers,
        json={"proposedPrice": 1500, "priceNote": "Евакуатор"},
    )

    sent_messages: list[dict[str, str]] = []

    def _fake_notify(order: dict) -> list[dict]:
        sent_messages.append({"id": str(order.get("id")), "status": str(order.get("status"))})
        return [{"ok": True}]

    monkeypatch.setattr("bot.routers.orders.notify_order_cancelled", _fake_notify)

    cancelled = client.patch(
        f"/api/providers/p1/orders/{created_order['id']}/status",
        headers=provider_headers,
        json={"status": "cancelled"},
    )
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    assert sent_messages == [{"id": created_order["id"], "status": "cancelled"}]

    provider = order_store.get_provider_profile("p1")
    assert provider is not None
    assert provider.get("status") == "online"


def test_fastapi_admin_can_cancel_order(monkeypatch, tmp_path, temp_store) -> None:
    temp_store()
    monkeypatch.setenv("POMICH_ADMIN_TOKEN", ADMIN_TOKEN)
    client = TestClient(app)
    customer_headers = _customer_session_headers(client, "guest-customer-42")
    admin_headers = _admin_session_headers(client)

    created_order = client.post(
        "/api/orders",
        headers=customer_headers,
        json={
            "service": "tow",
            "status": "searching",
            "customerCoordinates": {"lat": 48.6208, "lng": 22.2879},
        },
    ).json()

    cancelled = client.post(f"/api/orders/{created_order['id']}/cancel", headers=admin_headers)
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"


def test_fastapi_dispatch_retry_requires_customer_owner_or_admin(monkeypatch, tmp_path, temp_store) -> None:
    temp_store()
    monkeypatch.setenv("POMICH_ADMIN_TOKEN", ADMIN_TOKEN)
    order_store.save_providers([_api_provider("p1", 48.6218, 22.2879)])
    client = TestClient(app)
    customer_id = "guest-customer-retry"
    customer_headers = _customer_session_headers(client, customer_id)
    admin_headers = _admin_session_headers(client)

    created_order = client.post(
        "/api/orders",
        headers=customer_headers,
        json={
            "service": "tow",
            "status": "searching",
            "customerCoordinates": {"lat": 48.6208, "lng": 22.2879},
        },
    ).json()

    unauthenticated = client.post(f"/api/orders/{created_order['id']}/dispatch/retry")
    assert unauthenticated.status_code == 401
    assert unauthenticated.json()["detail"] == "auth_session_required"

    other_headers = _customer_session_headers(client, "guest-customer-other")
    forbidden = client.post(f"/api/orders/{created_order['id']}/dispatch/retry", headers=other_headers)
    assert forbidden.status_code == 403
    assert forbidden.json()["detail"] == "customer_identity_mismatch"

    retried = client.post(f"/api/orders/{created_order['id']}/dispatch/retry", headers=customer_headers)
    assert retried.status_code == 200
    assert retried.json()["id"] == created_order["id"]

    admin_retried = client.post(f"/api/orders/{created_order['id']}/dispatch/retry", headers=admin_headers)
    assert admin_retried.status_code == 200
    assert admin_retried.json()["id"] == created_order["id"]


def test_fastapi_confirm_price_requires_customer_owner(monkeypatch, tmp_path, temp_store) -> None:
    temp_store()
    _use_provider_auth(monkeypatch)
    order_store.save_providers([_api_provider("p1", 48.6218, 22.2879)])
    client = TestClient(app)
    provider_headers = _provider_session_headers(client, "p1")
    customer_id = "guest-customer-price"
    customer_headers = _customer_session_headers(client, customer_id)

    created_order = client.post(
        "/api/orders",
        headers=customer_headers,
        json={
            "service": "tow",
            "status": "searching",
            "customerCoordinates": {"lat": 48.6208, "lng": 22.2879},
        },
    ).json()
    offer = client.get("/api/providers/p1/offers", headers=provider_headers).json()[0]
    client.post(
        f"/api/providers/p1/offers/{offer['id']}/accept",
        headers=provider_headers,
        json={"proposedPrice": 1500, "priceNote": "Евакуатор"},
    )

    unauthenticated = client.post(f"/api/orders/{created_order['id']}/confirm-price")
    assert unauthenticated.status_code == 401
    assert unauthenticated.json()["detail"] == "customer_session_required"

    other_headers = _customer_session_headers(client, "guest-customer-other")
    forbidden = client.post(f"/api/orders/{created_order['id']}/confirm-price", headers=other_headers)
    assert forbidden.status_code == 403
    assert forbidden.json()["detail"] == "customer_identity_mismatch"

    confirmed = client.post(f"/api/orders/{created_order['id']}/confirm-price", headers=customer_headers)
    assert confirmed.status_code == 200
    assert confirmed.json()["status"] == "price_confirmed"


def test_dispatch_list_excludes_directory_and_map_is_slim(monkeypatch, tmp_path, temp_store) -> None:
    temp_store()
    monkeypatch.setenv("POMICH_ADMIN_TOKEN", ADMIN_TOKEN)
    dispatch = {**_api_provider("p-dispatch", 48.62, 22.28), "address": "Приватна база 7"}
    directory = {
        **_api_provider("p-dir", 48.63, 22.29),
        "providerKind": "directory",
        "contactStatus": "directory_only",
        "address": "вул. Тестова 1",
        "openingHours": "09:00-18:00",
        "city": "Ужгород",
        "source": "osm",
    }
    order_store.save_providers([dispatch, directory])
    client = TestClient(app)
    admin_headers = _admin_session_headers(client)

    listed = client.get("/api/providers", headers=admin_headers).json()
    assert {item["id"] for item in listed} == {"p-dispatch"}

    directory_only = client.get("/api/providers?kind=directory", headers=admin_headers).json()
    assert {item["id"] for item in directory_only} == {"p-dir"}

    mapped = client.get("/api/map/providers?scope=all").json()
    ids = {item["id"] for item in mapped}
    assert ids == {"p-dispatch", "p-dir"}
    for item in mapped:
        assert "verification" not in item
        assert "phone" not in item
        assert "telegram" not in item
        assert "vehicle" not in item
        assert item["name"]
        assert item["location"]["lat"]
        assert item["approximateLocation"]["lat"] == item["location"]["lat"]

    dispatch_only = client.get("/api/map/providers?kind=dispatch&scope=all").json()
    assert {item["id"] for item in dispatch_only} == {"p-dispatch"}
    assert "address" not in dispatch_only[0]

    online_verified = client.get(
        "/api/map/providers?kind=dispatch&status=online&verification_status=verified&scope=all"
    ).json()
    assert {item["id"] for item in online_verified} == {"p-dispatch"}

    directory_map = client.get("/api/map/providers?kind=directory&scope=all").json()
    assert {item["id"] for item in directory_map} == {"p-dir"}
    assert directory_map[0]["address"] == "вул. Тестова 1"

    offline_only = client.get("/api/map/providers?kind=dispatch&status=offline&scope=all").json()
    assert offline_only == []


def test_map_nearby_orders_excludes_completed_and_cancelled(monkeypatch, tmp_path, temp_store) -> None:
    temp_store()
    _use_provider_auth(monkeypatch)
    coords = {"lat": 48.6208, "lng": 22.2879}
    order_store.save_order(
        {"id": "PM-OPEN", "service": "tow", "status": "searching", "customerCoordinates": coords},
    )
    order_store.save_order(
        {"id": "PM-DONE", "service": "tow", "status": "completed", "customerCoordinates": coords},
    )
    order_store.save_order(
        {"id": "PM-CANCEL", "service": "tow", "status": "cancelled", "customerCoordinates": coords},
    )
    client = TestClient(app)
    provider_headers = _provider_session_headers(client, "p1")
    response = client.get(
        "/api/map/orders/nearby",
        params={"lat": 48.6208, "lng": 22.2879, "radius_km": 20},
        headers=provider_headers,
    )
    assert response.status_code == 200
    assert {item["id"] for item in response.json()} == {"PM-OPEN"}
