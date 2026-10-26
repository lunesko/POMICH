import httpx
import pytest
from fastapi.testclient import TestClient
from bot import routing
from bot.fastapi_app import app

A = {"lat": 48.62, "lng": 22.28}
B = {"lat": 48.63, "lng": 22.29}


def test_matrix_ranks_by_road_eta_not_straight_distance(monkeypatch):
    monkeypatch.setattr(routing, "_request", lambda *args: {"durations": [[1200], [180]], "distances": [[10000], [3000]]})
    candidates = [{"id": "bridge", "location": A, "distanceKm": 1}, {"id": "accessible", "location": B, "distanceKm": 2}]
    ranked = routing.rank_candidates(candidates, A)
    assert [item["id"] for item in ranked] == ["accessible", "bridge"]
    assert ranked[0]["etaSource"] == "osrm" and ranked[0]["etaMinutes"] == 3
    assert ranked[0]["distanceKm"] == 2 and ranked[0]["roadDistanceKm"] == 3


def test_unreachable_candidate_is_excluded(monkeypatch):
    monkeypatch.setattr(routing, "_request", lambda *args: {"durations": [[None], [120]], "distances": [[None], [1000]]})
    ranked = routing.rank_candidates([{"id": str(i), "location": A, "distanceKm": i} for i in range(2)], B)
    assert [item["id"] for item in ranked] == ["1"]


def test_failure_is_explicit_approximation(monkeypatch):
    monkeypatch.setattr(routing, "_request", lambda *args: None)
    result = routing.estimate(A, B)
    assert result["etaSource"] == "approximate" and result["roadDistanceKm"] is None
    assert result["etaMinutes"] >= 1
    assert routing.route_geometry(A, B).source == "unavailable"


def test_request_cache_and_failure_backoff(monkeypatch):
    monkeypatch.setenv("POMICH_OSRM_URL", "https://routing.invalid")
    for key in ("ALL_PROXY", "all_proxy", "HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy"):
        monkeypatch.delenv(key, raising=False)
    routing._CACHE.clear()
    requests = []
    def send(*args, **kwargs):
        requests.append(args)
        return httpx.Response(200, json={"code": "Ok", "routes": [{"duration": 300, "distance": 2000}]}, request=httpx.Request("GET", "https://routing.invalid"))
    monkeypatch.setattr(httpx.Client, "get", send)
    assert routing.estimate(A, B)["etaMinutes"] == 5
    assert routing.estimate(A, B)["etaSource"] == "osrm"
    assert len(requests) == 1


def test_route_proxy_contract_and_coordinate_validation(monkeypatch):
    monkeypatch.setattr(routing, "_request", lambda *args: {"routes": [{"duration": 120, "distance": 1000,
        "geometry": {"coordinates": [[22.28, 48.62], [22.29, 48.63]]}}]})
    client = TestClient(app)
    result = client.post("/api/routing/route", json={"fromPoint": A, "toPoint": B})
    assert result.status_code == 200
    assert result.json()["coordinates"][0] == [48.62, 22.28]
    assert result.json()["source"] == "osrm"
    assert client.post("/api/routing/route", json={"fromPoint": {"lat": 91, "lng": 22}, "toPoint": B}).status_code == 422
