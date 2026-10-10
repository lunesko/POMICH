"""F01/F02: customer create must not overwrite foreign orders or forge lifecycle fields."""

from __future__ import annotations

from fastapi.testclient import TestClient

from bot.fastapi_app import app
from bot.order_store import get_order, save_order
from tests.helpers import use_temp_store


def _guest(client: TestClient) -> dict:
    response = client.post("/api/auth/customer/guest/session", json={})
    assert response.status_code == 200
    return response.json()


def _battery_payload(**extra) -> dict:
    payload = {
        "source": "web",
        "service": "battery",
        "customerLocation": "Тест",
        "customerCoordinates": {"lat": 48.6208, "lng": 22.2879},
        "serviceDetails": {
            "version": 1,
            "service": "battery",
            "answers": {"symptom": "silent", "help": "jump"},
        },
    }
    payload.update(extra)
    return payload


def test_create_order_ignores_foreign_id_and_does_not_overwrite_owner(monkeypatch, tmp_path) -> None:
    use_temp_store(monkeypatch, tmp_path)
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", "test-customer-secret-xxxxxxxx")
    client = TestClient(app)

    owner = _guest(client)
    victim = save_order(
        {
            "id": "PM-VICTIM-ORDER",
            "service": "battery",
            "status": "searching",
            "customerId": owner["customerId"],
            "customerCoordinates": {"lat": 48.6208, "lng": 22.2879},
            "serviceDetails": {
                "version": 1,
                "service": "battery",
                "answers": {"symptom": "silent", "help": "jump"},
            },
        }
    )
    assert victim["id"] == "PM-VICTIM-ORDER"
    assert victim["customerId"] == owner["customerId"]

    attacker = _guest(client)
    forged = client.post(
        "/api/orders",
        headers={"Authorization": f"Bearer {attacker['accessToken']}"},
        json=_battery_payload(
            id="PM-VICTIM-ORDER",
            status="completed",
            assignedProviderId="attacker-provider",
        ),
    )
    assert forged.status_code == 201
    created = forged.json()
    # Server must mint a new id and keep the victim row untouched (F01).
    assert created["id"] != "PM-VICTIM-ORDER"
    assert created["customerId"] == attacker["customerId"]
    assert created["status"] == "searching"
    assert created.get("assignedProviderId") in (None, "")

    original = get_order("PM-VICTIM-ORDER")
    assert original is not None
    assert original["customerId"] == owner["customerId"]
    assert original["status"] == "searching"


def test_create_order_rejects_forged_status_without_coordinates(monkeypatch, tmp_path) -> None:
    use_temp_store(monkeypatch, tmp_path)
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", "test-customer-secret-xxxxxxxx")
    client = TestClient(app)
    guest = _guest(client)

    response = client.post(
        "/api/orders",
        headers={"Authorization": f"Bearer {guest['accessToken']}"},
        json={
            "source": "web",
            "service": "battery",
            "status": "completed",
            "serviceDetails": {
                "version": 1,
                "service": "battery",
                "answers": {"symptom": "silent", "help": "jump"},
            },
        },
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "customer_coordinates_required"


def test_create_order_always_validates_even_when_client_omits_source(monkeypatch, tmp_path) -> None:
    use_temp_store(monkeypatch, tmp_path)
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", "test-customer-secret-xxxxxxxx")
    client = TestClient(app)
    guest = _guest(client)

    response = client.post(
        "/api/orders",
        headers={"Authorization": f"Bearer {guest['accessToken']}"},
        json={
            "service": "battery",
            "status": "searching",
            "customerCoordinates": {"lat": 48.6208, "lng": 22.2879},
        },
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "service_details_required"


def test_create_order_rejects_non_finite_coordinates(monkeypatch, tmp_path) -> None:
    use_temp_store(monkeypatch, tmp_path)
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", "test-customer-secret-xxxxxxxx")
    client = TestClient(app)
    guest = _guest(client)

    response = client.post(
        "/api/orders",
        headers={"Authorization": f"Bearer {guest['accessToken']}"},
        json=_battery_payload(customerCoordinates={"lat": "nan", "lng": 22.2879}),
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "customer_coordinates_invalid"
