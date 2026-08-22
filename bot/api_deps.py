"""Shared FastAPI helpers: auth, runtime config, and small HTTP utilities."""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import ipaddress
import json
import os
import time
import urllib.parse
from dataclasses import dataclass

from fastapi import HTTPException

from bot.field_encryption import encryption_enabled
from bot.order_store import DispatchConflict
from bot.otp_verification import OtpVerificationError
from bot.runtime_store import sql_storage_enabled
from bot.telegram_auth import verify_telegram_init_data, verify_telegram_init_data_any_bot
from bot.telegram_config import (
    any_telegram_bot_configured,
    get_base_web_app_url,
    get_configured_token,
    get_telegram_bot_configs,
    normalize_telegram_bot_kind,
)

_PLACEHOLDER_SECRET_FRAGMENTS = ("replace-me", "change-this", "changeme", "example", "placeholder")
_AUTH_SESSION_PREFIX = "pomich_auth_v1"
_DEFAULT_SESSION_TTL_SECONDS = 86400


@dataclass(frozen=True)
class AuthPrincipal:
    role: str
    subject_id: str
    auth_type: str


def is_production_runtime() -> bool:
    runtime = os.getenv("POMICH_RUNTIME") or os.getenv("VITE_APP_ENV") or "dev"
    return runtime.strip().lower() in {"prod", "production"}


def _is_public_https_origin(origin: str) -> bool:
    normalized = origin.strip().lower()
    if not normalized.startswith("https://"):
        return False
    return not any(host in normalized for host in ("localhost", "127.0.0.1", "0.0.0.0", "::1", "*"))


def allow_http_pilot() -> bool:
    return os.getenv("POMICH_ALLOW_HTTP_PILOT", "").strip().lower() in {"1", "true", "yes", "on"}


def bootstrap_auth_sessions_enabled() -> bool:
    """Legacy shared-token session issuance is a local/dev convenience only."""
    return not is_production_runtime()


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


def is_allowed_public_origin(origin: str) -> bool:
    return _is_public_https_origin(origin) or (allow_http_pilot() and _is_public_http_pilot_origin(origin))


def is_configured_secret(value: str | None, *, min_length: int = 24) -> bool:
    normalized = (value or "").strip()
    if len(normalized) < min_length:
        return False
    return not any(fragment in normalized.lower() for fragment in _PLACEHOLDER_SECRET_FRAGMENTS)


def get_cors_origins() -> list[str]:
    raw_origins = os.getenv("POMICH_CORS_ORIGINS", "*")
    origins = [origin.strip() for origin in raw_origins.split(",") if origin.strip()]
    return origins or ["*"]


def _database_url_is_postgres(url: str) -> bool:
    normalized = url.strip().lower()
    return normalized.startswith(("postgres://", "postgresql://", "postgresql+psycopg://"))


