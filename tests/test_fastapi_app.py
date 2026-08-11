from datetime import datetime

from fastapi.testclient import TestClient

from bot import fastapi_app
from bot import order_store

app = fastapi_app.app


def _api_provider(provider_id: str, lat: float, lng: float) -> dict:
    now = datetime.utcnow().isoformat(timespec="seconds")
    return {
        "id": provider_id,
        "name": provider_id,
        "rating": 4.8,
        "vehicle": "Service van",
        "plate": "TEST",
        "phone": "+380000000000",
        "telegram": "pomich_help_bot",
        "status": "online",
        "etaMinutes": 10,
        "location": {"lat": lat, "lng": lng},
        "specialties": ["tow"],
        "serviceRadiusKm": 50,
        "verificationStatus": "verified",
        "verification": {
            "identityDocument": True,
            "driverLicense": True,
            "vehicleRegistration": True,
            "serviceProof": True,
            "selfieCheck": True,
            "backgroundCheck": "passed",
        },
        "registeredAt": now,
        "profileUpdatedAt": now,
        "lastSeenAt": now,
        "lastLocationAt": now,
        "updatedAt": now,
    }


def _use_temp_store(monkeypatch, tmp_path) -> tuple:
    order_path = tmp_path / "orders.json"
    provider_path = tmp_path / "providers.json"
    offer_path = tmp_path / "offers.json"
    customer_path = tmp_path / "customers.json"
    monkeypatch.setattr(order_store, "_default_store_path", lambda: order_path)
    monkeypatch.setattr(order_store, "_default_provider_store_path", lambda: provider_path)
    monkeypatch.setattr(order_store, "_default_offer_store_path", lambda: offer_path)
    monkeypatch.setattr(order_store, "_default_customer_store_path", lambda: customer_path)
    return order_path, provider_path, offer_path


def test_fastapi_serves_health_and_api_prefix(monkeypatch) -> None:
    monkeypatch.setenv("POMICH_RUNTIME", "dev")
    monkeypatch.setenv("POMICH_ADMIN_TOKEN", "test-admin")
    client = TestClient(app)

    health = client.get("/health")
    orders = client.get("/api/orders", headers={"X-POMICH-Admin-Token": "test-admin"})
    providers = client.get("/api/providers")

    assert health.status_code == 200
    assert health.json()["status"] == "ok"
    assert health.json()["runtime"] == "dev"
    assert orders.status_code == 200
    assert isinstance(orders.json(), list)
    assert providers.status_code == 200
    assert isinstance(providers.json(), list)


def test_production_runtime_config_rejects_insecure_defaults(monkeypatch) -> None:
    monkeypatch.setenv("POMICH_RUNTIME", "production")
    monkeypatch.setenv("POMICH_CORS_ORIGINS", "*")
    monkeypatch.setenv("POMICH_ADMIN_TOKEN", "replace-me-admin-token")
    monkeypatch.delenv("POMICH_PROVIDER_TOKEN", raising=False)

    errors = fastapi_app._runtime_config_errors()

    assert any("POMICH_CORS_ORIGINS" in error for error in errors)
    assert any("POMICH_ADMIN_TOKEN" in error for error in errors)
    assert any("POMICH_PROVIDER_TOKEN" in error for error in errors)


