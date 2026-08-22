from __future__ import annotations

import uuid

from fastapi import APIRouter, Header, HTTPException

from bot.api_deps import (
    account_config_active,
    bootstrap_auth_sessions_enabled,
    configured_admin_secret,
    configured_customer_secret,
    configured_provider_secret,
    find_provider_account_by_provider_id,
    find_admin_account,
    find_provider_account,
    issue_role_session,
    load_account_configs,
    otp_http_detail,
    otp_http_status,
    password_matches,
    require_admin_auth,
    require_active_provider_account,
    require_any_provider_auth,
    require_customer_auth,
    require_customer_auth_from_bearer,
    verify_init_data_or_raise,
)
from bot.ops_log import record_ops_event
from bot.order_store import (
    build_user_account_status,
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
from bot.runtime_store import get_auth_account, set_auth_account_password
from bot.telegram_config import normalize_telegram_bot_kind

router = APIRouter(tags=["auth"])


def _account_login_identifiers(account: dict) -> set[str]:
    values = {
        account.get("id"),
        account.get("username"),
        account.get("email"),
        account.get("phone"),
        account.get("providerId"),
        account.get("provider_id"),
    }
    return {str(value).strip().lower() for value in values if str(value or "").strip()}


def _find_account_for_reset(role: str, login: str, provider_id: str | None = None) -> dict | None:
    normalized_login = str(login or "").strip().lower()
    normalized_provider_id = str(provider_id or "").strip()
    if not normalized_login and not normalized_provider_id:
        return None
    env_name = "POMICH_ADMIN_ACCOUNTS" if role == "admin" else "POMICH_PROVIDER_ACCOUNTS"
    for account in load_account_configs(env_name, include_disabled=True):
        account_provider_id = str(account.get("providerId") or account.get("provider_id") or "").strip()
        if normalized_provider_id and account_provider_id != normalized_provider_id:
            continue
        identifiers = _account_login_identifiers(account)
        if normalized_login and normalized_login not in identifiers:
            continue
        return {**account, "providerId": account_provider_id or account.get("providerId")}
    return None


def _password_reset_request_payload(role: str, login: str, account: dict | None, *, provider_id: str | None = None) -> dict:
    normalized_login = str(login or "").strip()
    normalized_provider_id = str(provider_id or "").strip()
    account_id = str((account or {}).get("id") or "").strip()
    account_provider_id = str((account or {}).get("providerId") or normalized_provider_id or "").strip()
    record_ops_event(
        event_type="AUTH_ACCOUNT_PASSWORD_RESET_REQUESTED",
        message=f"{role.title()} password reset requested",
        provider_id=account_provider_id if role == "provider" and account_provider_id else None,
        code=account_id or normalized_login or normalized_provider_id or role,
        source=f"auth.{role}.password-reset.request",
        extra={
            "accountRole": role,
            "accountStatus": str((account or {}).get("status") or "unknown"),
            "requestedLogin": normalized_login[:80],
        },
    )
    return {"ok": True, "queued": True}


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


@router.post("/auth/admin/session")
def create_admin_session(x_pomich_admin_token: str | None = Header(default=None)) -> dict:
    if not bootstrap_auth_sessions_enabled():
        raise HTTPException(status_code=403, detail="admin_bootstrap_session_disabled")
    secret = configured_admin_secret()
    if x_pomich_admin_token != secret:
        raise HTTPException(status_code=401, detail="admin_token_invalid")
    return issue_role_session("admin", "admin", secret)


@router.post("/auth/admin/login")
def create_admin_account_session(payload: dict) -> dict:
    account = find_admin_account(str(payload.get("username") or ""), str(payload.get("password") or ""))
    if account is None:
        raise HTTPException(status_code=401, detail="admin_credentials_invalid")
    subject_id = str(account.get("id") or account.get("username") or "admin").strip()
    session = issue_role_session("admin", subject_id, configured_admin_secret())
    session["username"] = str(account.get("username") or subject_id)
    session["passwordResetRequired"] = bool(account.get("passwordResetRequired"))
    return session


@router.post("/auth/admin/password-reset/request")
def request_admin_account_password_reset(payload: dict) -> dict:
    login = str(payload.get("login") or payload.get("username") or "").strip()
    account = _find_account_for_reset("admin", login)
    return _password_reset_request_payload("admin", login, account)


@router.post("/auth/provider/session")
def create_provider_session(payload: dict, x_pomich_provider_token: str | None = Header(default=None)) -> dict:
    if not bootstrap_auth_sessions_enabled():
        raise HTTPException(status_code=403, detail="provider_bootstrap_session_disabled")
    secret = configured_provider_secret()
    if x_pomich_provider_token != secret:
        raise HTTPException(status_code=401, detail="provider_token_invalid")
    provider_id = str(payload.get("providerId") or "").strip()
    if not provider_id:
        raise HTTPException(status_code=400, detail="providerId missing")
    session = issue_role_session("provider", provider_id, secret)
    session["providerId"] = provider_id
    return session


@router.post("/auth/provider/self/session")
def create_self_provider_session(payload: dict, authorization: str | None = Header(default=None)) -> dict:
    customer_id = str(payload.get("customerId") or "").strip()
    if not customer_id:
        raise HTTPException(status_code=400, detail="customerId missing")
    require_customer_auth(customer_id, authorization)
    provider_id = resolve_linked_provider_id(customer_id)
    if not provider_id:
        raise HTTPException(status_code=400, detail="provider_not_linked")
    profile = get_customer_profile(customer_id)
    if profile is not None and not str(profile.get("linkedProviderId") or "").strip():
        update_customer_profile(customer_id, {"linkedProviderId": provider_id})
    # Missing SQL provider rows otherwise force blank registration / empty map in Mini App.
    ensure_linked_provider_profile(customer_id)
    sync_linked_provider_phone_verification_from_customer(provider_id)
    require_active_provider_account(provider_id)
    session = issue_role_session("provider", provider_id, configured_provider_secret())
    session["providerId"] = provider_id
    return session


@router.post("/auth/provider/login")
def create_provider_account_session(payload: dict) -> dict:
    provider_id = str(payload.get("providerId") or "").strip()
    login = str(payload.get("login") or payload.get("username") or provider_id).strip()
    account = find_provider_account(login, str(payload.get("password") or ""), provider_id)
    if account is None or not account.get("providerId"):
        raise HTTPException(status_code=401, detail="provider_credentials_invalid")
    session = issue_role_session("provider", str(account["providerId"]), configured_provider_secret())
    session["providerId"] = str(account["providerId"])
    session["username"] = str(account.get("username") or login)
    session["passwordResetRequired"] = bool(account.get("passwordResetRequired"))
    return session


@router.post("/auth/provider/password-reset/request")
def request_provider_account_password_reset(payload: dict) -> dict:
    provider_id = str(payload.get("providerId") or "").strip()
    login = str(payload.get("login") or payload.get("username") or provider_id).strip()
    account = _find_account_for_reset("provider", login, provider_id)
    return _password_reset_request_payload("provider", login, account, provider_id=provider_id)


@router.post("/auth/provider/password")
def update_provider_account_password(payload: dict, authorization: str | None = Header(default=None)) -> dict:
    principal = require_any_provider_auth(authorization)
    account = find_provider_account_by_provider_id(principal.subject_id, include_disabled=False)
    if account is None:
        raise HTTPException(status_code=403, detail="provider_account_required")
    new_password = str(payload.get("newPassword") or payload.get("password") or "").strip()
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="password_too_short")
    reset_required = bool(account.get("passwordResetRequired"))
    current_password = str(payload.get("currentPassword") or "").strip()
    if not reset_required:
        if not current_password:
            raise HTTPException(status_code=400, detail="current_password_required")
        if not password_matches(account, current_password):
            raise HTTPException(status_code=401, detail="current_password_invalid")
    updated = set_auth_account_password(str(account.get("id") or ""), new_password, reset_required=False)
    record_ops_event(
        event_type="AUTH_ACCOUNT_PASSWORD_COMPLETED",
        message="Provider auth account password changed",
        provider_id=principal.subject_id,
        code=str(updated.get("id") or ""),
        source="auth.provider.password",
    )
    return {"ok": True, "providerId": principal.subject_id, "passwordResetRequired": False}


