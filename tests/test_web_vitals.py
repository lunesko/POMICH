"""Public field metrics must never accept arbitrary labels, paths, or large bodies."""

import json

from fastapi.testclient import TestClient

from bot.fastapi_app import app
from bot.routers import telemetry


def test_web_vitals_accepts_anonymous_bounded_samples(monkeypatch) -> None:
    logged: list[str] = []
    monkeypatch.setattr(telemetry.logger, "info", logged.append)
    client = TestClient(app)
    response = client.post(
        "/api/telemetry/web-vitals",
        json={"page": "customer", "viewport": "mobile", "metrics": [{"name": "LCP", "value": 1870.5}, {"name": "CLS", "value": 0.04}]},
    )
    assert response.status_code == 204
    assert len(logged) == 2
    assert '"page":"customer"' in logged[0]
    assert '"name":"LCP"' in logged[0]


def test_web_vitals_rejects_untrusted_payloads(monkeypatch) -> None:
    logged: list[str] = []
    monkeypatch.setattr(telemetry.logger, "info", logged.append)
    client = TestClient(app)
    for payload in (
        {"page": "/orders/private", "viewport": "mobile", "metrics": [{"name": "LCP", "value": 100}]},
        {"page": "landing", "viewport": "mobile", "metrics": [{"name": "INP", "value": "nan"}]},
        {"page": "landing", "viewport": "mobile", "metrics": [{"name": "LCP", "value": 100}] * 4},
        {"page": "landing", "viewport": "mobile", "metrics": [{"name": "LCP", "value": 100, "url": "/private"}] * 2},
    ):
        assert client.post("/api/telemetry/web-vitals", json=payload).status_code == 400
    nonfinite = {"page": "landing", "viewport": "mobile", "metrics": [{"name": "CLS", "value": float("inf")}]}
    assert client.post("/api/telemetry/web-vitals", content=json.dumps(nonfinite)).status_code == 400
    assert client.post("/api/telemetry/web-vitals", content=b"a" * 513).status_code == 413
    assert not logged
