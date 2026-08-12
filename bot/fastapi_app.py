import base64
import binascii
import hashlib
import hmac
import ipaddress
import json
import os
import time
import urllib.parse
import uuid
from dataclasses import dataclass
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from bot.order_store import (
    DispatchConflict,
    InvalidStatusTransition,
    accept_offer,
    admin_delete_provider,
    admin_update_customer_profile,
    admin_update_provider_profile,
    attach_dispatch_to_order,
    attach_dispatch_to_orders,
    build_admin_activity_feed,
    build_admin_stats,
    build_user_account_status,
    decline_offer,
    dispatch_order,
    expire_offers,
    get_customer_profile,
    get_order,
    get_provider_profile,
    get_provider_offers,
    get_telegram_session,
    invalidate_order_offers,
    load_offers,
    load_orders,
    load_providers,
    load_customer_profiles,
    mark_user_role_registered,
    merge_directory_providers,
    nearby_searching_orders,
    review_customer_verification,
    review_provider_verification,
    save_order,
    set_user_preferred_role,
    submit_customer_verification,
    submit_provider_verification,
    upsert_telegram_customer_profile,
    update_customer_profile,
    update_order_status,
    update_provider_order_status,
    update_provider_presence,
    update_provider_profile,
)
from bot.provider_importer import import_uzhgorod_providers
from bot.field_encryption import encryption_enabled
from bot.otp_verification import OtpVerificationError, confirm_customer_verification_code, send_customer_verification_code
from bot.telegram_auth import verify_telegram_init_data
from bot.telegram_bot import get_configured_token, handle_update, notify_order_created

DIST_DIR = Path(__file__).resolve().parent.parent / "dist"
ASSETS_DIR = DIST_DIR / "assets"
_PLACEHOLDER_SECRET_FRAGMENTS = ("replace-me", "change-this", "changeme", "example", "placeholder")
_AUTH_SESSION_PREFIX = "pomich_auth_v1"
_DEFAULT_SESSION_TTL_SECONDS = 86400


@dataclass(frozen=True)
class AuthPrincipal:
    role: str
    subject_id: str
    auth_type: str


def _is_production_runtime() -> bool:
    runtime = os.getenv("POMICH_RUNTIME") or os.getenv("VITE_APP_ENV") or "dev"
    return runtime.strip().lower() in {"prod", "production"}


def _is_public_https_origin(origin: str) -> bool:
    normalized = origin.strip().lower()
    if not normalized.startswith("https://"):
        return False
    return not any(host in normalized for host in ("localhost", "127.0.0.1", "0.0.0.0", "::1", "*"))


def _allow_http_pilot() -> bool:
    return os.getenv("POMICH_ALLOW_HTTP_PILOT", "").strip().lower() in {"1", "true", "yes", "on"}


def _is_public_http_pilot_origin(origin: str) -> bool:
    normalized = origin.strip().rstrip("/")
    if not normalized.lower().startswith("http://"):
        return False
    parsed = urllib.parse.urlparse(normalized)
    host = (parsed.hostname or "").lower()
    if not host or host in {"localhost", "127.0.0.1", "0.0.0.0", "::1"}:
        return False
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        return False


def _is_allowed_public_origin(origin: str) -> bool:
    return _is_public_https_origin(origin) or (_allow_http_pilot() and _is_public_http_pilot_origin(origin))


def _is_configured_secret(value: str | None, *, min_length: int = 24) -> bool:
    normalized = (value or "").strip()
    if len(normalized) < min_length:
        return False
    return not any(fragment in normalized.lower() for fragment in _PLACEHOLDER_SECRET_FRAGMENTS)


def _get_cors_origins() -> list[str]:
    raw_origins = os.getenv("POMICH_CORS_ORIGINS", "*")
    origins = [origin.strip() for origin in raw_origins.split(",") if origin.strip()]
    return origins or ["*"]


def _runtime_config_errors() -> list[str]:
    if not _is_production_runtime():
        return []

    errors: list[str] = []
    cors_origins = _get_cors_origins()

    if "*" in cors_origins:
        errors.append("POMICH_CORS_ORIGINS must use exact HTTPS origins in production")
    else:
        invalid_origins = [origin for origin in cors_origins if not _is_allowed_public_origin(origin)]
        if invalid_origins:
            errors.append("POMICH_CORS_ORIGINS contains non-public or non-HTTPS origins")

    if not _is_configured_secret(os.getenv("POMICH_ADMIN_TOKEN")):
        errors.append("POMICH_ADMIN_TOKEN must be a non-placeholder secret in production")

    if not _is_configured_secret(os.getenv("POMICH_PROVIDER_TOKEN")):
        errors.append("POMICH_PROVIDER_TOKEN must be set in production so partner endpoints are protected")

    if not _is_configured_secret(os.getenv("POMICH_CUSTOMER_SESSION_SECRET")):
        errors.append("POMICH_CUSTOMER_SESSION_SECRET must be a non-placeholder secret in production")

    if not (os.getenv("DATABASE_URL") or "").strip() and os.getenv("POMICH_ALLOW_JSON_STORE_IN_PRODUCTION") != "true":
        errors.append("DATABASE_URL must be set in production, unless POMICH_ALLOW_JSON_STORE_IN_PRODUCTION=true is explicitly used for a small pilot")

    web_app_url = (os.getenv("WEB_APP_URL") or "").strip()
    telegram_token = (os.getenv("TELEGRAM_BOT_TOKEN") or os.getenv("VITE_TELEGRAM_BOT_TOKEN") or "").strip()
    if telegram_token and not web_app_url:
        errors.append("WEB_APP_URL must be set when Telegram is configured in production")
    elif telegram_token and not _is_allowed_public_origin(web_app_url):
        errors.append("WEB_APP_URL must be a public HTTPS URL when Telegram is configured in production")

    return errors


