from fastapi.testclient import TestClient
from bot import order_store

from .support.api import _api_provider, _use_provider_auth, _provider_session_headers, _provider_bearer_for_subject, _admin_session_headers, _customer_session_headers, app, PROVIDER_TOKEN, PROVIDER_HEADERS, ADMIN_TOKEN, CUSTOMER_SESSION_SECRET


def test_fastapi_updates_provider_presence(monkeypatch, tmp_path, temp_store) -> None:
    temp_store()
    _use_provider_auth(monkeypatch)
    client = TestClient(app)
    provider_headers = _provider_session_headers(client, "provider-oleksandr")
    client.patch(
        "/api/providers/provider-oleksandr/profile",
        headers=provider_headers,
        json={
            "name": "ÐÐ»ÐµÐºÑÐ°Ð½Ð´Ñ",
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


def test_fastapi_registers_provider_profile(monkeypatch, tmp_path, temp_store) -> None:
    temp_store()
    _use_provider_auth(monkeypatch)
    client = TestClient(app)
    provider_headers = _provider_session_headers(client, "provider-oleksandr")

    response = client.patch(
        "/api/providers/provider-oleksandr/profile",
        headers=provider_headers,
        json={
            "name": "ÐÐ»ÐµÐºÑÐ°Ð½Ð´Ñ",
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


def test_fastapi_customer_profile_and_verification_review(monkeypatch, tmp_path, temp_store) -> None:
    temp_store()
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


def test_fastapi_provider_verification_submit_and_admin_review(monkeypatch, tmp_path, temp_store) -> None:
    temp_store()
    monkeypatch.setenv("POMICH_ADMIN_TOKEN", ADMIN_TOKEN)
    monkeypatch.setenv("POMICH_PROVIDER_TOKEN", PROVIDER_TOKEN)
    client = TestClient(app)
    provider_headers = _provider_session_headers(client, "provider-new")
    admin_headers = _admin_session_headers(client)
    payload = {
        "name": "ÐÐ¾Ð²Ð¸Ð¹ Ð¿Ð°ÑÑÐ½ÐµÑ",
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


def test_fastapi_provider_profile_get_returns_empty_shell_when_missing(monkeypatch, tmp_path, temp_store) -> None:
    temp_store()
    _use_provider_auth(monkeypatch)
    client = TestClient(app)
    # Bootstrap must not mint for a non-existent provider.
    denied = client.post(
        "/api/auth/provider/session",
        headers=PROVIDER_HEADERS,
        json={"providerId": "provider-guest-new"},
    )
    assert denied.status_code == 404
    # Profile GET still returns an empty shell when a valid session subject has no row yet.
    provider_headers = _provider_bearer_for_subject("provider-guest-new")

    response = client.get("/api/providers/provider-guest-new/profile", headers=provider_headers)

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == "provider-guest-new"
    assert body["status"] == "offline"
    assert body["verificationStatus"] == "unverified"
    assert body["specialties"] == []


def test_fastapi_provider_profile_shell_prefills_linked_customer(monkeypatch, tmp_path, temp_store) -> None:
    temp_store()
    _use_provider_auth(monkeypatch)
    order_store.update_customer_profile(
        "guest-powergear",
        {"name": "PowerGear", "phone": "+380635236801", "city": "Ужгород", "linkedProviderId": "provider-guest-powergear"},
    )
    client = TestClient(app)
    provider_headers = _provider_bearer_for_subject("provider-guest-powergear")

    response = client.get("/api/providers/provider-guest-powergear/profile", headers=provider_headers)

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "PowerGear"
    assert body["phone"] == "+380635236801"
    assert body["city"] == "Ужгород"


def test_fastapi_assigned_provider_can_drive_lifecycle(monkeypatch, tmp_path, temp_store) -> None:
    temp_store()
    _use_provider_auth(monkeypatch)
    order_store.save_providers([_api_provider("p1", 48.6218, 22.2879)])
    client = TestClient(app)
    provider_headers = _provider_session_headers(client, "p1")
    customer_headers = _customer_session_headers(client, "guest-customer-lifecycle")

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
        json={"proposedPrice": 1500, "priceNote": "ÐÐ²Ð°ÐºÑÐ°ÑÐ¾Ñ + Ð¿Ð¾Ð´Ð°ÑÐ°"},
    )
    client.post(f"/api/orders/{created_order['id']}/confirm-price", headers=customer_headers)

    assert client.patch(f"/api/providers/p1/orders/{created_order['id']}/status", headers=provider_headers, json={"status": "en_route"}).json()["status"] == "en_route"
    assert client.patch(f"/api/providers/p1/orders/{created_order['id']}/status", headers=provider_headers, json={"status": "arrived"}).json()["status"] == "arrived"
    assert client.patch(f"/api/providers/p1/orders/{created_order['id']}/status", headers=provider_headers, json={"status": "in_progress"}).json()["status"] == "in_progress"
    assert client.patch(f"/api/providers/p1/orders/{created_order['id']}/status", headers=provider_headers, json={"status": "completed"}).json()["status"] == "completed"

    monkeypatch.setenv("POMICH_ADMIN_TOKEN", ADMIN_TOKEN)
    admin_headers = _admin_session_headers(client)
    provider = client.get("/api/providers", headers=admin_headers).json()[0]
    assert provider["status"] == "online"
    assert "assignedOrderId" not in provider


def test_admin_clients_decrypt_filter_and_purge_guests(monkeypatch, tmp_path, temp_store) -> None:
    from bot.field_encryption import generate_encryption_key

    key = generate_encryption_key()
    monkeypatch.setenv("POMICH_ENCRYPTION_KEY", key)
    import bot.field_encryption as encryption_module

    encryption_module._fernet = None
    encryption_module._fernet_checked = False

    monkeypatch.setenv("POMICH_RUNTIME", "dev")
    monkeypatch.setenv("POMICH_ADMIN_TOKEN", ADMIN_TOKEN)
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", CUSTOMER_SESSION_SECRET)
    temp_store()

    order_store.update_customer_profile("tg-99", {"name": "ÐÐ»ÐµÐºÑÑÐ¹", "phone": "+380679998877", "telegram": "alex"})
    order_store.update_customer_profile("guest-empty", {"name": "ÐÐ»ÑÑÐ½Ñ POMICH"})
    order_store.update_customer_profile("guest-real", {"name": "ÐÐ°ÑÑÑ", "phone": "+380501112233"})

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
    assert telegram_client["name"] == "ÐÐ»ÐµÐºÑÑÐ¹"
    assert telegram_client["displayName"] == "ÐÐ»ÐµÐºÑÑÐ¹"
    assert not str(telegram_client["name"]).startswith("enc:v1:")

    all_clients = client.get("/api/admin/clients?includeGuests=true", headers=admin_headers).json()
    assert any(item["id"] == "guest-empty" for item in all_clients)

    purge = client.post("/api/admin/clients/purge-guests?days=7", headers=admin_headers).json()
    assert purge["deleted"] >= 1
    assert "guest-empty" in purge["customerIds"]
