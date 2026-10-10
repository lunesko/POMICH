from __future__ import annotations

import hmac
import uuid

from fastapi import APIRouter, Header, HTTPException, Request, Response

from bot.api_deps import (
    AuthPrincipal,
    configured_admin_secret,
    configured_customer_secret,
    configured_provider_secret,
    extract_bearer_token,
    find_admin_account,
    find_provider_account,
    otp_http_detail,
    otp_http_status,
    require_admin_auth,
    require_any_provider_auth,
    require_customer_auth,
    require_customer_auth_from_bearer,
    verify_init_data_or_raise,
    verify_role_session,
)
from bot.auth_sessions import issue_realtime_ticket
from bot.browser_sessions import (
    clear_browser_sessions,
    issue_browser_login,
    require_same_origin,
    restore_browser_session,
    revoke_request_sessions,
    set_browser_session,
)
from bot.order_store import (
    build_user_account_status,
    customer_profile_exists,
    ensure_linked_provider_profile,
    find_registered_customer_by_phone,
    get_customer_profile,
    get_provider_profile,
    resolve_linked_provider_id,
    sync_linked_provider_phone_verification_from_customer,
    update_customer_profile,
    upsert_telegram_customer_profile,
)
from bot.otp_verification import OtpVerificationError, confirm_customer_verification_code, send_customer_verification_code
from bot.telegram_config import normalize_telegram_bot_kind

router = APIRouter(tags=["auth"])

def _provider_account_summary(customer_id: str, profile: dict | None = None) -> dict:
    """Telegram identity alone does not grant provider API permissions — only reports link state."""
    payload = profile or get_customer_profile(customer_id)
    provider_id = resolve_linked_provider_id(customer_id, payload)
    provider = get_provider_profile(provider_id) if provider_id else None
    linked = bool(provider and provider.get("registeredAt"))
    verification_status = str((provider or {}).get("verificationStatus") or "unverified")
    return {
        "linked": linked,
        "providerId": provider_id if linked else (provider_id or None),
        "verificationStatus": verification_status if linked else "unverified",
    }


def _secrets_match(supplied: str | None, expected: str) -> bool:
    left = str(supplied or "")
    right = str(expected or "")
    if not left or not right:
        return False
    return hmac.compare_digest(left, right)


@router.post("/auth/admin/session")
def create_admin_session(response: Response, x_pomich_admin_token: str | None = Header(default=None)) -> dict:
    secret = configured_admin_secret()
    if not _secrets_match(x_pomich_admin_token, secret):
        raise HTTPException(status_code=401, detail="admin_token_invalid")
    session = issue_browser_login("admin", "admin", secret)
    set_browser_session(response, session)
    return session


@router.post("/auth/admin/login")
def create_admin_account_session(payload: dict, response: Response) -> dict:
    account = find_admin_account(str(payload.get("username") or ""), str(payload.get("password") or ""))
    if account is None:
        raise HTTPException(status_code=401, detail="admin_credentials_invalid")
    subject_id = str(account.get("id") or account.get("username") or "admin").strip()
    session = issue_browser_login("admin", subject_id, configured_admin_secret())
    session["username"] = str(account.get("username") or subject_id)
    set_browser_session(response, session)
    return session


@router.post("/auth/provider/session")
def create_provider_session(payload: dict, response: Response, x_pomich_provider_token: str | None = Header(default=None)) -> dict:
    secret = configured_provider_secret()
    if not _secrets_match(x_pomich_provider_token, secret):
        raise HTTPException(status_code=401, detail="provider_token_invalid")
    provider_id = str(payload.get("providerId") or "").strip()
    if not provider_id:
        raise HTTPException(status_code=400, detail="providerId missing")
    # Ops bootstrap only — never mint a session for a non-existent providerId.
    # Day-to-day partner auth: /auth/provider/login or /auth/provider/self/session.
    if get_provider_profile(provider_id) is None:
        raise HTTPException(status_code=404, detail="provider_not_found")
    session = issue_browser_login("provider", provider_id, secret)
    session["providerId"] = provider_id
    set_browser_session(response, session)
    return session


