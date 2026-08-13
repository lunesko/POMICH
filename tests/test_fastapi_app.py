import hashlib
import hmac
import json
import time
from datetime import datetime, timezone
from urllib.parse import urlencode

from fastapi.testclient import TestClient

from bot import fastapi_app
from bot import order_store

app = fastapi_app.app
PROVIDER_TOKEN = "partner-secret"
PROVIDER_HEADERS = {"X-POMICH-Provider-Token": PROVIDER_TOKEN}
ADMIN_TOKEN = "test-admin"
ADMIN_HEADERS = {"X-POMICH-Admin-Token": ADMIN_TOKEN}
CUSTOMER_SESSION_SECRET = "customer-session-secret-for-tests"


def _api_provider(provider_id: str, lat: float, lng: float) -> dict:
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds")
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


def _use_provider_auth(monkeypatch) -> dict:
    monkeypatch.setenv("POMICH_PROVIDER_TOKEN", PROVIDER_TOKEN)
    return PROVIDER_HEADERS


def _provider_session_headers(client: TestClient, provider_id: str) -> dict:
    response = client.post("/api/auth/provider/session", headers=PROVIDER_HEADERS, json={"providerId": provider_id})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


def _admin_session_headers(client: TestClient) -> dict:
    response = client.post("/api/auth/admin/session", headers=ADMIN_HEADERS)
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


def _customer_session_headers(client: TestClient, customer_id: str = "guest-customer-42") -> dict:
    response = client.post("/api/auth/customer/guest/session", json={"customerId": customer_id})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