def runtime_config_errors() -> list[str]:
    if not is_production_runtime():
        return []

    errors: list[str] = []
    cors_origins = get_cors_origins()

    if "*" in cors_origins:
        errors.append("POMICH_CORS_ORIGINS must use exact HTTPS origins in production")
    else:
        invalid_origins = [origin for origin in cors_origins if not is_allowed_public_origin(origin)]
        if invalid_origins:
            errors.append("POMICH_CORS_ORIGINS contains non-public or non-HTTPS origins")

    if not is_configured_secret(os.getenv("POMICH_ADMIN_TOKEN")):
        errors.append("POMICH_ADMIN_TOKEN must be a non-placeholder secret in production")

    if not is_configured_secret(os.getenv("POMICH_PROVIDER_TOKEN")):
        errors.append("POMICH_PROVIDER_TOKEN must be set in production so partner endpoints are protected")

    if not is_configured_secret(os.getenv("POMICH_CUSTOMER_SESSION_SECRET")):
        errors.append("POMICH_CUSTOMER_SESSION_SECRET must be a non-placeholder secret in production")

    if not load_account_configs("POMICH_ADMIN_ACCOUNTS"):
        errors.append("POMICH_ADMIN_ACCOUNTS must be configured in production; bootstrap admin sessions are disabled")

    if not load_account_configs("POMICH_PROVIDER_ACCOUNTS"):
        errors.append("POMICH_PROVIDER_ACCOUNTS must be configured in production; bootstrap provider sessions are disabled")

    database_url = (os.getenv("DATABASE_URL") or "").strip()
    allow_json = os.getenv("POMICH_ALLOW_JSON_STORE_IN_PRODUCTION") == "true"
    storage_backend = (os.getenv("POMICH_STORAGE_BACKEND") or "").strip().lower()

    if not database_url and not allow_json:
        errors.append(
            "DATABASE_URL must be set in production, unless POMICH_ALLOW_JSON_STORE_IN_PRODUCTION=true "
            "is explicitly used for a small pilot"
        )
    elif database_url and not allow_json:
        if not _database_url_is_postgres(database_url):
            errors.append("DATABASE_URL must be a PostgreSQL/PostGIS URL in production (postgres:// or postgresql://)")
        if storage_backend in {"json", "file", "files"}:
            errors.append(
                "POMICH_STORAGE_BACKEND=json is not allowed in production; use sql/postgres "
                "(JSON file store is local/dev fallback only)"
            )
        elif not sql_storage_enabled():
            errors.append("SQL/PostGIS runtime store must be enabled in production when DATABASE_URL is set")

    web_app_url = (os.getenv("WEB_APP_URL") or get_base_web_app_url() or "").strip()
    telegram_configured = any_telegram_bot_configured()
    if telegram_configured and not web_app_url:
        # Dedicated per-bot Web App URLs may substitute for WEB_APP_URL.
        missing_dedicated = any(not config.web_app_url for config in get_telegram_bot_configs())
        if missing_dedicated:
            errors.append("WEB_APP_URL or per-bot TELEGRAM_*_WEB_APP_URL must be set when Telegram is configured in production")
    elif web_app_url and telegram_configured and not is_allowed_public_origin(web_app_url):
        # Allow when every configured bot has its own public HTTPS Web App URL.
        invalid_bots = [
            config.kind
            for config in get_telegram_bot_configs()
            if not config.web_app_url or not is_allowed_public_origin(config.web_app_url)
        ]
        if invalid_bots and not is_allowed_public_origin(web_app_url):
            errors.append("WEB_APP_URL must be a public HTTPS URL when Telegram is configured in production")

    return errors


def validate_runtime_config() -> None:
    errors = runtime_config_errors()
    if errors:
        raise RuntimeError(f"Invalid POMICH production configuration: {'; '.join(errors)}")


def verify_init_data_or_raise(
    init_data: str | None,
    hinted_bot_kind: str | None = None,
) -> dict | None:
    if not any_telegram_bot_configured() and not get_configured_token():
        return None

    if not init_data:
        raise HTTPException(status_code=401, detail="telegram_init_data_missing")

    try:
        return verify_telegram_init_data_any_bot(init_data, hinted_bot_kind)
    except ValueError as exc:
        # Legacy single-token path still works via get_telegram_bot_configs fallback.
        token = get_configured_token()
        if token and normalize_telegram_bot_kind(hinted_bot_kind) is None:
            try:
                verified = verify_telegram_init_data(init_data, token)
                return {"botKind": "customer", "user": verified.get("user"), "raw": verified.get("raw")}
            except ValueError:
                pass
        raise HTTPException(status_code=401, detail=str(exc)) from exc


def b64_encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def b64_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(f"{value}{padding}".encode("ascii"))


def configured_admin_secret() -> str:
    secret = (os.getenv("POMICH_ADMIN_TOKEN") or "").strip()
    if not secret:
        raise HTTPException(status_code=403, detail="admin_auth_not_configured")
    return secret


def configured_provider_secret() -> str:
    secret = (os.getenv("POMICH_PROVIDER_TOKEN") or "").strip()
    if not secret:
        raise HTTPException(status_code=403, detail="provider_auth_not_configured")
    return secret


def configured_customer_secret() -> str:
    secret = (os.getenv("POMICH_CUSTOMER_SESSION_SECRET") or "").strip()
    if secret:
        return secret
    if is_production_runtime():
        raise HTTPException(status_code=403, detail="customer_auth_not_configured")
    return "dev-customer-session-secret"


def load_account_configs(env_name: str) -> list[dict]:
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


def password_matches(account: dict, password: str) -> bool:
    supplied = str(password or "")
    expected_hash = str(account.get("passwordHash") or "").strip()
    if expected_hash.startswith("sha256:"):
        digest = hashlib.sha256(supplied.encode("utf-8")).hexdigest()
        return hmac.compare_digest(expected_hash.removeprefix("sha256:"), digest)
    expected_password = str(account.get("password") or "").strip()
    return bool(expected_password) and hmac.compare_digest(expected_password, supplied)


