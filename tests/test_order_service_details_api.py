from tests.helpers import verified_customer
from fastapi.testclient import TestClient

from bot import order_store
from bot.fastapi_app import app


def _isolated_store(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(order_store, "_default_store_path", lambda: tmp_path / "orders.json")
    monkeypatch.setattr(order_store, "_default_provider_store_path", lambda: tmp_path / "providers.json")
    monkeypatch.setattr(order_store, "_default_offer_store_path", lambda: tmp_path / "offers.json")
    monkeypatch.setattr(order_store, "_default_customer_store_path", lambda: tmp_path / "customers.json")


def _customer_headers(client: TestClient) -> dict[str, str]:
    response = client.post("/api/auth/customer/guest/session", json={})
    assert response.status_code == 200
    verified_customer(response.json()["customerId"])
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


def _tow_payload() -> dict:
    return {
        "source": "web",
        "service": "tow",
        "customerLocation": "Тестова точка подачі",
        "customerCoordinates": {"lat": 50.4501, "lng": 30.5234},
        "destination": "Тестова точка призначення",
        "destinationCoordinates": {"lat": 50.455, "lng": 30.535},
        "serviceDetails": {
            "version": 1,
            "service": "tow",
            "answers": {"incident": "breakdown", "mobility": "rolls"},
        },
    }


def test_web_order_service_detail_validation(monkeypatch, tmp_path) -> None:
    _isolated_store(monkeypatch, tmp_path)
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", "safe-test-session-secret-32-chars")
    client = TestClient(app)
    headers = _customer_headers(client)

    missing_details = _tow_payload()
    missing_details.pop("serviceDetails")
    response = client.post("/api/orders", headers=headers, json=missing_details)
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["serviceDetails"]

    mismatched = _tow_payload()
    mismatched["serviceDetails"]["service"] = "fuel"
    response = client.post("/api/orders", headers=headers, json=mismatched)
    assert response.status_code == 422
    assert response.json()["detail"] == "service_details_mismatch"

    outside_ukraine = _tow_payload()
    outside_ukraine["customerCoordinates"] = {"lat": 54.8, "lng": 9.5}
    response = client.post("/api/orders", headers=headers, json=outside_ukraine)
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"][0] == "customerCoordinates"

    missing_destination = _tow_payload()
    missing_destination.pop("destinationCoordinates")
    response = client.post("/api/orders", headers=headers, json=missing_destination)
    assert response.status_code == 422
    assert response.json()["detail"] == "destination_coordinates_required"

    same_destination = _tow_payload()
    same_destination["destinationCoordinates"] = same_destination["customerCoordinates"]
    response = client.post("/api/orders", headers=headers, json=same_destination)
    assert response.status_code == 422
    assert response.json()["detail"] == "destination_must_differ_from_pickup"

    response = client.post("/api/orders", headers=headers, json=_tow_payload())
    assert response.status_code == 201
    assert response.json()["serviceDetails"]["answers"]["mobility"] == "rolls"