def _signed_init_data(payload: dict[str, str], token: str) -> str:
    data_check_string = "\n".join(f"{key}={value}" for key, value in sorted(payload.items()))
    secret_key = hmac.new(b"WebAppData", token.encode("utf-8"), hashlib.sha256).digest()
    signature = hmac.new(secret_key, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()
    return urlencode({**payload, "hash": signature})


def test_fastapi_serves_health_and_api_prefix(monkeypatch) -> None:
    monkeypatch.setenv("POMICH_RUNTIME", "dev")
    monkeypatch.setenv("POMICH_ADMIN_TOKEN", ADMIN_TOKEN)
    client = TestClient(app)
    admin_headers = _admin_session_headers(client)

    health = client.get("/health")
    orders = client.get("/api/orders", headers=admin_headers)
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
    monkeypatch.delenv("DATABASE_URL", raising=False)

    errors = fastapi_app._runtime_config_errors()

    assert any("POMICH_CORS_ORIGINS" in error for error in errors)
    assert any("POMICH_ADMIN_TOKEN" in error for error in errors)
    assert any("POMICH_PROVIDER_TOKEN" in error for error in errors)
    assert any("POMICH_CUSTOMER_SESSION_SECRET" in error for error in errors)
    assert any("DATABASE_URL" in error for error in errors)


def test_production_runtime_config_accepts_release_settings(monkeypatch) -> None:
    monkeypatch.setenv("POMICH_RUNTIME", "production")
    monkeypatch.setenv("POMICH_CORS_ORIGINS", "https://app.pomich.example,https://admin.pomich.example")
    monkeypatch.setenv("POMICH_ADMIN_TOKEN", "admin-secret-1234567890-release")
    monkeypatch.setenv("POMICH_PROVIDER_TOKEN", "provider-secret-1234567890-release")
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", "customer-secret-1234567890-release")
    monkeypatch.setenv("DATABASE_URL", "sqlite:///release.db")
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("VITE_TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.setenv("WEB_APP_URL", "https://app.pomich.example")

    assert fastapi_app._runtime_config_errors() == []


def test_production_runtime_config_requires_telegram_public_url(monkeypatch) -> None:
    monkeypatch.setenv("POMICH_RUNTIME", "production")
    monkeypatch.setenv("POMICH_CORS_ORIGINS", "https://app.pomich.example")
    monkeypatch.setenv("POMICH_ADMIN_TOKEN", "admin-secret-1234567890-release")
    monkeypatch.setenv("POMICH_PROVIDER_TOKEN", "provider-secret-1234567890-release")
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", "customer-secret-1234567890-release")
    monkeypatch.setenv("DATABASE_URL", "sqlite:///release.db")
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "123456:telegram-token")
    monkeypatch.delenv("WEB_APP_URL", raising=False)

    errors = fastapi_app._runtime_config_errors()

    assert any("WEB_APP_URL" in error for error in errors)


def test_fastapi_updates_provider_presence(monkeypatch, tmp_path) -> None:
    _use_temp_store(monkeypatch, tmp_path)
    _use_provider_auth(monkeypatch)
    client = TestClient(app)
    provider_headers = _provider_session_headers(client, "provider-oleksandr")
    client.patch(
        "/api/providers/provider-oleksandr/profile",
        headers=provider_headers,
        json={
            "name": "Олександр",
            "phone": "+380671112233",
            "vehicle": "Volkswagen Transporter",
            "plate": "AO 1248 CH",
            "specialties": ["tow", "battery"],
            "serviceRadiusKm": 7,
        },
    )

    response = client.patch(
        "/api/providers/provider-oleksandr/presence",
        headers=provider_headers,
        json={"status": "online", "location": {"lat": 48.63, "lng": 22.27}},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "online"


def test_fastapi_registers_provider_profile(monkeypatch, tmp_path) -> None:
    _use_temp_store(monkeypatch, tmp_path)
    _use_provider_auth(monkeypatch)
    client = TestClient(app)
    provider_headers = _provider_session_headers(client, "provider-oleksandr")

    response = client.patch(
        "/api/providers/provider-oleksandr/profile",
        headers=provider_headers,
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
    monkeypatch.setenv("POMICH_ADMIN_TOKEN", ADMIN_TOKEN)
    client = TestClient(app)
    admin_headers = _admin_session_headers(client)
    customer_id = "guest-customer-42"
    customer_headers = _customer_session_headers(client, customer_id)

    profile = client.patch(
        f"/api/customers/{customer_id}/profile",
        json={"name": "Марія", "phone": "+380501112233", "city": "Київ", "telegram": "maria_road"},
        headers=customer_headers,
    )
    submitted = client.post(
        f"/api/customers/{customer_id}/verification/submit",
        json={"phone": True, "telegram": True, "identityDocumentRef": "doc/customer-42/passport"},
        headers=customer_headers,
    )
    reviewed = client.patch(
        f"/api/customers/{customer_id}/verification/review",
        json={"status": "verified", "reviewNote": "Документи збігаються"},
        headers=admin_headers,
    )

    assert profile.status_code == 200
    assert profile.json()["name"] == "Марія"
    assert submitted.status_code == 200
    assert submitted.json()["verificationStatus"] == "pending"
    assert reviewed.status_code == 200
    assert reviewed.json()["verificationStatus"] == "verified"
    assert "Профіль заповнено" in reviewed.json()["trustedBadges"]


def test_fastapi_customer_profile_requires_matching_session(monkeypatch, tmp_path) -> None:
    _use_temp_store(monkeypatch, tmp_path)
    client = TestClient(app)
    own_headers = _customer_session_headers(client, "guest-customer-42")
    other_headers = _customer_session_headers(client, "guest-customer-99")

    missing = client.get("/api/customers/guest-customer-42/profile")
    own = client.get("/api/customers/guest-customer-42/profile", headers=own_headers)
    other = client.get("/api/customers/guest-customer-42/profile", headers=other_headers)

    assert missing.status_code == 401
    assert missing.json()["detail"] == "customer_session_required"
    assert own.status_code == 200
    assert other.status_code == 403
    assert other.json()["detail"] == "customer_identity_mismatch"


def test_fastapi_provider_verification_submit_and_admin_review(monkeypatch, tmp_path) -> None:
    _use_temp_store(monkeypatch, tmp_path)
    monkeypatch.setenv("POMICH_ADMIN_TOKEN", ADMIN_TOKEN)
    monkeypatch.setenv("POMICH_PROVIDER_TOKEN", PROVIDER_TOKEN)
    client = TestClient(app)
    provider_headers = _provider_session_headers(client, "provider-new")
    admin_headers = _admin_session_headers(client)
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
        headers=provider_headers,
    )
    blocked_presence = client.patch(
        "/api/providers/provider-new/presence",
        json={"status": "online", "location": {"lat": 48.63, "lng": 22.27}},
        headers=provider_headers,
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
        headers=provider_headers,
    )
    reviewed = client.patch(
        "/api/providers/provider-new/verification/review",
        json={"status": "verified", "reviewedBy": "dispatcher"},
        headers=admin_headers,
    )
    accepted_presence = client.patch(
        "/api/providers/provider-new/presence",
        json={"status": "online", "location": {"lat": 48.63, "lng": 22.27}},
        headers=provider_headers,
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
    monkeypatch.setenv("POMICH_PROVIDER_TOKEN", PROVIDER_TOKEN)
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
    bootstrap_rejected = client.patch(
        "/api/providers/provider-oleksandr/profile",
        json=payload,
        headers=PROVIDER_HEADERS,
    )
    provider_headers = _provider_session_headers(client, "provider-oleksandr")
    accepted = client.patch(
        "/api/providers/provider-oleksandr/profile",
        json=payload,
        headers=provider_headers,
    )

    assert rejected.status_code == 401
    assert rejected.json()["detail"] == "provider_session_required"
    assert bootstrap_rejected.status_code == 401
    assert bootstrap_rejected.json()["detail"] == "provider_session_required"
    assert accepted.status_code == 200
    assert accepted.json()["specialties"] == ["tow", "fuel"]


def test_fastapi_rejects_provider_routes_when_auth_is_not_configured(monkeypatch, tmp_path) -> None:
    _use_temp_store(monkeypatch, tmp_path)
    monkeypatch.delenv("POMICH_PROVIDER_TOKEN", raising=False)
    client = TestClient(app)

    response = client.patch(
        "/api/providers/provider-oleksandr/profile",
        json={
            "name": "Provider",
            "phone": "+380671112233",
            "vehicle": "Volkswagen Transporter",
            "specialties": ["tow"],
            "serviceRadiusKm": 9,
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "provider_auth_not_configured"


def test_fastapi_provider_session_is_identity_scoped(monkeypatch, tmp_path) -> None:
    _use_temp_store(monkeypatch, tmp_path)
    _use_provider_auth(monkeypatch)
    order_store.save_providers(
        [
            _api_provider("p1", 48.6218, 22.2879),
            _api_provider("p2", 48.6228, 22.2879),
        ],
    )
    client = TestClient(app)

    session_response = client.post("/api/auth/provider/session", headers=PROVIDER_HEADERS, json={"providerId": "p1"})
    access_token = session_response.json()["accessToken"]
    session_headers = {"Authorization": f"Bearer {access_token}"}

    own_profile = client.get("/api/providers/p1/profile", headers=session_headers)
    other_profile = client.get("/api/providers/p2/profile", headers=session_headers)

    assert session_response.status_code == 200
    assert session_response.json()["role"] == "provider"
    assert session_response.json()["providerId"] == "p1"
    assert own_profile.status_code == 200
    assert other_profile.status_code == 403
    assert other_profile.json()["detail"] == "provider_identity_mismatch"


def test_fastapi_admin_session_can_access_admin_routes(monkeypatch) -> None:
    monkeypatch.setenv("POMICH_ADMIN_TOKEN", ADMIN_TOKEN)
    client = TestClient(app)

    session_response = client.post("/api/auth/admin/session", headers=ADMIN_HEADERS)
    access_token = session_response.json()["accessToken"]
    orders_response = client.get("/api/orders", headers={"Authorization": f"Bearer {access_token}"})

    assert session_response.status_code == 200
    assert session_response.json()["role"] == "admin"
    assert orders_response.status_code == 200


def test_fastapi_provider_account_login_issues_scoped_session(monkeypatch, tmp_path) -> None:
    _use_temp_store(monkeypatch, tmp_path)
    monkeypatch.setenv("POMICH_PROVIDER_TOKEN", PROVIDER_TOKEN)
    monkeypatch.setenv(
        "POMICH_PROVIDER_ACCOUNTS",
        json.dumps([{"providerId": "p1", "username": "oleksandr", "password": "provider-pass"}]),
    )
    order_store.save_providers([_api_provider("p1", 48.6218, 22.2879), _api_provider("p2", 48.6228, 22.2879)])
    client = TestClient(app)

    login_response = client.post("/api/auth/provider/login", json={"login": "oleksandr", "password": "provider-pass"})
    access_token = login_response.json()["accessToken"]
    own_profile = client.get("/api/providers/p1/profile", headers={"Authorization": f"Bearer {access_token}"})
    other_profile = client.get("/api/providers/p2/profile", headers={"Authorization": f"Bearer {access_token}"})

    assert login_response.status_code == 200
    assert login_response.json()["providerId"] == "p1"
    assert own_profile.status_code == 200
    assert other_profile.status_code == 403


def test_fastapi_admin_account_login_can_access_admin_routes(monkeypatch) -> None:
    monkeypatch.setenv("POMICH_ADMIN_TOKEN", ADMIN_TOKEN)
    monkeypatch.setenv("POMICH_ADMIN_ACCOUNTS", json.dumps([{"username": "dispatcher", "password": "admin-pass"}]))
    client = TestClient(app)

    login_response = client.post("/api/auth/admin/login", json={"username": "dispatcher", "password": "admin-pass"})
    access_token = login_response.json()["accessToken"]
    orders_response = client.get("/api/orders", headers={"Authorization": f"Bearer {access_token}"})

    assert login_response.status_code == 200
    assert login_response.json()["role"] == "admin"
    assert login_response.json()["username"] == "dispatcher"
    assert orders_response.status_code == 200


def test_fastapi_telegram_customer_session_links_profile(monkeypatch, tmp_path) -> None:
    _use_temp_store(monkeypatch, tmp_path)
    telegram_token = "123456:telegram-token"
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", telegram_token)
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", CUSTOMER_SESSION_SECRET)
    client = TestClient(app)
    init_data = _signed_init_data(
        {
            "auth_date": str(int(time.time())),
            "user": json.dumps({"id": 42, "username": "driver_help", "first_name": "Maria"}, separators=(",", ":")),
        },
        telegram_token,
    )

    session_response = client.post("/api/auth/customer/telegram/session", headers={"X-Telegram-Init-Data": init_data})
    access_token = session_response.json()["accessToken"]
    profile_response = client.get("/api/customers/tg-42/profile", headers={"Authorization": f"Bearer {access_token}"})

    assert session_response.status_code == 200
    assert session_response.json()["role"] == "customer"
    assert session_response.json()["customerId"] == "tg-42"
    assert session_response.json()["customerIdentity"]["type"] == "telegram"
    assert session_response.json()["profile"]["verification"]["telegram"] is True
    assert profile_response.status_code == 200
    assert profile_response.json()["telegram"] == "driver_help"


def test_fastapi_telegram_mini_app_order_uses_verified_identity(monkeypatch, tmp_path) -> None:
    _use_temp_store(monkeypatch, tmp_path)
    telegram_token = "123456:telegram-token"
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", telegram_token)
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", CUSTOMER_SESSION_SECRET)
    client = TestClient(app)
    init_data = _signed_init_data(
        {
            "auth_date": str(int(time.time())),
            "user": json.dumps({"id": 42, "username": "driver_help", "first_name": "Maria"}, separators=(",", ":")),
        },
        telegram_token,
    )
    session_response = client.post("/api/auth/customer/telegram/session", headers={"X-Telegram-Init-Data": init_data})
    customer_headers = {"Authorization": f"Bearer {session_response.json()['accessToken']}"}

    response = client.post(
        "/api/orders",
        headers=customer_headers,
        json={
            "source": "telegram-mini-app",
            "telegramInitData": init_data,
            "service": "tow",
            "status": "draft",
        },
    )

    assert response.status_code == 201
    assert response.json()["telegramUserId"] == "42"
    assert response.json()["chatId"] == "42"
    assert response.json()["customerId"] == "tg-42"
    assert response.json()["customerIdentity"]["type"] == "telegram"


def test_fastapi_rejects_admin_orders_without_token(monkeypatch) -> None:
    monkeypatch.setenv("POMICH_ADMIN_TOKEN", ADMIN_TOKEN)
    client = TestClient(app)

    response = client.get("/api/orders")
    bootstrap_response = client.get("/api/orders", headers=ADMIN_HEADERS)

    assert response.status_code == 401
    assert response.json()["detail"] == "admin_session_required"
    assert bootstrap_response.status_code == 401
    assert bootstrap_response.json()["detail"] == "admin_session_required"


def test_fastapi_create_order_persists_customer_comment(monkeypatch, tmp_path) -> None:
    _use_temp_store(monkeypatch, tmp_path)
    client = TestClient(app)

    created = client.post(
        "/api/orders",
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
    client = TestClient(app)
    admin_headers = _admin_session_headers(client)

    created = client.post("/api/orders", json={"service": "tow", "status": "searching"})
    response = client.patch(
        f"/api/orders/{created.json()['id']}/status",
        json={"status": "completed"},
        headers=admin_headers,
    )

    assert response.status_code == 409


def test_fastapi_dispatches_order_and_first_offer_acceptance_wins(monkeypatch, tmp_path) -> None:
    _use_temp_store(monkeypatch, tmp_path)
    _use_provider_auth(monkeypatch)
    order_store.save_providers(
        [
            _api_provider("p1", 48.6218, 22.2879),
            _api_provider("p2", 48.6228, 22.2879),
        ],
    )
    client = TestClient(app)
    first_provider_headers = _provider_session_headers(client, "p1")
    second_provider_headers = _provider_session_headers(client, "p2")

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

    order = client.get(f"/api/orders/{created_order['id']}").json()
    assert order["assignedProviderId"] == "p1"
    assert order["status"] == "accepted"
    assert order["partnerProposedPrice"] == 1200
    assert order["providerName"] == order["assignedProvider"]["name"]
    assert {offer["status"] for offer in order["offers"]} == {"accepted", "lost"}


def test_fastapi_cancel_order_notifies_partner(monkeypatch, tmp_path) -> None:
    _use_temp_store(monkeypatch, tmp_path)
    _use_provider_auth(monkeypatch)
    order_store.save_providers([_api_provider("p1", 48.6218, 22.2879)])
    client = TestClient(app)
    provider_headers = _provider_session_headers(client, "p1")

    created_order = client.post(
        "/api/orders",
        json={
            "service": "tow",
            "status": "searching",
            "customerCoordinates": {"lat": 48.6208, "lng": 22.2879},
        },
    ).json()
    sent_messages: list[dict[str, str]] = []

    def _fake_notify(order: dict) -> list[dict]:
        sent_messages.append({"id": str(order.get("id")), "status": str(order.get("status"))})
        return [{"ok": True}]

    monkeypatch.setattr("bot.fastapi_app.notify_order_cancelled", _fake_notify)

    cancelled = client.post(f"/api/orders/{created_order['id']}/cancel")
    assert cancelled.status_code == 200
    assert cancelled.json()["status"] == "cancelled"
    assert sent_messages == [{"id": created_order["id"], "status": "cancelled"}]

    offers = client.get("/api/providers/p1/offers", headers=provider_headers).json()
    assert offers == []


def test_fastapi_assigned_provider_can_drive_lifecycle(monkeypatch, tmp_path) -> None:
    _use_temp_store(monkeypatch, tmp_path)
    _use_provider_auth(monkeypatch)
    order_store.save_providers([_api_provider("p1", 48.6218, 22.2879)])
    client = TestClient(app)
    provider_headers = _provider_session_headers(client, "p1")

    created_order = client.post(
        "/api/orders",
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
        json={"proposedPrice": 1500, "priceNote": "Евакуатор + подача"},
    )
    client.post(f"/api/orders/{created_order['id']}/confirm-price")

    assert client.patch(f"/api/providers/p1/orders/{created_order['id']}/status", headers=provider_headers, json={"status": "en_route"}).json()["status"] == "en_route"
    assert client.patch(f"/api/providers/p1/orders/{created_order['id']}/status", headers=provider_headers, json={"status": "arrived"}).json()["status"] == "arrived"
    assert client.patch(f"/api/providers/p1/orders/{created_order['id']}/status", headers=provider_headers, json={"status": "in_progress"}).json()["status"] == "in_progress"
    assert client.patch(f"/api/providers/p1/orders/{created_order['id']}/status", headers=provider_headers, json={"status": "completed"}).json()["status"] == "completed"

    provider = client.get("/api/providers").json()[0]
    assert provider["status"] == "online"
    assert "assignedOrderId" not in provider


def test_admin_endpoints_require_session_and_expose_ops_data(monkeypatch, tmp_path) -> None:
    monkeypatch.setenv("POMICH_RUNTIME", "dev")
    monkeypatch.setenv("POMICH_ADMIN_TOKEN", ADMIN_TOKEN)
    monkeypatch.setenv("POMICH_PROVIDER_TOKEN", PROVIDER_TOKEN)
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", CUSTOMER_SESSION_SECRET)
    _use_temp_store(monkeypatch, tmp_path)
    order_store.save_providers([_api_provider("p1", 48.6218, 22.2879)])
    order_store.update_customer_profile("guest-1", {"name": "Test Client", "phone": "+380501234567", "city": "Ужгород"})
    order_store.save_order({"service": "tow", "status": "searching", "customerLocation": "Test", "destination": "Garage"})
    client = TestClient(app)
    admin_headers = _admin_session_headers(client)

    assert client.get("/api/admin/stats").status_code == 401
    stats = client.get("/api/admin/stats", headers=admin_headers).json()
    assert stats["totals"]["clients"] >= 1
    assert stats["totals"]["orders"] >= 1
    assert isinstance(stats["activity"], list)

    clients = client.get("/api/admin/clients", headers=admin_headers).json()
    assert any(item["id"] == "guest-1" for item in clients)

    providers = client.get("/api/admin/providers", headers=admin_headers).json()
    assert any(item["id"] == "p1" for item in providers)

    updated = client.patch("/api/admin/clients/guest-1", headers=admin_headers, json={"city": "Київ"}).json()
    assert updated["city"] == "Київ"

    provider_updated = client.patch("/api/admin/providers/p1", headers=admin_headers, json={"status": "offline", "city": "Ужгород"}).json()
    assert provider_updated["status"] == "offline"

    settings = client.get("/api/admin/settings", headers=admin_headers).json()
    assert settings["runtime"] == "dev"
    assert "corsOrigins" in settings


def test_admin_clients_decrypt_filter_and_purge_guests(monkeypatch, tmp_path) -> None:
    from bot.field_encryption import generate_encryption_key

    key = generate_encryption_key()
    monkeypatch.setenv("POMICH_ENCRYPTION_KEY", key)
    import bot.field_encryption as encryption_module

    encryption_module._fernet = None
    encryption_module._fernet_checked = False

    monkeypatch.setenv("POMICH_RUNTIME", "dev")
    monkeypatch.setenv("POMICH_ADMIN_TOKEN", ADMIN_TOKEN)
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", CUSTOMER_SESSION_SECRET)
    _use_temp_store(monkeypatch, tmp_path)

    order_store.update_customer_profile("tg-99", {"name": "Олексій", "phone": "+380671112233", "telegram": "alex"})
    order_store.update_customer_profile("guest-empty", {"name": "Клієнт POMICH"})
    order_store.update_customer_profile("guest-real", {"name": "Марія", "phone": "+380501112233"})

    profiles = order_store.load_customer_profiles()
    for profile in profiles:
        if profile["id"] == "guest-empty":
            profile["createdAt"] = "2020-01-01T00:00:00"
            profile["updatedAt"] = "2020-01-01T00:00:00"
    order_store.save_customer_profiles(profiles)

    client = TestClient(app)
    admin_headers = _admin_session_headers(client)

    default_clients = client.get("/api/admin/clients", headers=admin_headers).json()
    default_ids = {item["id"] for item in default_clients}
    assert "tg-99" in default_ids
    assert "guest-real" in default_ids
    assert "guest-empty" not in default_ids

    telegram_client = next(item for item in default_clients if item["id"] == "tg-99")
    assert telegram_client["name"] == "Олексій"
    assert telegram_client["displayName"] == "Олексій"
    assert not str(telegram_client["name"]).startswith("enc:v1:")

    all_clients = client.get("/api/admin/clients?includeGuests=true", headers=admin_headers).json()
    assert any(item["id"] == "guest-empty" for item in all_clients)

    purge = client.post("/api/admin/clients/purge-guests?days=7", headers=admin_headers).json()
    assert purge["deleted"] >= 1
    assert "guest-empty" in purge["customerIds"]


def test_fastapi_customer_otp_send_and_confirm(monkeypatch, tmp_path) -> None:
    _use_temp_store(monkeypatch, tmp_path)
    otp_path = tmp_path / "otp_codes.json"
    monkeypatch.setattr("bot.otp_verification._default_otp_store_path", lambda: otp_path)
    monkeypatch.setattr("bot.otp_verification._generate_otp_code", lambda: "112233")
    monkeypatch.setenv("POMICH_OTP_SECRET", "test-otp-secret")
    monkeypatch.delenv("SMTP_HOST", raising=False)
    client = TestClient(app)
    customer_headers = _customer_session_headers(client, "guest-otp-1")

    client.patch(
        "/api/customers/guest-otp-1/profile",
        json={"name": "Test User", "phone": "+380501112233", "email": "user@example.com"},
        headers=customer_headers,
    )

    send_response = client.post(
        "/api/auth/customer/verify/send",
        json={"channel": "email", "email": "user@example.com"},
        headers=customer_headers,
    )
    confirm_response = client.post(
        "/api/auth/customer/verify/confirm",
        json={"code": "112233"},
        headers=customer_headers,
    )

    assert send_response.status_code == 200
    assert send_response.json()["channel"] == "email"
    assert send_response.json()["devCode"] == "112233"
    assert confirm_response.status_code == 200
    assert confirm_response.json()["profile"]["verificationStatus"] == "verified"
    assert confirm_response.json()["profile"]["verification"]["email"] is True


def test_customer_phone_login_send_and_confirm(monkeypatch, tmp_path) -> None:
    _use_temp_store(monkeypatch, tmp_path)
    otp_path = tmp_path / "otp_codes.json"
    monkeypatch.setattr("bot.otp_verification._default_otp_store_path", lambda: otp_path)
    monkeypatch.setattr("bot.otp_verification._generate_otp_code", lambda: "445566")
    monkeypatch.setattr("bot.otp_verification._send_telegram_otp", lambda chat_id, code: 321)
    monkeypatch.setenv("POMICH_OTP_SECRET", "test-otp-secret")
    order_store.update_customer_profile(
        "tg-829741830",
        {"name": "Vitaliy", "phone": "+380661007434"},
    )

    client = TestClient(app)
    missing = client.post("/api/auth/customer/phone/login/send", json={"phone": "+380000000000"})
    assert missing.status_code == 404
    assert missing.json()["detail"] == "customer_not_found"

    send_response = client.post("/api/auth/customer/phone/login/send", json={"phone": "+380661007434"})
    assert send_response.status_code == 200
    assert send_response.json()["channel"] == "telegram"

    confirm_response = client.post(
        "/api/auth/customer/phone/login/confirm",
        json={"phone": "+380661007434", "code": "445566"},
    )
    assert confirm_response.status_code == 200
    body = confirm_response.json()
    assert body["customerId"] == "tg-829741830"
    assert body["profile"]["name"] == "Vitaliy"
    assert body["account"]["clientRegistered"] is True


def test_customer_phone_login_send_allows_duplicate_registered_phone(monkeypatch, tmp_path) -> None:
    """Login OTP must not 500 when guest + tg rows share the same phone."""
    _use_temp_store(monkeypatch, tmp_path)
    otp_path = tmp_path / "otp_codes.json"
    monkeypatch.setattr("bot.otp_verification._default_otp_store_path", lambda: otp_path)
    monkeypatch.setattr("bot.otp_verification._generate_otp_code", lambda: "778899")
    monkeypatch.setattr("bot.otp_verification._send_telegram_otp", lambda chat_id, code: 654)
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


def test_fastapi_rejects_duplicate_customer_phone(monkeypatch, tmp_path) -> None:
    customer_path = tmp_path / "customers.json"
    monkeypatch.setattr(order_store, "_default_customer_store_path", lambda: customer_path)
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", CUSTOMER_SESSION_SECRET)
    order_store.update_customer_profile(
        "tg-100",
        {"name": "Maria", "phone": "+380501112233", "city": "Uzhhorod"},
        customer_path,
    )

    client = TestClient(app)
    headers = _customer_session_headers(client, "guest-dup-1")
    response = client.patch(
        "/api/customers/guest-dup-1/profile",
        headers=headers,
        json={"name": "Oleg", "phone": "+380501112233", "city": "Lviv"},
    )
    assert response.status_code == 409
    assert response.json()["detail"] == "phone_already_registered"