def test_production_runtime_config_accepts_release_settings(monkeypatch) -> None:
    monkeypatch.setenv("POMICH_RUNTIME", "production")
    monkeypatch.setenv("POMICH_CORS_ORIGINS", "https://app.pomich.example,https://admin.pomich.example")
    monkeypatch.setenv("POMICH_ADMIN_TOKEN", "admin-secret-1234567890-release")
    monkeypatch.setenv("POMICH_PROVIDER_TOKEN", "provider-secret-1234567890-release")
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("VITE_TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.setenv("WEB_APP_URL", "https://app.pomich.example")

    assert fastapi_app._runtime_config_errors() == []


def test_production_runtime_config_requires_telegram_public_url(monkeypatch) -> None:
    monkeypatch.setenv("POMICH_RUNTIME", "production")
    monkeypatch.setenv("POMICH_CORS_ORIGINS", "https://app.pomich.example")
    monkeypatch.setenv("POMICH_ADMIN_TOKEN", "admin-secret-1234567890-release")
    monkeypatch.setenv("POMICH_PROVIDER_TOKEN", "provider-secret-1234567890-release")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123456:telegram-token")
    monkeypatch.delenv("WEB_APP_URL", raising=False)

    errors = fastapi_app._runtime_config_errors()

    assert any("WEB_APP_URL" in error for error in errors)


def test_fastapi_updates_provider_presence(monkeypatch, tmp_path) -> None:
    _use_temp_store(monkeypatch, tmp_path)
    client = TestClient(app)
    client.patch(
        "/api/providers/provider-oleksandr/profile",
        json={
            "name": "Олександр",
            "phone": "+380671112233",
            "vehicle": "Volkswagen Transporter",
            "plate": "AO 1248 CH",
            "specialties": ["tow", "battery"],
            "serviceRadiusKm": 7,
        },
    )

    response = client.patch("/api/providers/provider-oleksandr/presence", json={"status": "online", "location": {"lat": 48.63, "lng": 22.27}})

    assert response.status_code == 200
    assert response.json()["status"] == "online"


def test_fastapi_registers_provider_profile(monkeypatch, tmp_path) -> None:
    _use_temp_store(monkeypatch, tmp_path)
    client = TestClient(app)

    response = client.patch(
        "/api/providers/provider-oleksandr/profile",
        json={
            "name": "Олександр",
            "phone": "+380671112233",
            "vehicle": "Volkswagen Transporter",
            "plate": "AO 1248 CH",
            "specialties": ["tow", "fuel"],
            "serviceRadiusKm": 9,
        },
    )

    assert response.status_code == 200
    assert response.json()["specialties"] == ["tow", "fuel"]
    assert response.json()["serviceRadiusKm"] == 9
    assert response.json()["verificationStatus"] == "verified"


def test_fastapi_customer_profile_and_verification_review(monkeypatch, tmp_path) -> None:
    _use_temp_store(monkeypatch, tmp_path)
    monkeypatch.setenv("POMICH_ADMIN_TOKEN", "test-admin")
    client = TestClient(app)

    profile = client.patch(
        "/api/customers/customer-42/profile",
        json={"name": "Марія", "phone": "+380501112233", "city": "Київ", "telegram": "maria_road"},
    )
    submitted = client.post(
        "/api/customers/customer-42/verification/submit",
        json={"phone": True, "telegram": True, "identityDocumentRef": "doc/customer-42/passport"},
    )
    reviewed = client.patch(
        "/api/customers/customer-42/verification/review",
        json={"status": "verified", "reviewNote": "Документи збігаються"},
        headers={"X-POMICH-Admin-Token": "test-admin"},
    )

    assert profile.status_code == 200
    assert profile.json()["name"] == "Марія"
    assert submitted.status_code == 200
    assert submitted.json()["verificationStatus"] == "pending"
    assert reviewed.status_code == 200
    assert reviewed.json()["verificationStatus"] == "verified"
    assert "Профіль підтверджено" in reviewed.json()["trustedBadges"]


def test_fastapi_provider_verification_submit_and_admin_review(monkeypatch, tmp_path) -> None:
    _use_temp_store(monkeypatch, tmp_path)
    monkeypatch.setenv("POMICH_ADMIN_TOKEN", "test-admin")
    monkeypatch.setenv("POMICH_PROVIDER_TOKEN", "partner-secret")
    client = TestClient(app)
    payload = {
        "name": "Новий партнер",
        "phone": "+380501112233",
        "vehicle": "Iveco Daily",
        "plate": "AA 1122 BB",
        "specialties": ["tow", "mechanic"],
        "serviceRadiusKm": 12,
    }

    profile = client.patch(
        "/api/providers/provider-new/profile",
        json=payload,
        headers={"X-POMICH-Provider-Token": "partner-secret"},
    )
    blocked_presence = client.patch(
        "/api/providers/provider-new/presence",
        json={"status": "online", "location": {"lat": 48.63, "lng": 22.27}},
        headers={"X-POMICH-Provider-Token": "partner-secret"},
    )
    submitted = client.post(
        "/api/providers/provider-new/verification/submit",
        json={
            "identityDocumentRef": "doc/provider-new/passport",
            "driverLicenseRef": "doc/provider-new/license",
            "vehicleRegistrationRef": "doc/provider-new/vehicle",
            "serviceProofRef": "doc/provider-new/tools",
            "selfieRef": "doc/provider-new/selfie",
        },
        headers={"X-POMICH-Provider-Token": "partner-secret"},
    )
    reviewed = client.patch(
        "/api/providers/provider-new/verification/review",
        json={"status": "verified", "reviewedBy": "dispatcher"},
        headers={"X-POMICH-Admin-Token": "test-admin"},
    )
    accepted_presence = client.patch(
        "/api/providers/provider-new/presence",
        json={"status": "online", "location": {"lat": 48.63, "lng": 22.27}},
        headers={"X-POMICH-Provider-Token": "partner-secret"},
    )

    assert profile.status_code == 200
    assert profile.json()["verificationStatus"] == "unverified"
    assert blocked_presence.status_code == 400
    assert blocked_presence.json()["detail"] == "provider verification must be approved before going online"
    assert submitted.status_code == 200
    assert submitted.json()["verificationStatus"] == "pending"
    assert reviewed.status_code == 200
    assert reviewed.json()["verificationStatus"] == "verified"
    assert accepted_presence.status_code == 200
    assert accepted_presence.json()["status"] == "online"


def test_fastapi_requires_provider_token_when_configured(monkeypatch, tmp_path) -> None:
    _use_temp_store(monkeypatch, tmp_path)
    monkeypatch.setenv("POMICH_PROVIDER_TOKEN", "partner-secret")
    client = TestClient(app)
    payload = {
        "name": "Олександр",
        "phone": "+380671112233",
        "vehicle": "Volkswagen Transporter",
        "plate": "AO 1248 CH",
        "specialties": ["tow", "fuel"],
        "serviceRadiusKm": 9,
    }

    rejected = client.patch("/api/providers/provider-oleksandr/profile", json=payload)
    accepted = client.patch(
        "/api/providers/provider-oleksandr/profile",
        json=payload,
        headers={"X-POMICH-Provider-Token": "partner-secret"},
    )

    assert rejected.status_code == 401
    assert rejected.json()["detail"] == "provider_token_invalid"
    assert accepted.status_code == 200
    assert accepted.json()["specialties"] == ["tow", "fuel"]


def test_fastapi_rejects_admin_orders_without_token(monkeypatch) -> None:
    monkeypatch.setenv("POMICH_ADMIN_TOKEN", "test-admin")
    client = TestClient(app)

    response = client.get("/api/orders")

    assert response.status_code == 401


def test_fastapi_rejects_invalid_order_transition(monkeypatch) -> None:
    monkeypatch.setenv("POMICH_ADMIN_TOKEN", "test-admin")
    client = TestClient(app)

    created = client.post("/api/orders", json={"service": "tow", "status": "searching"})
    response = client.patch(
        f"/api/orders/{created.json()['id']}/status",
        json={"status": "completed"},
        headers={"X-POMICH-Admin-Token": "test-admin"},
    )

    assert response.status_code == 409


def test_fastapi_dispatches_order_and_first_offer_acceptance_wins(monkeypatch, tmp_path) -> None:
    _use_temp_store(monkeypatch, tmp_path)
    order_store.save_providers(
        [
            _api_provider("p1", 48.6218, 22.2879),
            _api_provider("p2", 48.6228, 22.2879),
        ],
    )
    client = TestClient(app)

    created = client.post(
        "/api/orders",
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

    first_offer = client.get("/api/providers/p1/offers").json()[0]
    second_offer = client.get("/api/providers/p2/offers").json()[0]
    accepted = client.post(f"/api/providers/p1/offers/{first_offer['id']}/accept")
    lost = client.post(f"/api/providers/p2/offers/{second_offer['id']}/accept")

    assert accepted.status_code == 200
    assert accepted.json()["order"]["status"] == "assigned"
    assert accepted.json()["provider"]["status"] == "busy"
    assert lost.status_code == 409
    assert lost.json()["detail"]["code"] == "ORDER_ALREADY_ACCEPTED"

    order = client.get(f"/api/orders/{created_order['id']}").json()
    assert order["assignedProviderId"] == "p1"
    assert {offer["status"] for offer in order["offers"]} == {"accepted", "lost"}


def test_fastapi_assigned_provider_can_drive_lifecycle(monkeypatch, tmp_path) -> None:
    _use_temp_store(monkeypatch, tmp_path)
    order_store.save_providers([_api_provider("p1", 48.6218, 22.2879)])
    client = TestClient(app)

    created_order = client.post(
        "/api/orders",
        json={
            "service": "tow",
            "status": "searching",
            "customerCoordinates": {"lat": 48.6208, "lng": 22.2879},
        },
    ).json()
    offer = client.get("/api/providers/p1/offers").json()[0]
    client.post(f"/api/providers/p1/offers/{offer['id']}/accept")

    assert client.patch(f"/api/providers/p1/orders/{created_order['id']}/status", json={"status": "en_route"}).json()["status"] == "en_route"
    assert client.patch(f"/api/providers/p1/orders/{created_order['id']}/status", json={"status": "arrived"}).json()["status"] == "arrived"
    assert client.patch(f"/api/providers/p1/orders/{created_order['id']}/status", json={"status": "in_progress"}).json()["status"] == "in_progress"
    assert client.patch(f"/api/providers/p1/orders/{created_order['id']}/status", json={"status": "completed"}).json()["status"] == "completed"

    provider = client.get("/api/providers").json()[0]
    assert provider["status"] == "online"
    assert "assignedOrderId" not in provider
