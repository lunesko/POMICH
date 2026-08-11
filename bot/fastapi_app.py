import base64
import binascii
import hashlib
import hmac
import json
import os
import time
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
    attach_dispatch_to_order,
    attach_dispatch_to_orders,
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
    review_customer_verification,
    review_provider_verification,
    save_order,
    submit_customer_verification,
    submit_provider_verification,
    update_customer_profile,
    update_order_status,
    update_provider_order_status,
    update_provider_presence,
    update_provider_profile,
)
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
        invalid_origins = [origin for origin in cors_origins if not _is_public_https_origin(origin)]
        if invalid_origins:
            errors.append("POMICH_CORS_ORIGINS contains non-public or non-HTTPS origins")

    if not _is_configured_secret(os.getenv("POMICH_ADMIN_TOKEN")):
        errors.append("POMICH_ADMIN_TOKEN must be a non-placeholder secret in production")

    if not _is_configured_secret(os.getenv("POMICH_PROVIDER_TOKEN")):
        errors.append("POMICH_PROVIDER_TOKEN must be set in production so partner endpoints are protected")

    if not (os.getenv("DATABASE_URL") or "").strip() and os.getenv("POMICH_ALLOW_JSON_STORE_IN_PRODUCTION") != "true":
        errors.append("DATABASE_URL must be set in production, unless POMICH_ALLOW_JSON_STORE_IN_PRODUCTION=true is explicitly used for a small pilot")

    web_app_url = (os.getenv("WEB_APP_URL") or "").strip()
    telegram_token = (os.getenv("TELEGRAM_BOT_TOKEN") or os.getenv("VITE_TELEGRAM_BOT_TOKEN") or "").strip()
    if telegram_token and not web_app_url:
        errors.append("WEB_APP_URL must be set when Telegram is configured in production")
    elif telegram_token and not _is_public_https_origin(web_app_url):
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


@app.get("/orders")
@app.get("/api/orders")
def list_orders(x_pomich_admin_token: str | None = Header(default=None), authorization: str | None = Header(default=None)) -> list[dict]:
    _require_admin_auth(x_pomich_admin_token, authorization)
    return attach_dispatch_to_orders(load_orders(), load_offers())


@app.get("/providers")
@app.get("/api/providers")
def list_providers() -> list[dict]:
    expire_offers()
    return load_providers()


@app.get("/customers/{customer_id}/profile")
@app.get("/api/customers/{customer_id}/profile")
def read_customer_profile(customer_id: str) -> dict:
    return get_customer_profile(customer_id)


@app.post("/customers/{customer_id}/profile")
@app.post("/api/customers/{customer_id}/profile")
@app.patch("/customers/{customer_id}/profile")
@app.patch("/api/customers/{customer_id}/profile")
def patch_customer_profile(customer_id: str, payload: dict) -> dict:
    return update_customer_profile(customer_id, payload)


@app.post("/customers/{customer_id}/verification/submit")
@app.post("/api/customers/{customer_id}/verification/submit")
def customer_submit_verification(customer_id: str, payload: dict) -> dict:
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
def create_order(payload: dict) -> dict:
    source = payload.get("source")
    init_data = payload.pop("telegramInitData", None)
    verified_telegram = None
    if source == "telegram-mini-app":
        verified_telegram = _verify_init_data_or_raise(init_data)
        user = (verified_telegram or {}).get("user") or {}
        supplied_telegram_id = payload.get("telegramUserId") or payload.get("chatId")
        if user.get("id") and supplied_telegram_id is not None and str(supplied_telegram_id) != str(user.get("id")):
            raise HTTPException(status_code=401, detail="telegram_user_mismatch")
        _apply_verified_telegram_identity(payload, verified_telegram)

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

    return get_telegram_session(chat_id) or {"chatId": chat_id}


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