@router.post("/auth/provider/self/session")
def create_self_provider_session(payload: dict, response: Response, authorization: str | None = Header(default=None)) -> dict:
    customer_id = str(payload.get("customerId") or "").strip()
    if not customer_id:
        raise HTTPException(status_code=400, detail="customerId missing")
    principal = require_customer_auth(customer_id, authorization)
    provider_id = resolve_linked_provider_id(customer_id)
    if not provider_id:
        raise HTTPException(status_code=400, detail="provider_not_linked")
    profile = get_customer_profile(customer_id)
    if profile is not None and not str(profile.get("linkedProviderId") or "").strip():
        update_customer_profile(customer_id, {"linkedProviderId": provider_id})
    # Missing SQL provider rows otherwise force blank registration / empty map in Mini App.
    ensure_linked_provider_profile(customer_id)
    sync_linked_provider_phone_verification_from_customer(provider_id)
    session = issue_browser_login("provider", provider_id, configured_provider_secret(),
                                  remember_me=principal.remember_me, deadline=principal.browser_expires_at)
    session["providerId"] = provider_id
    set_browser_session(response, session)
    return session


@router.post("/auth/provider/login")
def create_provider_account_session(payload: dict, response: Response) -> dict:
    provider_id = str(payload.get("providerId") or "").strip()
    login = str(payload.get("login") or payload.get("username") or provider_id).strip()
    account = find_provider_account(login, str(payload.get("password") or ""), provider_id)
    if account is None or not account.get("providerId"):
        raise HTTPException(status_code=401, detail="provider_credentials_invalid")
    session = issue_browser_login("provider", str(account["providerId"]), configured_provider_secret(), remember_me=payload.get("rememberMe") is True)
    session["providerId"] = str(account["providerId"])
    session["username"] = str(account.get("username") or login)
    set_browser_session(response, session)
    return session


@router.post("/auth/customer/guest/session")
def create_guest_customer_session(response: Response, payload: dict | None = None) -> dict:
    """Mint a guest customer bearer.

    Security rules:
    - Never apply untrusted profile fields from the request body.
    - Never honor the shared ``customer-web`` singleton as a client-chosen id.
    - Restore only a previously persisted ``guest-<32hex>`` id; unknown ids get a fresh UUID.
    """
    requested_customer_id = str((payload or {}).get("customerId") or "").strip()
    customer_id: str | None = None

    if requested_customer_id:
        if requested_customer_id == "customer-web" or not requested_customer_id.startswith("guest-"):
            raise HTTPException(status_code=400, detail="guest_customer_id_invalid")
        # Restore only — never create under a client-chosen id (blocks guest takeover / IDOR mint).
        if customer_profile_exists(requested_customer_id):
            customer_id = requested_customer_id

    if customer_id is None:
        customer_id = f"guest-{uuid.uuid4().hex}"
        profile = update_customer_profile(customer_id, {})
    else:
        profile = get_customer_profile(customer_id)

    session = issue_browser_login("customer", customer_id, configured_customer_secret())
    session["customerId"] = customer_id
    session["profile"] = profile
    session["account"] = build_user_account_status(customer_id)
    set_browser_session(response, session)
    return session