def _validate_runtime_config() -> None:
    errors = _runtime_config_errors()
    if errors:
        raise RuntimeError(f"Invalid POMICH production configuration: {'; '.join(errors)}")


_validate_runtime_config()

app = FastAPI(title="POMICH MVP", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "protocol": "fastapi", "runtime": "production" if _is_production_runtime() else "dev"}


def _verify_init_data_or_raise(init_data: str | None) -> dict | None:
    token = get_configured_token()
    if not token:
        return None

    if not init_data:
        raise HTTPException(status_code=401, detail="telegram_init_data_missing")

    try:
        return verify_telegram_init_data(init_data, token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


def _b64_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(f"{value}{padding}".encode("ascii"))


def _configured_admin_secret() -> str:
    secret = (os.getenv("POMICH_ADMIN_TOKEN") or "").strip()
    if not secret:
        raise HTTPException(status_code=403, detail="admin_auth_not_configured")
    return secret


def _configured_provider_secret() -> str:
    secret = (os.getenv("POMICH_PROVIDER_TOKEN") or "").strip()
    if not secret:
        raise HTTPException(status_code=403, detail="provider_auth_not_configured")
    return secret


def _configured_customer_secret() -> str:
    secret = (os.getenv("POMICH_CUSTOMER_SESSION_SECRET") or "").strip()
    if secret:
        return secret
    if _is_production_runtime():
        raise HTTPException(status_code=403, detail="customer_auth_not_configured")
    return "dev-customer-session-secret"


def _load_account_configs(env_name: str) -> list[dict]:
    raw_value = (os.getenv(env_name) or "").strip()
    if not raw_value:
        return []
    try:
        parsed = json.loads(raw_value)
    except json.JSONDecodeError:
        return []

    if isinstance(parsed, list):
        return [item for item in parsed if isinstance(item, dict)]
    if isinstance(parsed, dict):
        accounts: list[dict] = []
        for key, value in parsed.items():
            if isinstance(value, dict):
                account = dict(value)
            else:
                account = {"password": str(value)}
            account.setdefault("username", str(key))
            account.setdefault("providerId", str(key))
            accounts.append(account)
        return accounts
    return []


def _password_matches(account: dict, password: str) -> bool:
    supplied = str(password or "")
    expected_hash = str(account.get("passwordHash") or "").strip()
    if expected_hash.startswith("sha256:"):
        digest = hashlib.sha256(supplied.encode("utf-8")).hexdigest()
        return hmac.compare_digest(expected_hash.removeprefix("sha256:"), digest)
    expected_password = str(account.get("password") or "").strip()
    return bool(expected_password) and hmac.compare_digest(expected_password, supplied)


def _find_admin_account(username: str, password: str) -> dict | None:
    normalized_username = str(username or "").strip().lower()
    if not normalized_username or not password:
        return None
    for account in _load_account_configs("POMICH_ADMIN_ACCOUNTS"):
        identifiers = [
            str(account.get("username") or "").strip().lower(),
            str(account.get("email") or "").strip().lower(),
            str(account.get("id") or "").strip().lower(),
        ]
        if normalized_username in identifiers and _password_matches(account, password):
            return account
    return None


def _find_provider_account(login: str, password: str, provider_id: str | None = None) -> dict | None:
    normalized_login = str(login or provider_id or "").strip().lower()
    normalized_provider_id = str(provider_id or "").strip()
    if not normalized_login or not password:
        return None
    for account in _load_account_configs("POMICH_PROVIDER_ACCOUNTS"):
        account_provider_id = str(account.get("providerId") or account.get("id") or "").strip()
        identifiers = [
            account_provider_id.lower(),
            str(account.get("username") or "").strip().lower(),
            str(account.get("email") or "").strip().lower(),
            str(account.get("phone") or "").strip().lower(),
        ]
        if normalized_provider_id and account_provider_id != normalized_provider_id:
            continue
        if normalized_login in identifiers and _password_matches(account, password):
            return {**account, "providerId": account_provider_id}
    return None


def _extract_bearer_token(authorization: str | None) -> str | None:
    value = (authorization or "").strip()
    if not value:
        return None
    scheme, _, token = value.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="bearer_token_invalid")
    return token.strip()