@router.post("/auth/admin/password")
def update_admin_account_password(payload: dict, authorization: str | None = Header(default=None)) -> dict:
    principal = require_admin_auth(authorization=authorization)
    account = get_auth_account(principal.subject_id)
    if account is None or str(account.get("role") or "") != "admin":
        raise HTTPException(status_code=403, detail="admin_account_required")
    if not account_config_active(account):
        raise HTTPException(status_code=403, detail="admin_account_disabled")
    new_password = str(payload.get("newPassword") or payload.get("password") or "").strip()
    if len(new_password) < 8:
        raise HTTPException(status_code=400, detail="password_too_short")
    reset_required = bool(account.get("passwordResetRequired"))
    current_password = str(payload.get("currentPassword") or "").strip()
    if not reset_required:
        if not current_password:
            raise HTTPException(status_code=400, detail="current_password_required")
        if not password_matches(account, current_password):
            raise HTTPException(status_code=401, detail="current_password_invalid")
    updated = set_auth_account_password(str(account.get("id") or ""), new_password, reset_required=False)
    record_ops_event(
        event_type="AUTH_ACCOUNT_PASSWORD_COMPLETED",
        message="Admin auth account password changed",
        code=str(updated.get("id") or principal.subject_id),
        source="auth.admin.password",
    )
    return {"ok": True, "adminId": principal.subject_id, "passwordResetRequired": False}