def find_admin_account(username: str, password: str) -> dict | None:
    normalized_username = str(username or "").strip().lower()
    if not normalized_username or not password:
        return None
    for account in load_account_configs("POMICH_ADMIN_ACCOUNTS"):
        identifiers = [
            str(account.get("username") or "").strip().lower(),
            str(account.get("email") or "").strip().lower(),
            str(account.get("id") or "").strip().lower(),
        ]
        if normalized_username in identifiers and password_matches(account, password):
            return account
    return None


def find_provider_account(login: str, password: str, provider_id: str | None = None) -> dict | None:
    normalized_login = str(login or provider_id or "").strip().lower()
    normalized_provider_id = str(provider_id or "").strip()
    if not normalized_login or not password:
        return None
    for account in load_account_configs("POMICH_PROVIDER_ACCOUNTS"):
        account_provider_id = str(account.get("providerId") or account.get("id") or "").strip()
        identifiers = [
            account_provider_id.lower(),
            str(account.get("username") or "").strip().lower(),
            str(account.get("email") or "").strip().lower(),
            str(account.get("phone") or "").strip().lower(),
        ]
        if normalized_provider_id and account_provider_id != normalized_provider_id:
            continue
        if normalized_login in identifiers and password_matches(account, password):
            return {**account, "providerId": account_provider_id}
    return None


def extract_bearer_token(authorization: str | None) -> str | None:
    value = (authorization or "").strip()
    if not value:
        return None
    scheme, _, token = value.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=401, detail="bearer_token_invalid")
    return token.strip()


def session_ttl_seconds() -> int:
    raw_value = (os.getenv("POMICH_AUTH_SESSION_TTL_SECONDS") or "").strip()
    if not raw_value:
        return _DEFAULT_SESSION_TTL_SECONDS
    try:
        return max(300, int(raw_value))
    except ValueError:
        return _DEFAULT_SESSION_TTL_SECONDS