@router.post("/auth/customer/telegram/session")
def create_telegram_customer_session(
    response: Response,
    payload: dict | None = None,
    x_telegram_init_data: str | None = Header(default=None),
    x_pomich_telegram_bot: str | None = Header(default=None),
) -> dict:
    # Unified TG + Web identity: Telegram initData -> customerId tg-{user_id} in shared DB.
    # X-POMICH-Telegram-Bot is a routing hint only; signature still decides botKind.
    init_data = x_telegram_init_data or str((payload or {}).get("initData") or "").strip()
    hint = x_pomich_telegram_bot or str((payload or {}).get("telegramBotKind") or "").strip()
    verified = verify_init_data_or_raise(init_data, hint)
    if verified is None:
        raise HTTPException(status_code=403, detail="telegram_auth_not_configured")
    user = verified.get("user") or {}
    telegram_user_id = str(user.get("id") or "").strip()
    if not telegram_user_id:
        raise HTTPException(status_code=401, detail="telegram_user_missing")

    bot_kind = normalize_telegram_bot_kind(verified.get("botKind")) or normalize_telegram_bot_kind(hint) or "customer"
    profile = upsert_telegram_customer_profile(user, bot_kind=bot_kind)
    customer_id = str(profile.get("id") or f"tg-{telegram_user_id}")

    if str(profile.get("preferredRole") or "") != bot_kind:
        profile = update_customer_profile(customer_id, {"preferredRole": bot_kind}) or profile
    preferred_role = bot_kind

    # Customer bearer only — never issue provider permissions from Telegram identity alone.
    session = issue_browser_login("customer", customer_id, configured_customer_secret())
    session["customerId"] = customer_id
    session["profile"] = profile
    session["customerIdentity"] = profile.get("customerIdentity")
    session["account"] = build_user_account_status(customer_id)
    session["preferredRole"] = preferred_role
    session["telegramBotKind"] = bot_kind
    if bot_kind == "provider":
        session["providerAccount"] = _provider_account_summary(customer_id, profile)
    set_browser_session(response, session)
    return session


@router.post("/auth/customer/verify/send")
def customer_verify_send(
    payload: dict,
    authorization: str | None = Header(default=None),
    x_pomich_telegram_bot: str | None = Header(default=None),
) -> dict:
    principal = require_customer_auth_from_bearer(authorization)
    channel = str(payload.get("channel") or "").strip().lower()
    preferred_bot_kind = str(payload.get("telegramBotKind") or x_pomich_telegram_bot or "").strip()
    try:
        return send_customer_verification_code(
            principal.subject_id,
            channel,
            phone=payload.get("phone"),
            email=payload.get("email"),
            preferred_bot_kind=preferred_bot_kind or None,
            send_reason="auth/customer/verify/send",
        )
    except OtpVerificationError as exc:
        raise HTTPException(status_code=otp_http_status(exc.code), detail=otp_http_detail(exc)) from exc


@router.post("/auth/customer/verify/confirm")
def customer_verify_confirm(payload: dict, authorization: str | None = Header(default=None)) -> dict:
    principal = require_customer_auth_from_bearer(authorization)
    code = str(payload.get("code") or "").strip()
    try:
        profile = confirm_customer_verification_code(principal.subject_id, code)
        return {"ok": True, "profile": profile}
    except OtpVerificationError as exc:
        raise HTTPException(status_code=400, detail=exc.code) from exc


@router.post("/auth/customer/phone/login/send")
def customer_phone_login_send(payload: dict) -> dict:
    phone = str(payload.get("phone") or "").strip()
    if not phone:
        raise HTTPException(status_code=400, detail="invalid_phone")
    profile = find_registered_customer_by_phone(phone)
    if profile is None:
        # Anti-enumeration: same shape as a successful "queued" response.
        return {"ok": True, "channel": "telegram", "masked": True}
    customer_id = str(profile.get("id") or "").strip()
    try:
        return send_customer_verification_code(
            customer_id,
            "telegram",
            send_reason="auth/customer/phone/login/send",
        )
    except OtpVerificationError as exc:
        raise HTTPException(status_code=otp_http_status(exc.code), detail=otp_http_detail(exc)) from exc
    except ValueError as exc:
        if str(exc) == "phone_already_registered":
            raise HTTPException(status_code=409, detail="phone_already_registered") from exc
        raise