@router.post("/auth/customer/guest/session")
def create_guest_customer_session(payload: dict | None = None) -> dict:
    requested_customer_id = str((payload or {}).get("customerId") or "").strip()
    if requested_customer_id and not (requested_customer_id == "customer-web" or requested_customer_id.startswith("guest-")):
        raise HTTPException(status_code=400, detail="guest_customer_id_invalid")
    customer_id = requested_customer_id or f"guest-{uuid.uuid4().hex}"
    profile = update_customer_profile(customer_id, payload or {})
    session = issue_role_session("customer", customer_id, configured_customer_secret())
    session["customerId"] = customer_id
    session["profile"] = profile
    session["account"] = build_user_account_status(customer_id)
    return session


@router.post("/auth/customer/telegram/session")
def create_telegram_customer_session(
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
    session = issue_role_session("customer", customer_id, configured_customer_secret())
    session["customerId"] = customer_id
    session["profile"] = profile
    session["customerIdentity"] = profile.get("customerIdentity")
    session["account"] = build_user_account_status(customer_id)
    session["preferredRole"] = preferred_role
    session["telegramBotKind"] = bot_kind
    if bot_kind == "provider":
        session["providerAccount"] = _provider_account_summary(customer_id, profile)
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
        raise HTTPException(status_code=404, detail="customer_not_found")
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
def customer_phone_login_confirm(payload: dict) -> dict:
    phone = str(payload.get("phone") or "").strip()
    code = str(payload.get("code") or "").strip()
    if not phone:
        raise HTTPException(status_code=400, detail="invalid_phone")
    profile = find_registered_customer_by_phone(phone)
    if profile is None:
        raise HTTPException(status_code=404, detail="customer_not_found")
    customer_id = str(profile.get("id") or "").strip()
    try:
        confirmed_profile = confirm_customer_verification_code(customer_id, code)
    except OtpVerificationError as exc:
        raise HTTPException(status_code=400, detail=exc.code) from exc
    session = issue_role_session("customer", customer_id, configured_customer_secret())
    session["customerId"] = customer_id
    session["profile"] = confirmed_profile
    session["account"] = build_user_account_status(customer_id)
    return session
