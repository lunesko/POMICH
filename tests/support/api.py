"""Shared api test builders."""
import hashlib
import hmac
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
        "plate": "AO 1248 CH",
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

def _use_provider_auth(monkeypatch) -> dict:
    monkeypatch.setenv("POMICH_PROVIDER_TOKEN", PROVIDER_TOKEN)
    return PROVIDER_HEADERS

def _provider_session_headers(client: TestClient, provider_id: str) -> dict:
    if order_store.get_provider_profile(provider_id) is None:
        # Persist an empty shell so ops bootstrap cannot invent phantom provider ids.
        providers = order_store.load_providers()
        providers.append(order_store.build_empty_provider_profile_shell(provider_id))
        order_store.save_providers(providers)
    response = client.post("/api/auth/provider/session", headers=PROVIDER_HEADERS, json={"providerId": provider_id})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}

def _provider_bearer_for_subject(provider_id: str) -> dict:
    """Issue a provider bearer without requiring a persisted profile (shell GET tests)."""
    from bot.api_deps import configured_provider_secret, issue_role_session

    session = issue_role_session("provider", provider_id, configured_provider_secret())
    return {"Authorization": f"Bearer {session['accessToken']}"}

def _admin_session_headers(client: TestClient) -> dict:
    response = client.post("/api/auth/admin/session", headers=ADMIN_HEADERS)
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}

def _customer_session_headers(client: TestClient, customer_id: str | None = None) -> dict:
    payload: dict = {}
    if customer_id:
        if not order_store.customer_profile_exists(customer_id):
            order_store.update_customer_profile(customer_id, {})
        payload = {"customerId": customer_id}
    response = client.post("/api/auth/customer/guest/session", json=payload)
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}

def _signed_init_data(payload: dict[str, str], token: str) -> str:
    data_check_string = "\n".join(f"{key}={value}" for key, value in sorted(payload.items()))
    secret_key = hmac.new(b"WebAppData", token.encode("utf-8"), hashlib.sha256).digest()
    signature = hmac.new(secret_key, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()
    return urlencode({**payload, "hash": signature})