def issue_role_session(role: str, subject_id: str, secret: str) -> dict:
    issued_at = int(time.time())
    expires_at = issued_at + session_ttl_seconds()
    payload = {
        "role": role,
        "sub": str(subject_id),
        "iat": issued_at,
        "exp": expires_at,
    }
    body = b64_encode(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8"))
    signature = b64_encode(hmac.new(secret.encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest())
    return {
        "role": role,
        "subjectId": str(subject_id),
        "tokenType": "Bearer",
        "accessToken": f"{_AUTH_SESSION_PREFIX}.{body}.{signature}",
        "expiresAt": expires_at,
    }


def verify_role_session(token: str, expected_role: str, secret: str) -> AuthPrincipal:
    parts = token.split(".")
    if len(parts) != 3 or parts[0] != _AUTH_SESSION_PREFIX:
        raise HTTPException(status_code=401, detail=f"{expected_role}_session_invalid")

    _, body, signature = parts
    expected_signature = b64_encode(hmac.new(secret.encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest())
    if not hmac.compare_digest(signature, expected_signature):
        raise HTTPException(status_code=401, detail=f"{expected_role}_session_invalid")

    try:
        payload = json.loads(b64_decode(body).decode("utf-8"))
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


def require_admin_auth(
    x_pomich_admin_token: str | None = None,
    authorization: str | None = None,
) -> AuthPrincipal:
    secret = configured_admin_secret()
    bearer_token = extract_bearer_token(authorization)
    if not bearer_token:
        raise HTTPException(status_code=401, detail="admin_session_required")
    return verify_role_session(bearer_token, "admin", secret)


def require_provider_auth(
    provider_id: str,
    x_pomich_provider_token: str | None = None,
    authorization: str | None = None,
) -> AuthPrincipal:
    secret = configured_provider_secret()
    bearer_token = extract_bearer_token(authorization)
    if not bearer_token:
        raise HTTPException(status_code=401, detail="provider_session_required")
    principal = verify_role_session(bearer_token, "provider", secret)
    if principal.subject_id != str(provider_id):
        raise HTTPException(status_code=403, detail="provider_identity_mismatch")
    return principal


def require_customer_auth(customer_id: str, authorization: str | None = None) -> AuthPrincipal:
    bearer_token = extract_bearer_token(authorization)
    if not bearer_token:
        raise HTTPException(status_code=401, detail="customer_session_required")
    principal = verify_role_session(bearer_token, "customer", configured_customer_secret())
    if principal.subject_id != str(customer_id):
        raise HTTPException(status_code=403, detail="customer_identity_mismatch")
    return principal


def require_customer_auth_linked(customer_id: str, authorization: str | None = None) -> AuthPrincipal:
    """Allow URL customer_id that phone-links to the authenticated session (cabinet/history)."""
    principal = require_customer_auth_from_bearer(authorization)
    requested = str(customer_id or "").strip()
    if principal.subject_id == requested:
        return principal
    from bot.order_store import _customer_ids_for_order_history

    aliases = _customer_ids_for_order_history(principal.subject_id)
    if requested not in aliases:
        raise HTTPException(status_code=403, detail="customer_identity_mismatch")
    return principal


def optional_customer_auth(authorization: str | None = None) -> AuthPrincipal | None:
    bearer_token = extract_bearer_token(authorization)
    if not bearer_token:
        return None
    return verify_role_session(bearer_token, "customer", configured_customer_secret())


def require_customer_auth_from_bearer(authorization: str | None = None) -> AuthPrincipal:
    bearer_token = extract_bearer_token(authorization)
    if not bearer_token:
        raise HTTPException(status_code=401, detail="customer_session_required")
    return verify_role_session(bearer_token, "customer", configured_customer_secret())


def _session_role_hint(token: str) -> str | None:
    """Unsigned role peek used only to route verification to the correct secret."""
    parts = token.split(".")
    if len(parts) != 3 or parts[0] != _AUTH_SESSION_PREFIX:
        return None
    try:
        payload = json.loads(b64_decode(parts[1]).decode("utf-8"))
    except (binascii.Error, TypeError, ValueError, UnicodeDecodeError):
        return None
    role = str(payload.get("role") or "").strip()
    return role or None


def order_customer_id(order: dict | None) -> str:
    if not isinstance(order, dict):
        return ""
    customer_id = str(order.get("customerId") or order.get("customer_id") or "").strip()
    if customer_id:
        return customer_id
    identity = order.get("customerIdentity") if isinstance(order.get("customerIdentity"), dict) else {}
    return str(identity.get("customerId") or "").strip()


def require_order_customer_owner(order: dict, authorization: str | None = None) -> AuthPrincipal:
    principal = require_customer_auth_from_bearer(authorization)
    customer_id = order_customer_id(order)
    if customer_id and principal.subject_id == customer_id:
        return principal
    try:
        from bot.order_store import _customer_ids_for_order_history, _order_belongs_to_customer

        aliases = _customer_ids_for_order_history(principal.subject_id)
        if any(_order_belongs_to_customer(order, alias) for alias in aliases):
            return principal
    except Exception:
        pass
    raise HTTPException(status_code=403, detail="customer_identity_mismatch")


def require_order_owner_or_admin(
    order: dict,
    authorization: str | None = None,
    x_pomich_admin_token: str | None = None,
) -> AuthPrincipal:
    bearer_token = extract_bearer_token(authorization)
    if not bearer_token:
        raise HTTPException(status_code=401, detail="auth_session_required")

    role = _session_role_hint(bearer_token)
    if role == "admin":
        return require_admin_auth(x_pomich_admin_token, authorization)
    if role == "customer":
        return require_order_customer_owner(order, authorization)
    raise HTTPException(status_code=401, detail="auth_session_required")


def order_assigned_provider_id(order: dict | None) -> str:
    if not isinstance(order, dict):
        return ""
    return str(order.get("assignedProviderId") or order.get("partnerId") or "").strip()


def require_any_provider_auth(
    authorization: str | None = None,
    x_pomich_provider_token: str | None = None,
) -> AuthPrincipal:
    """Any valid provider session (not tied to a path provider_id)."""
    secret = configured_provider_secret()
    bearer_token = extract_bearer_token(authorization)
    if not bearer_token:
        raise HTTPException(status_code=401, detail="provider_session_required")
    return verify_role_session(bearer_token, "provider", secret)


def require_order_participant_auth(
    order: dict,
    authorization: str | None = None,
    *,
    access_token: str | None = None,
    x_pomich_admin_token: str | None = None,
) -> AuthPrincipal:
    """Customer owner, assigned partner, or admin may read an order / its realtime channel."""
    auth_header = authorization
    if not auth_header and access_token:
        auth_header = f"Bearer {str(access_token).strip()}"

    bearer_token = extract_bearer_token(auth_header)
    if not bearer_token:
        raise HTTPException(status_code=401, detail="auth_session_required")

    role = _session_role_hint(bearer_token)
    if role == "admin":
        return require_admin_auth(x_pomich_admin_token, auth_header)
    if role == "customer":
        principal = require_customer_auth_from_bearer(auth_header)
        customer_id = order_customer_id(order)
        if customer_id and principal.subject_id == customer_id:
            return principal
        try:
            from bot.order_store import _customer_ids_for_order_history, _order_belongs_to_customer

            aliases = _customer_ids_for_order_history(principal.subject_id)
            if any(_order_belongs_to_customer(order, alias) for alias in aliases):
                return principal
        except Exception:
            pass
        raise HTTPException(status_code=403, detail="customer_identity_mismatch")
    if role == "provider":
        principal = verify_role_session(bearer_token, "provider", configured_provider_secret())
        assigned = order_assigned_provider_id(order)
        if assigned and principal.subject_id == assigned:
            return principal
        raise HTTPException(status_code=403, detail="provider_identity_mismatch")
    raise HTTPException(status_code=401, detail="auth_session_required")


def require_telegram_webhook_secret(
    x_telegram_bot_api_secret_token: str | None,
    *,
    bot_kind: str | None = None,
) -> None:
    """Reject forged Telegram updates when a webhook secret is configured.

    Production: secret is mandatory whenever Telegram bots are configured, so open
    webhook URLs cannot be used to inject /start or fake commands.
    """
    kind = normalize_telegram_bot_kind(bot_kind) or ""
    expected = (
        (os.getenv(f"TELEGRAM_{kind.upper()}_WEBHOOK_SECRET") or "").strip()
        if kind
        else ""
    ) or (os.getenv("TELEGRAM_WEBHOOK_SECRET") or "").strip()

    if not expected:
        if is_production_runtime() and any_telegram_bot_configured():
            raise HTTPException(status_code=503, detail="telegram_webhook_secret_not_configured")
        return

    supplied = (x_telegram_bot_api_secret_token or "").strip()
    if not supplied or not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="telegram_webhook_secret_invalid")


def apply_verified_telegram_identity(payload: dict, verified_telegram: dict | None) -> None:
    user = (verified_telegram or {}).get("user") or {}
    telegram_user_id = str(user.get("id") or "").strip()
    if not telegram_user_id:
        return

    canonical_customer_id = f"tg-{telegram_user_id}"
    payload["telegramUserId"] = telegram_user_id
    payload["chatId"] = str(payload.get("chatId") or telegram_user_id)
    # Always bind Mini App creates to the Telegram canonical id (not a prior guest id).
    payload["customerId"] = canonical_customer_id
    if user.get("username") and not payload.get("telegramUsername"):
        payload["telegramUsername"] = str(user.get("username"))
    payload["customerIdentity"] = {
        "type": "telegram",
        "telegramUserId": telegram_user_id,
        "username": user.get("username"),
        "firstName": user.get("first_name"),
        "lastName": user.get("last_name"),
        "customerId": canonical_customer_id,
    }


def dispatch_conflict(exc: DispatchConflict) -> HTTPException:
    return HTTPException(status_code=409, detail={"code": exc.code, "message": exc.message})


def build_admin_settings_payload() -> dict:
    cors_origins = get_cors_origins()
    web_app_url = (os.getenv("WEB_APP_URL") or "").strip()
    runtime = os.getenv("POMICH_RUNTIME") or os.getenv("VITE_APP_ENV") or "dev"
    return {
        "runtime": runtime,
        "webAppUrl": web_app_url or None,
        "corsOrigins": cors_origins,
        "encryptionEnabled": encryption_enabled(),
        "databaseUrlConfigured": bool((os.getenv("DATABASE_URL") or "").strip()),
        "sqlStorageEnabled": sql_storage_enabled(),
        "storageBackend": (os.getenv("POMICH_STORAGE_BACKEND") or ("sql" if sql_storage_enabled() else "json")),
        "telegramConfigured": bool(get_configured_token()),
        "adminAccountsConfigured": bool(load_account_configs("POMICH_ADMIN_ACCOUNTS")),
        "providerAccountsConfigured": bool(load_account_configs("POMICH_PROVIDER_ACCOUNTS")),
        "allowHttpPilot": allow_http_pilot(),
        "bootstrapAuthSessionsEnabled": bootstrap_auth_sessions_enabled(),
        "sessionTtlSeconds": session_ttl_seconds(),
    }


def otp_http_status(code: str) -> int:
    if code in {"rate_limit_exceeded", "send_cooldown"}:
        return 429
    return 400


def otp_http_detail(exc: OtpVerificationError):
    if exc.retry_after_seconds is None:
        return exc.code
    return {"code": exc.code, "retryAfterSeconds": int(exc.retry_after_seconds)}
