from fastapi.testclient import TestClient

from bot.fastapi_app import app


def test_nearest_settlement_outside_ukraine_returns_radius_fallback() -> None:
    response = TestClient(app).get(
        "/api/map/settlements/nearest",
        params={"lat": 54.8359, "lng": 9.5461, "max_km": 80},
    )

    assert response.status_code == 200
    assert response.json()["code"] == "no_nearby_settlement"
    assert response.json()["fallback"] == "radius"
