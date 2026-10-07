import json
import time
from fastapi.testclient import TestClient
from bot import order_store

from .support.api import _api_provider, _use_provider_auth, _provider_session_headers, _admin_session_headers, _customer_session_headers, _signed_init_data, app, PROVIDER_TOKEN, PROVIDER_HEADERS, ADMIN_TOKEN, ADMIN_HEADERS, CUSTOMER_SESSION_SECRET


def test_fastapi_customer_profile_requires_matching_session(monkeypatch, tmp_path, temp_store) -> None:
    temp_store()
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


def test_fastapi_requires_provider_token_when_configured(monkeypatch, tmp_path, temp_store) -> None:
    temp_store()
    monkeypatch.setenv("POMICH_PROVIDER_TOKEN", PROVIDER_TOKEN)
    client = TestClient(app)
    payload = {
        "name": "ÐÐ»ÐµÐºÑÐ°Ð½Ð´Ñ",
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


def test_fastapi_rejects_provider_routes_when_auth_is_not_configured(monkeypatch, tmp_path, temp_store) -> None:
    temp_store()
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


def test_fastapi_provider_session_is_identity_scoped(monkeypatch, tmp_path, temp_store) -> None:
    temp_store()
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


def test_fastapi_provider_account_login_issues_scoped_session(monkeypatch, tmp_path, temp_store) -> None:
    temp_store()
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


def test_fastapi_telegram_customer_session_links_profile(monkeypatch, tmp_path, temp_store) -> None:
    temp_store()
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


def test_fastapi_telegram_mini_app_order_uses_verified_identity(monkeypatch, tmp_path, temp_store) -> None:
    temp_store()
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


def test_fastapi_telegram_mini_app_order_requires_session_when_bots_unset(monkeypatch, tmp_path, temp_store) -> None:
    """Without Telegram bot tokens, source=telegram-mini-app must not skip auth."""
    temp_store()
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("POMICH_TELEGRAM_CUSTOMER_BOT_TOKEN", raising=False)
    monkeypatch.delenv("POMICH_TELEGRAM_PROVIDER_BOT_TOKEN", raising=False)
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", CUSTOMER_SESSION_SECRET)
    client = TestClient(app)

    anonymous = client.post(
        "/api/orders",
        json={
            "source": "telegram-mini-app",
            "service": "tow",
            "status": "draft",
            "customerId": "tg-attacker",
        },
    )
    assert anonymous.status_code == 401
    assert anonymous.json()["detail"] == "customer_session_required"

    headers = _customer_session_headers(client)
    authed = client.post(
        "/api/orders",
        headers=headers,
        json={
            "source": "telegram-mini-app",
            "service": "tow",
            "status": "draft",
        },
    )
    assert authed.status_code == 201
    assert authed.json()["customerId"].startswith("guest-")


def test_fastapi_rejects_admin_orders_without_token(monkeypatch) -> None:
    monkeypatch.setenv("POMICH_ADMIN_TOKEN", ADMIN_TOKEN)
    client = TestClient(app)

    response = client.get("/api/orders")
    bootstrap_response = client.get("/api/orders", headers=ADMIN_HEADERS)

    assert response.status_code == 401
    assert response.json()["detail"] == "admin_session_required"
    assert bootstrap_response.status_code == 401
    assert bootstrap_response.json()["detail"] == "admin_session_required"


def test_admin_endpoints_require_session_and_expose_ops_data(monkeypatch, tmp_path, temp_store) -> None:
    monkeypatch.setenv("POMICH_RUNTIME", "dev")
    monkeypatch.setenv("POMICH_ADMIN_TOKEN", ADMIN_TOKEN)
    monkeypatch.setenv("POMICH_PROVIDER_TOKEN", PROVIDER_TOKEN)
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", CUSTOMER_SESSION_SECRET)
    temp_store()
    order_store.save_providers([_api_provider("p1", 48.6218, 22.2879)])
    order_store.update_customer_profile("guest-1", {"name": "Test Client", "phone": "+380501234567", "city": "Ð£Ð¶Ð³Ð¾ÑÐ¾Ð´"})
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

    updated = client.patch("/api/admin/clients/guest-1", headers=admin_headers, json={"city": "ÐÐ¸ÑÐ²"}).json()
    assert updated["city"] == "ÐÐ¸ÑÐ²"

    provider_updated = client.patch("/api/admin/providers/p1", headers=admin_headers, json={"status": "offline", "city": "Ð£Ð¶Ð³Ð¾ÑÐ¾Ð´"}).json()
    assert provider_updated["status"] == "offline"

    settings = client.get("/api/admin/settings", headers=admin_headers).json()
    assert settings["runtime"] == "dev"
    assert "corsOrigins" in settings


def test_fastapi_customer_otp_send_and_confirm(monkeypatch, tmp_path, temp_store) -> None:
    temp_store()
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


def test_customer_phone_login_send_and_confirm(monkeypatch, tmp_path, temp_store) -> None:
    temp_store()
    otp_path = tmp_path / "otp_codes.json"
    monkeypatch.setattr("bot.otp_verification._default_otp_store_path", lambda: otp_path)
    monkeypatch.setattr("bot.otp_verification._generate_otp_code", lambda: "445566")
    monkeypatch.setattr("bot.otp_verification._send_telegram_otp", lambda chat_id, code, **kwargs: 321)
    monkeypatch.setenv("POMICH_OTP_SECRET", "test-otp-secret")
    order_store.update_customer_profile(
        "tg-829741830",
        {"name": "Vitaliy", "phone": "+380661007434"},
    )

    client = TestClient(app)
    missing = client.post("/api/auth/customer/phone/login/send", json={"phone": "+380000000000"})
    assert missing.status_code == 200
    assert missing.json().get("masked") is True

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


def test_phone_login_confirm_queues_otp_message_delete(monkeypatch, tmp_path, temp_store) -> None:
    temp_store()
    otp_path = tmp_path / "otp_codes.json"
    telegram_calls: list[str] = []
    monkeypatch.setattr("bot.otp_verification._default_otp_store_path", lambda: otp_path)
    monkeypatch.setattr("bot.otp_verification._generate_otp_code", lambda: "445566")
    monkeypatch.setattr("bot.otp_verification._send_telegram_otp", lambda chat_id, code, **kwargs: 321)
    monkeypatch.setattr("bot.otp_verification._run_in_background", lambda fn: fn())
    monkeypatch.setattr(
        "bot.telegram_bot.send_message",
        lambda *args, **kwargs: telegram_calls.append("send") or {"ok": True, "result": {"message_id": 1}},
    )
    monkeypatch.setattr(
        "bot.telegram_bot.delete_message",
        lambda *args, **kwargs: telegram_calls.append("delete") or {"ok": True},
    )
    monkeypatch.setenv("POMICH_OTP_SECRET", "test-otp-secret")
    order_store.update_customer_profile(
        "tg-829741830",
        {"name": "Vitaliy", "phone": "+380661007434"},
    )

    client = TestClient(app)
    send_response = client.post("/api/auth/customer/phone/login/send", json={"phone": "+380661007434"})
    assert send_response.status_code == 200
    assert send_response.json().get("sent") is True
    telegram_calls.clear()

    confirm_response = client.post(
        "/api/auth/customer/phone/login/confirm",
        json={"phone": "+380661007434", "code": "445566"},
    )
    assert confirm_response.status_code == 200
    # Async delete tries preferred bot + fallback (2 calls); confirm itself must not send OTP.
    deadline = time.time() + 1.0
    while time.time() < deadline and len(telegram_calls) < 2:
        time.sleep(0.01)
    assert telegram_calls == ["delete", "delete"]
    assert "send" not in telegram_calls


def test_fastapi_rejects_duplicate_customer_phone(monkeypatch, tmp_path, temp_store) -> None:
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


def test_fastapi_update_own_phone_unchanged_succeeds(monkeypatch, tmp_path, temp_store) -> None:
    temp_store()
    otp_path = tmp_path / "otp_codes.json"
    monkeypatch.setattr("bot.otp_verification._default_otp_store_path", lambda: otp_path)
    monkeypatch.setattr("bot.otp_verification._generate_otp_code", lambda: "445566")
    monkeypatch.setattr("bot.otp_verification._send_telegram_otp", lambda chat_id, code, **kwargs: 321)
    monkeypatch.setenv("POMICH_OTP_SECRET", "test-otp-secret")
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", CUSTOMER_SESSION_SECRET)
    customer_path = tmp_path / "customers.json"
    order_store.update_customer_profile(
        "tg-powergear",
        {"name": "PowerGear", "phone": "+380635236801", "city": "Ужгород"},
        customer_path,
    )
    profiles = order_store.load_customer_profiles(customer_path)
    profiles.append(
        {
            "id": "guest-old",
            "name": "PowerGear",
            "phone": "+380635236801",
            "city": "Ужгород",
            "verificationStatus": "verified",
        }
    )
    order_store.save_customer_profiles(profiles, customer_path)

    client = TestClient(app)
    send_response = client.post("/api/auth/customer/phone/login/send", json={"phone": "+380635236801"})
    assert send_response.status_code == 200
    confirm_response = client.post(
        "/api/auth/customer/phone/login/confirm",
        json={"phone": "+380635236801", "code": "445566"},
    )
    assert confirm_response.status_code == 200
    headers = {"Authorization": f"Bearer {confirm_response.json()['accessToken']}"}
    response = client.patch(
        "/api/customers/tg-powergear/profile",
        headers=headers,
        json={
            "name": "PowerGear",
            "phone": "+380635236801",
            "city": "Ужгород",
            "email": "power@example.com",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["phone"] == "+380635236801"
    assert body["email"] == "power@example.com"


def test_fastapi_provider_public_card_no_auth(monkeypatch, tmp_path, temp_store) -> None:
    order_path, provider_path, _offer_path = temp_store()
    order_store.save_providers([_api_provider("p-public", 48.62, 22.28)])
    order_store.save_order(
        {
            "id": "ord-pub-1",
            "service": "tow",
            "status": "completed",
            "assignedProviderId": "p-public",
            "customerReview": {"rating": 5, "comment": "Good job", "at": "2026-08-01T12:00:00"},
        },
        store_path=order_path,
    )
    client = TestClient(app)
    missing = client.get("/api/providers/missing/public")
    assert missing.status_code == 404
    response = client.get("/api/providers/p-public/public")
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == "p-public"
    assert body["name"] == "p-public"
    assert len(body["reviews"]) == 1
    assert body["reviews"][0]["comment"] == "Good job"
    # Public card must not leak contacts or exact GPS (same privacy bar as map pins).
    assert "phone" not in body
    assert "telegram" not in body
    location = body.get("location")
    assert isinstance(location, dict)
    assert location["lat"] == round(float(location["lat"]), 3)
    assert location["lng"] == round(float(location["lng"]), 3)