@router.post("/auth/customer/phone/login/confirm")
def customer_phone_login_confirm(payload: dict, response: Response) -> dict:
    phone = str(payload.get("phone") or "").strip()
    code = str(payload.get("code") or "").strip()
    if not phone:
        raise HTTPException(status_code=400, detail="invalid_phone")
    profile = find_registered_customer_by_phone(phone)
    if profile is None:
        raise HTTPException(status_code=401, detail="login_failed")
    customer_id = str(profile.get("id") or "").strip()
    try:
        confirmed_profile = confirm_customer_verification_code(customer_id, code)
    except OtpVerificationError:
        raise HTTPException(status_code=401, detail="login_failed") from None
    session = issue_browser_login("customer", customer_id, configured_customer_secret(), remember_me=payload.get("rememberMe") is True)
    session["customerId"] = customer_id
    session["profile"] = confirmed_profile
    session["account"] = build_user_account_status(customer_id)
    set_browser_session(response, session)
    return session


@router.post("/auth/browser/restore")
def browser_restore(payload: dict, request: Request, response: Response) -> dict:
    require_same_origin(request)
    return restore_browser_session(request, response, str(payload.get("role") or ""))


@router.post("/auth/browser/logout", status_code=204)
def browser_logout(request: Request, authorization: str | None = Header(default=None)) -> Response:
    require_same_origin(request)
    revoke_request_sessions(request, authorization)
    response = Response(status_code=204)
    clear_browser_sessions(response)
    return response


def _principal_from_any_bearer(authorization: str | None) -> AuthPrincipal:
    bearer = extract_bearer_token(authorization)
    if not bearer:
        raise HTTPException(status_code=401, detail="auth_session_required")
    role_hint = None
    try:
        from bot.api_deps import _session_role_hint

        role_hint = _session_role_hint(bearer)
    except Exception:
        role_hint = None
    if role_hint == "admin":
        return require_admin_auth(authorization=authorization)
    if role_hint == "provider":
        return require_any_provider_auth(authorization=authorization)
    if role_hint == "customer":
        return require_customer_auth_from_bearer(authorization)
    # Fallback try customer → provider → admin
    for role, secret_fn in (
        ("customer", configured_customer_secret),
        ("provider", configured_provider_secret),
        ("admin", configured_admin_secret),
    ):
        try:
            return verify_role_session(bearer, role, secret_fn())
        except HTTPException:
            continue
    raise HTTPException(status_code=401, detail="auth_session_required")


@router.post("/auth/realtime/ticket")
def mint_realtime_ticket(payload: dict, authorization: str | None = Header(default=None)) -> dict:
    """Short-lived channel ticket for EventSource/WebSocket query auth (F05)."""
    principal = _principal_from_any_bearer(authorization)
    scope = str((payload or {}).get("scope") or "").strip()
    if not scope or ":" not in scope:
        raise HTTPException(status_code=400, detail="realtime_scope_required")
    kind, _, target = scope.partition(":")
    kind = kind.strip().lower()
    target = target.strip()
    if kind not in {"order", "customer", "provider"} or not target:
        raise HTTPException(status_code=400, detail="realtime_scope_invalid")
    if kind == "customer" and principal.role == "customer" and principal.subject_id != target:
        raise HTTPException(status_code=403, detail="customer_identity_mismatch")
    if kind == "provider" and principal.role == "provider" and principal.subject_id != target:
        raise HTTPException(status_code=403, detail="provider_identity_mismatch")
    if kind == "order":
        from bot.order_store import get_order
        from bot.api_deps import require_order_participant_auth

        order = get_order(target)
        if order is None:
            raise HTTPException(status_code=404, detail="order not found")
        require_order_participant_auth(order, authorization)
    return issue_realtime_ticket(
        role=principal.role,
        subject_id=principal.subject_id,
        scope=f"{kind}:{target}",
        session_id=principal.session_id,
        stream_expires_at=principal.expires_at or principal.browser_expires_at or None,
    )