def _session_ttl_seconds() -> int:
    raw_value = (os.getenv("POMICH_AUTH_SESSION_TTL_SECONDS") or "").strip()
    if not raw_value:
        return _DEFAULT_SESSION_TTL_SECONDS
    try:
        return max(300, int(raw_value))
    except ValueError:
        return _DEFAULT_SESSION_TTL_SECONDS


def _issue_role_session(role: str, subject_id: str, secret: str) -> dict:
    issued_at = int(time.time())
    expires_at = issued_at + _session_ttl_seconds()
    payload = {
        "role": role,
        "sub": str(subject_id),
        "iat": issued_at,
        "exp": expires_at,
    }
    body = _b64_encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signature = _b64_encode(hmac.new(secret.encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest())
    return {
        "role": role,
        "subjectId": str(subject_id),
        "tokenType": "Bearer",
        "accessToken": f"{_AUTH_SESSION_PREFIX}.{body}.{signature}",
        "expiresAt": expires_at,
    }


def _verify_role_session(token: str, expected_role: str, secret: str) -> AuthPrincipal:
    parts = token.split(".")
    if len(parts) != 3 or parts[0] != _AUTH_SESSION_PREFIX:
        raise HTTPException(status_code=401, detail=f"{expected_role}_session_invalid")

    _, body, signature = parts
    expected_signature = _b64_encode(hmac.new(secret.encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest())
    if not hmac.compare_digest(signature, expected_signature):
        raise HTTPException(status_code=401, detail=f"{expected_role}_session_invalid")

    try:
        payload = json.loads(_b64_decode(body).decode("utf-8"))
        expires_at = int(payload.get("exp") or 0)
    except (binascii.Error, TypeError, ValueError, UnicodeDecodeError) as exc:
        raise HTTPException(status_code=401, detail=f"{expected_role}_session_invalid") from exc

    if payload.get("role") != expected_role:
        raise HTTPException(status_code=403, detail="role_forbidden")
    if expires_at < int(time.time()):
        raise HTTPException(status_code=401, detail=f"{expected_role}_session_expired")
    subject_id = str(payload.get("sub") or "").strip()
    if not subject_id:
        raise HTTPException(status_code=401, detail=f"{expected_role}_session_invalid")
    return AuthPrincipal(role=expected_role, subject_id=subject_id, auth_type="session")


def _require_admin_auth(
    x_pomich_admin_token: str | None = None,
    authorization: str | None = None,
) -> AuthPrincipal:
    secret = _configured_admin_secret()
    bearer_token = _extract_bearer_token(authorization)
    if not bearer_token:
        raise HTTPException(status_code=401, detail="admin_session_required")
    return _verify_role_session(bearer_token, "admin", secret)


def _require_provider_auth(
    provider_id: str,
    x_pomich_provider_token: str | None = None,
    authorization: str | None = None,
) -> AuthPrincipal:
    secret = _configured_provider_secret()
    bearer_token = _extract_bearer_token(authorization)
    if not bearer_token:
        raise HTTPException(status_code=401, detail="provider_session_required")
    principal = _verify_role_session(bearer_token, "provider", secret)
    if principal.subject_id != str(provider_id):
        raise HTTPException(status_code=403, detail="provider_identity_mismatch")
    return principal


def _require_customer_auth(customer_id: str, authorization: str | None = None) -> AuthPrincipal:
    bearer_token = _extract_bearer_token(authorization)
    if not bearer_token:
        raise HTTPException(status_code=401, detail="customer_session_required")
    principal = _verify_role_session(bearer_token, "customer", _configured_customer_secret())
    if principal.subject_id != str(customer_id):
        raise HTTPException(status_code=403, detail="customer_identity_mismatch")
    return principal


def _optional_customer_auth(authorization: str | None = None) -> AuthPrincipal | None:
    bearer_token = _extract_bearer_token(authorization)
    if not bearer_token:
        return None
    return _verify_role_session(bearer_token, "customer", _configured_customer_secret())


def _require_customer_auth_from_bearer(authorization: str | None = None) -> AuthPrincipal:
    bearer_token = _extract_bearer_token(authorization)
    if not bearer_token:
        raise HTTPException(status_code=401, detail="customer_session_required")
    return _verify_role_session(bearer_token, "customer", _configured_customer_secret())


def _apply_verified_telegram_identity(payload: dict, verified_telegram: dict | None) -> None:
    user = (verified_telegram or {}).get("user") or {}
    telegram_user_id = str(user.get("id") or "").strip()
    if not telegram_user_id:
        return

    payload["telegramUserId"] = telegram_user_id
    payload["chatId"] = str(payload.get("chatId") or telegram_user_id)
    payload["customerId"] = str(payload.get("customerId") or f"tg-{telegram_user_id}")
    if user.get("username") and not payload.get("telegramUsername"):
        payload["telegramUsername"] = str(user.get("username"))
    payload["customerIdentity"] = {
        "type": "telegram",
        "telegramUserId": telegram_user_id,
        "username": user.get("username"),
        "firstName": user.get("first_name"),
        "lastName": user.get("last_name"),
    }


def _dispatch_conflict(exc: DispatchConflict) -> HTTPException:
    return HTTPException(status_code=409, detail={"code": exc.code, "message": exc.message})


def _build_admin_settings_payload() -> dict:
    cors_origins = _get_cors_origins()
    web_app_url = (os.getenv("WEB_APP_URL") or "").strip()
    runtime = os.getenv("POMICH_RUNTIME") or os.getenv("VITE_APP_ENV") or "dev"
    return {
        "runtime": runtime,
        "webAppUrl": web_app_url or None,
        "corsOrigins": cors_origins,
        "encryptionEnabled": encryption_enabled(),
        "databaseUrlConfigured": bool((os.getenv("DATABASE_URL") or "").strip()),
        "telegramConfigured": bool(get_configured_token()),
        "adminAccountsConfigured": bool(_load_account_configs("POMICH_ADMIN_ACCOUNTS")),
        "providerAccountsConfigured": bool(_load_account_configs("POMICH_PROVIDER_ACCOUNTS")),
        "allowHttpPilot": _allow_http_pilot(),
        "sessionTtlSeconds": _session_ttl_seconds(),
    }


@app.get("/admin/stats")
@app.get("/api/admin/stats")
def admin_stats(
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    _require_admin_auth(x_pomich_admin_token, authorization)
    stats = build_admin_stats()
    return {**stats, "activity": build_admin_activity_feed(12)}


@app.get("/admin/clients")
@app.get("/api/admin/clients")
def admin_list_clients(
    q: str | None = None,
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> list[dict]:
    _require_admin_auth(x_pomich_admin_token, authorization)
    clients = load_customer_profiles()
    if q:
        needle = q.strip().lower()
        clients = [
            client
            for client in clients
            if needle in str(client.get("id") or "").lower()
            or needle in str(client.get("name") or "").lower()
            or needle in str(client.get("phone") or "").lower()
            or needle in str(client.get("email") or "").lower()
            or needle in str(client.get("city") or "").lower()
        ]
    return sorted(clients, key=lambda item: str(item.get("updatedAt") or item.get("createdAt") or ""), reverse=True)


@app.get("/admin/providers")
@app.get("/api/admin/providers")
def admin_list_providers(
    q: str | None = None,
    kind: str | None = None,
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> list[dict]:
    _require_admin_auth(x_pomich_admin_token, authorization)
    providers = load_providers()
    if kind:
        normalized = kind.strip().lower()
        providers = [provider for provider in providers if str(provider.get("providerKind") or "dispatch").lower() == normalized]
    if q:
        needle = q.strip().lower()
        providers = [
            provider
            for provider in providers
            if needle in str(provider.get("id") or "").lower()
            or needle in str(provider.get("name") or "").lower()
            or needle in str(provider.get("phone") or "").lower()
            or needle in str(provider.get("city") or "").lower()
        ]
    return providers


@app.get("/admin/orders")
@app.get("/api/admin/orders")
def admin_list_orders(
    status: str | None = None,
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> list[dict]:
    _require_admin_auth(x_pomich_admin_token, authorization)
    orders = attach_dispatch_to_orders(load_orders(), load_offers())
    if status and status.strip().lower() not in {"", "all"}:
        normalized = status.strip().lower()
        orders = [order for order in orders if str(order.get("status") or "").lower() == normalized]
    return orders


@app.get("/admin/settings")
@app.get("/api/admin/settings")
def admin_settings(
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    _require_admin_auth(x_pomich_admin_token, authorization)
    return _build_admin_settings_payload()


@app.patch("/admin/clients/{customer_id}")
@app.patch("/api/admin/clients/{customer_id}")
def admin_patch_client(
    customer_id: str,
    payload: dict,
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    _require_admin_auth(x_pomich_admin_token, authorization)
    try:
        return admin_update_customer_profile(customer_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.patch("/admin/providers/{provider_id}")
@app.patch("/api/admin/providers/{provider_id}")
def admin_patch_provider(
    provider_id: str,
    payload: dict,
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    _require_admin_auth(x_pomich_admin_token, authorization)
    try:
        return admin_update_provider_profile(provider_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.delete("/admin/providers/{provider_id}")
@app.delete("/api/admin/providers/{provider_id}")
def admin_remove_provider(
    provider_id: str,
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    _require_admin_auth(x_pomich_admin_token, authorization)
    try:
        return admin_delete_provider(provider_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/orders")
@app.get("/api/orders")
def list_orders(x_pomich_admin_token: str | None = Header(default=None), authorization: str | None = Header(default=None)) -> list[dict]:
    _require_admin_auth(x_pomich_admin_token, authorization)
    return attach_dispatch_to_orders(load_orders(), load_offers())


@app.get("/providers")
@app.get("/api/providers")
def list_providers(kind: str | None = None) -> list[dict]:
    expire_offers()
    providers = load_providers()
    if kind:
        normalized = kind.strip().lower()
        providers = [provider for provider in providers if str(provider.get("providerKind") or "dispatch").lower() == normalized]
    return providers


@app.get("/map/providers")
@app.get("/api/map/providers")
def map_providers() -> list[dict]:
    """All providers for map display, including directory listings."""
    return load_providers()


@app.get("/map/orders/nearby")
@app.get("/api/map/orders/nearby")
def map_nearby_orders(
    lat: float,
    lng: float,
    radius_km: float = 20.0,
    service: str | None = None,
    x_pomich_provider_token: str | None = Header(default=None),
    authorization: str | None = None,
) -> list[dict]:
    """Searching orders near a provider location for map pins."""
    if authorization or x_pomich_provider_token:
        # Optional auth — endpoint is usable for provider map mode.
        pass
    return nearby_searching_orders(lat, lng, radius_km=radius_km, service=service)


@app.post("/admin/providers/import/uzhgorod")
@app.post("/api/admin/providers/import/uzhgorod")
def admin_import_uzhgorod_providers(
    payload: dict | None = None,
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    if authorization or x_pomich_admin_token:
        try:
            _require_admin_auth(x_pomich_admin_token, authorization)
        except HTTPException:
            secret = (os.getenv("POMICH_ADMIN_TOKEN") or "").strip()
            if not secret or x_pomich_admin_token != secret:
                raise
    else:
        raise HTTPException(status_code=401, detail="admin_session_required")
    options = payload or {}
    prefer_osm = bool(options.get("preferOsm", True))
    seed_only = bool(options.get("seedOnly", False))
    result = import_uzhgorod_providers(prefer_osm=prefer_osm and not seed_only, use_seed=seed_only)
    merge_result = merge_directory_providers(result["providers"])
    return {
        "source": result["source"],
        "counts": result["counts"],
        "merge": merge_result,
        "center": result["center"],
    }


@app.get("/customers/{customer_id}/profile")
@app.get("/api/customers/{customer_id}/profile")
def read_customer_profile(customer_id: str, authorization: str | None = Header(default=None)) -> dict:
    _require_customer_auth(customer_id, authorization)
    return get_customer_profile(customer_id)


@app.post("/customers/{customer_id}/profile")
@app.post("/api/customers/{customer_id}/profile")
@app.patch("/customers/{customer_id}/profile")
@app.patch("/api/customers/{customer_id}/profile")
def patch_customer_profile(customer_id: str, payload: dict, authorization: str | None = Header(default=None)) -> dict:
    _require_customer_auth(customer_id, authorization)
    profile = update_customer_profile(customer_id, payload)
    if payload.get("name") and payload.get("phone"):
        mark_user_role_registered(customer_id, "customer")
    return profile


@app.get("/users/{customer_id}/account")
@app.get("/api/users/{customer_id}/account")
def read_user_account(customer_id: str, authorization: str | None = Header(default=None), x_telegram_init_data: str | None = Header(default=None)) -> dict:
    principal = _optional_customer_auth(authorization)
    if principal is not None and principal.subject_id != str(customer_id):
        raise HTTPException(status_code=403, detail="customer_identity_mismatch")
    if principal is None:
        verified = _verify_init_data_or_raise(x_telegram_init_data)
        if verified is None:
            raise HTTPException(status_code=401, detail="customer_session_required")
        user = verified.get("user") or {}
        telegram_user_id = str(user.get("id") or "").strip()
        if str(customer_id) != f"tg-{telegram_user_id}":
            raise HTTPException(status_code=403, detail="customer_identity_mismatch")
    return build_user_account_status(customer_id)


@app.patch("/users/{customer_id}/account/role")
@app.patch("/api/users/{customer_id}/account/role")
def patch_user_preferred_role(customer_id: str, payload: dict, authorization: str | None = Header(default=None)) -> dict:
    _require_customer_auth(customer_id, authorization)
    role = str(payload.get("role") or payload.get("preferredRole") or "").strip()
    try:
        return set_user_preferred_role(customer_id, role)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/users/{customer_id}/account/role")
@app.post("/api/users/{customer_id}/account/role")
def post_user_preferred_role(customer_id: str, payload: dict, authorization: str | None = Header(default=None)) -> dict:
    return patch_user_preferred_role(customer_id, payload, authorization)


@app.post("/customers/{customer_id}/verification/submit")
@app.post("/api/customers/{customer_id}/verification/submit")
def customer_submit_verification(customer_id: str, payload: dict, authorization: str | None = Header(default=None)) -> dict:
    _require_customer_auth(customer_id, authorization)
    return submit_customer_verification(customer_id, payload)


@app.patch("/customers/{customer_id}/verification/review")
@app.patch("/api/customers/{customer_id}/verification/review")
def customer_review_verification(
    customer_id: str,
    payload: dict,
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    _require_admin_auth(x_pomich_admin_token, authorization)
    try:
        return review_customer_verification(customer_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/auth/admin/session")
@app.post("/api/auth/admin/session")
def create_admin_session(x_pomich_admin_token: str | None = Header(default=None)) -> dict:
    secret = _configured_admin_secret()
    if x_pomich_admin_token != secret:
        raise HTTPException(status_code=401, detail="admin_token_invalid")
    return _issue_role_session("admin", "admin", secret)


@app.post("/auth/admin/login")
@app.post("/api/auth/admin/login")
def create_admin_account_session(payload: dict) -> dict:
    account = _find_admin_account(str(payload.get("username") or ""), str(payload.get("password") or ""))
    if account is None:
        raise HTTPException(status_code=401, detail="admin_credentials_invalid")
    subject_id = str(account.get("id") or account.get("username") or "admin").strip()
    session = _issue_role_session("admin", subject_id, _configured_admin_secret())
    session["username"] = str(account.get("username") or subject_id)
    return session


@app.post("/auth/provider/session")
@app.post("/api/auth/provider/session")
def create_provider_session(payload: dict, x_pomich_provider_token: str | None = Header(default=None)) -> dict:
    secret = _configured_provider_secret()
    if x_pomich_provider_token != secret:
        raise HTTPException(status_code=401, detail="provider_token_invalid")
    provider_id = str(payload.get("providerId") or "").strip()
    if not provider_id:
        raise HTTPException(status_code=400, detail="providerId missing")
    session = _issue_role_session("provider", provider_id, secret)
    session["providerId"] = provider_id
    return session


@app.post("/auth/provider/self/session")
@app.post("/api/auth/provider/self/session")
def create_self_provider_session(payload: dict, authorization: str | None = Header(default=None)) -> dict:
    from bot.order_store import resolve_linked_provider_id

    customer_id = str(payload.get("customerId") or "").strip()
    if not customer_id:
        raise HTTPException(status_code=400, detail="customerId missing")
    _require_customer_auth(customer_id, authorization)
    provider_id = resolve_linked_provider_id(customer_id)
    if not provider_id:
        raise HTTPException(status_code=400, detail="provider_not_linked")
    session = _issue_role_session("provider", provider_id, _configured_provider_secret())
    session["providerId"] = provider_id
    return session


@app.post("/auth/provider/login")
@app.post("/api/auth/provider/login")
def create_provider_account_session(payload: dict) -> dict:
    provider_id = str(payload.get("providerId") or "").strip()
    login = str(payload.get("login") or payload.get("username") or provider_id).strip()
    account = _find_provider_account(login, str(payload.get("password") or ""), provider_id)
    if account is None or not account.get("providerId"):
        raise HTTPException(status_code=401, detail="provider_credentials_invalid")
    session = _issue_role_session("provider", str(account["providerId"]), _configured_provider_secret())
    session["providerId"] = str(account["providerId"])
    session["username"] = str(account.get("username") or login)
    return session


@app.post("/auth/customer/guest/session")
@app.post("/api/auth/customer/guest/session")
def create_guest_customer_session(payload: dict | None = None) -> dict:
    requested_customer_id = str((payload or {}).get("customerId") or "").strip()
    if requested_customer_id and not (requested_customer_id == "customer-web" or requested_customer_id.startswith("guest-")):
        raise HTTPException(status_code=400, detail="guest_customer_id_invalid")
    customer_id = requested_customer_id or f"guest-{uuid.uuid4().hex}"
    profile = update_customer_profile(customer_id, payload or {})
    session = _issue_role_session("customer", customer_id, _configured_customer_secret())
    session["customerId"] = customer_id
    session["profile"] = profile
    session["account"] = build_user_account_status(customer_id)
    return session


@app.post("/auth/customer/telegram/session")
@app.post("/api/auth/customer/telegram/session")
def create_telegram_customer_session(payload: dict | None = None, x_telegram_init_data: str | None = Header(default=None)) -> dict:
    # Unified TG + Web identity: Telegram initData -> customerId tg-{user_id} in shared DB.
    # Web Mini App auto-login; bot /start reads the same profile via get_customer_profile.
    init_data = x_telegram_init_data or str((payload or {}).get("initData") or "").strip()
    verified = _verify_init_data_or_raise(init_data)
    if verified is None:
        raise HTTPException(status_code=403, detail="telegram_auth_not_configured")
    user = verified.get("user") or {}
    telegram_user_id = str(user.get("id") or "").strip()
    if not telegram_user_id:
        raise HTTPException(status_code=401, detail="telegram_user_missing")
    profile = upsert_telegram_customer_profile(user)
    customer_id = str(profile.get("id") or f"tg-{telegram_user_id}")
    session = _issue_role_session("customer", customer_id, _configured_customer_secret())
    session["customerId"] = customer_id
    session["profile"] = profile
    session["customerIdentity"] = profile.get("customerIdentity")
    session["account"] = build_user_account_status(customer_id)
    return session


@app.post("/auth/customer/verify/send")
@app.post("/api/auth/customer/verify/send")
def customer_verify_send(payload: dict, authorization: str | None = Header(default=None)) -> dict:
    principal = _require_customer_auth_from_bearer(authorization)
    channel = str(payload.get("channel") or "").strip().lower()
    try:
        return send_customer_verification_code(
            principal.subject_id,
            channel,
            phone=payload.get("phone"),
            email=payload.get("email"),
        )
    except OtpVerificationError as exc:
        status_code = 429 if exc.code == "rate_limit_exceeded" else 400
        raise HTTPException(status_code=status_code, detail=exc.code) from exc


@app.post("/auth/customer/verify/confirm")
@app.post("/api/auth/customer/verify/confirm")
def customer_verify_confirm(payload: dict, authorization: str | None = Header(default=None)) -> dict:
    principal = _require_customer_auth_from_bearer(authorization)
    code = str(payload.get("code") or "").strip()
    try:
        profile = confirm_customer_verification_code(principal.subject_id, code)
        return {"ok": True, "profile": profile}
    except OtpVerificationError as exc:
        status_code = 400
        raise HTTPException(status_code=status_code, detail=exc.code) from exc


@app.get("/providers/{provider_id}/profile")
@app.get("/api/providers/{provider_id}/profile")
def read_provider_profile(
    provider_id: str,
    x_pomich_provider_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    _require_provider_auth(provider_id, x_pomich_provider_token, authorization)
    provider = get_provider_profile(provider_id)
    if provider is None:
        raise HTTPException(status_code=404, detail="provider profile not found")
    return provider


@app.patch("/providers/{provider_id}/presence")
@app.patch("/api/providers/{provider_id}/presence")
def patch_provider_presence(
    provider_id: str,
    payload: dict,
    x_pomich_provider_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    _require_provider_auth(provider_id, x_pomich_provider_token, authorization)
    status = str(payload.get("status") or "").strip()
    if status not in {"online", "busy", "offline"}:
        raise HTTPException(status_code=400, detail="provider status must be online, busy or offline")
    try:
        return update_provider_presence(provider_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/providers/{provider_id}/profile")
@app.post("/api/providers/{provider_id}/profile")
@app.patch("/providers/{provider_id}/profile")
@app.patch("/api/providers/{provider_id}/profile")
def patch_provider_profile(
    provider_id: str,
    payload: dict,
    x_pomich_provider_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    _require_provider_auth(provider_id, x_pomich_provider_token, authorization)
    try:
        return update_provider_profile(provider_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/providers/{provider_id}/verification/submit")
@app.post("/api/providers/{provider_id}/verification/submit")
def provider_submit_verification(
    provider_id: str,
    payload: dict,
    x_pomich_provider_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    _require_provider_auth(provider_id, x_pomich_provider_token, authorization)
    try:
        return submit_provider_verification(provider_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.patch("/providers/{provider_id}/verification/review")
@app.patch("/api/providers/{provider_id}/verification/review")
def provider_review_verification(
    provider_id: str,
    payload: dict,
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    _require_admin_auth(x_pomich_admin_token, authorization)
    try:
        return review_provider_verification(provider_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/orders", status_code=201)
@app.post("/api/orders", status_code=201)
def create_order(payload: dict, authorization: str | None = Header(default=None)) -> dict:
    source = payload.get("source")
    init_data = payload.pop("telegramInitData", None)
    customer_principal = _optional_customer_auth(authorization)
    if customer_principal is not None:
        supplied_customer_id = payload.get("customerId")
        if supplied_customer_id is not None and str(supplied_customer_id) != customer_principal.subject_id:
            raise HTTPException(status_code=403, detail="customer_identity_mismatch")
        payload["customerId"] = customer_principal.subject_id

    verified_telegram = None
    if source == "telegram-mini-app":
        verified_telegram = _verify_init_data_or_raise(init_data)
        user = (verified_telegram or {}).get("user") or {}
        supplied_telegram_id = payload.get("telegramUserId") or payload.get("chatId")
        if user.get("id") and supplied_telegram_id is not None and str(supplied_telegram_id) != str(user.get("id")):
            raise HTTPException(status_code=401, detail="telegram_user_mismatch")
        _apply_verified_telegram_identity(payload, verified_telegram)
        if customer_principal is not None and payload.get("customerId") != customer_principal.subject_id:
            raise HTTPException(status_code=403, detail="customer_identity_mismatch")
    elif customer_principal is not None:
        payload["customerIdentity"] = {"type": "guest", "customerId": customer_principal.subject_id}

    order = save_order(payload)
    if order.get("status") == "searching":
        dispatched = dispatch_order(str(order.get("id")))
        if dispatched is not None:
            order = dispatched

    if payload.get("notify") and payload.get("chatId"):
        notify_order_created(str(payload.get("chatId")), order)

    return order


@app.get("/orders/{order_id}")
@app.get("/api/orders/{order_id}")
def read_order(order_id: str) -> dict:
    expire_offers()
    order = get_order(order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="order not found")
    return attach_dispatch_to_order(order, load_offers())


@app.post("/orders/{order_id}/dispatch/retry")
@app.post("/api/orders/{order_id}/dispatch/retry")
def retry_order_dispatch(order_id: str) -> dict:
    order = dispatch_order(order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="order not found")
    return order


@app.get("/providers/{provider_id}/offers")
@app.get("/api/providers/{provider_id}/offers")
def provider_offers(
    provider_id: str,
    x_pomich_provider_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> list[dict]:
    _require_provider_auth(provider_id, x_pomich_provider_token, authorization)
    return get_provider_offers(provider_id)


@app.post("/providers/{provider_id}/offers/{offer_id}/accept")
@app.post("/api/providers/{provider_id}/offers/{offer_id}/accept")
def provider_accept_offer(
    provider_id: str,
    offer_id: str,
    x_pomich_provider_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    _require_provider_auth(provider_id, x_pomich_provider_token, authorization)
    try:
        return accept_offer(offer_id, provider_id)
    except DispatchConflict as exc:
        raise _dispatch_conflict(exc) from exc


@app.post("/offers/{offer_id}/accept")
@app.post("/api/offers/{offer_id}/accept")
def accept_offer_legacy(
    offer_id: str,
    payload: dict,
    x_pomich_provider_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    provider_id = str(payload.get("providerId") or "").strip()
    if not provider_id:
        raise HTTPException(status_code=400, detail="providerId missing")
    _require_provider_auth(provider_id, x_pomich_provider_token, authorization)
    try:
        return accept_offer(offer_id, provider_id)
    except DispatchConflict as exc:
        raise _dispatch_conflict(exc) from exc


@app.post("/providers/{provider_id}/offers/{offer_id}/decline")
@app.post("/api/providers/{provider_id}/offers/{offer_id}/decline")
def provider_decline_offer(
    provider_id: str,
    offer_id: str,
    x_pomich_provider_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    _require_provider_auth(provider_id, x_pomich_provider_token, authorization)
    try:
        return decline_offer(offer_id, provider_id)
    except DispatchConflict as exc:
        raise _dispatch_conflict(exc) from exc


@app.post("/offers/{offer_id}/decline")
@app.post("/api/offers/{offer_id}/decline")
def decline_offer_legacy(
    offer_id: str,
    payload: dict,
    x_pomich_provider_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    provider_id = str(payload.get("providerId") or "").strip()
    if not provider_id:
        raise HTTPException(status_code=400, detail="providerId missing")
    _require_provider_auth(provider_id, x_pomich_provider_token, authorization)
    try:
        return decline_offer(offer_id, provider_id)
    except DispatchConflict as exc:
        raise _dispatch_conflict(exc) from exc


@app.patch("/providers/{provider_id}/orders/{order_id}/status")
@app.patch("/api/providers/{provider_id}/orders/{order_id}/status")
def provider_patch_order_status(
    provider_id: str,
    order_id: str,
    payload: dict,
    x_pomich_provider_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    _require_provider_auth(provider_id, x_pomich_provider_token, authorization)
    status = str(payload.get("status") or "").strip()
    if not status:
        raise HTTPException(status_code=400, detail="status missing")
    try:
        return update_provider_order_status(provider_id, order_id, status)
    except (DispatchConflict, InvalidStatusTransition, ValueError) as exc:
        if isinstance(exc, DispatchConflict):
            raise _dispatch_conflict(exc) from exc
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/orders/{order_id}/cancel")
@app.post("/api/orders/{order_id}/cancel")
def cancel_order(order_id: str) -> dict:
    try:
        order = update_order_status(order_id, "cancelled")
    except (InvalidStatusTransition, ValueError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if order is None:
        raise HTTPException(status_code=404, detail="order not found")
    return attach_dispatch_to_order(order, load_offers())


@app.patch("/orders/{order_id}/status")
@app.patch("/api/orders/{order_id}/status")
def patch_order_status(
    order_id: str,
    payload: dict,
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    _require_admin_auth(x_pomich_admin_token, authorization)
    status = str(payload.get("status") or "").strip()
    if not status:
        raise HTTPException(status_code=400, detail="status missing")

    try:
        order = update_order_status(order_id, status)
    except (InvalidStatusTransition, ValueError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if order is None:
        raise HTTPException(status_code=404, detail="order not found")
    return attach_dispatch_to_order(order, load_offers())


@app.get("/telegram/session/{chat_id}")
@app.get("/api/telegram/session/{chat_id}")
def telegram_session(chat_id: str, x_telegram_init_data: str | None = Header(default=None)) -> dict:
    verified = _verify_init_data_or_raise(x_telegram_init_data)
    user = (verified or {}).get("user") or {}
    if user.get("id") and str(user.get("id")) != str(chat_id):
        raise HTTPException(status_code=401, detail="telegram_user_mismatch")

    session = get_telegram_session(chat_id) or {"chatId": chat_id}
    if user.get("id"):
        profile = upsert_telegram_customer_profile(user)
        return {
            **session,
            "chatId": chat_id,
            "customerId": profile.get("id"),
            "profile": profile,
            "customerIdentity": profile.get("customerIdentity"),
        }
    return session


@app.post("/telegram/webhook")
@app.post("/api/telegram/webhook")
def telegram_webhook(payload: dict) -> dict:
    result = handle_update(payload)

    if not result.get("handled"):
        raise HTTPException(status_code=400, detail="chat_id missing")

    return {"ok": True, "result": result}


if ASSETS_DIR.exists():
    app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")


@app.get("/robots.txt")
def robots_txt():
    robots_path = DIST_DIR / "robots.txt"
    if robots_path.exists():
        return FileResponse(robots_path, media_type="text/plain")
    return {"detail": "robots.txt not built"}


@app.get("/")
@app.get("/{full_path:path}")
def serve_frontend(full_path: str = ""):
    index_path = DIST_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return {"detail": "Frontend build is missing. Run npm run build first."}
