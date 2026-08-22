from __future__ import annotations

import os

from fastapi import APIRouter, Header, HTTPException

from bot.api_deps import build_admin_settings_payload, require_admin_auth
from bot.order_store import (
    admin_delete_provider,
    admin_update_customer_profile,
    admin_update_provider_profile,
    attach_dispatch_to_orders,
    build_admin_activity_feed,
    build_admin_stats,
    expire_stale_and_notify,
    list_admin_customer_profiles,
    load_offers,
    load_orders,
    load_providers,
    merge_directory_providers,
    purge_stale_guest_customers,
)
from bot.ops_log import build_admin_ops_log
from bot.provider_importer import import_uzhgorod_providers, import_ukraine_providers
from bot.runtime_store import (
    deactivate_auth_account,
    get_auth_account,
    list_auth_accounts,
    set_auth_account_password,
    sql_storage_enabled,
    upsert_auth_account,
)

router = APIRouter(tags=["admin"])


def _require_sql_auth_accounts() -> None:
    if not sql_storage_enabled():
        raise HTTPException(status_code=503, detail="sql_auth_accounts_required")


def _public_auth_account(account: dict) -> dict:
    return {
        "id": account.get("id"),
        "role": account.get("role"),
        "username": account.get("username"),
        "email": account.get("email"),
        "phone": account.get("phone"),
        "providerId": account.get("providerId"),
        "status": account.get("status") or "active",
        "createdAt": account.get("createdAt"),
        "updatedAt": account.get("updatedAt"),
        "hasPassword": bool(str(account.get("passwordHash") or "").strip()),
    }


def _auth_account_http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, KeyError):
        return HTTPException(status_code=404, detail="auth_account_not_found")
    if isinstance(exc, ValueError):
        status_code = 409 if str(exc) == "last_admin_account" else 400
        return HTTPException(status_code=status_code, detail=str(exc))
    return HTTPException(status_code=500, detail="auth_account_error")


@router.get("/admin/stats")
def admin_stats(
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    require_admin_auth(x_pomich_admin_token, authorization)
    stats = build_admin_stats()
    return {**stats, "activity": build_admin_activity_feed(12)}


@router.get("/admin/ops-log")
def admin_ops_log(
    limit: int = 80,
    severity: str | None = None,
    orderId: str | None = None,
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    """Stage + error breadcrumbs for ops: order trails and API failures."""
    require_admin_auth(x_pomich_admin_token, authorization)
    return build_admin_ops_log(limit=limit, severity=severity, order_id=orderId)


@router.get("/admin/clients")
def admin_list_clients(
    q: str | None = None,
    includeGuests: bool = False,
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> list[dict]:
    require_admin_auth(x_pomich_admin_token, authorization)
    return list_admin_customer_profiles(include_guests=includeGuests, query=q)


@router.post("/admin/clients/purge-guests")
def admin_purge_guest_clients(
    days: int = 7,
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    require_admin_auth(x_pomich_admin_token, authorization)
    return purge_stale_guest_customers(days=days)


@router.get("/admin/providers")
def admin_list_providers(
    q: str | None = None,
    kind: str | None = None,
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> list[dict]:
    require_admin_auth(x_pomich_admin_token, authorization)
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


@router.get("/admin/orders")
def admin_list_orders(
    status: str | None = None,
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> list[dict]:
    require_admin_auth(x_pomich_admin_token, authorization)
    expire_stale_and_notify()
    orders = attach_dispatch_to_orders(load_orders(), load_offers())
    if status and status.strip().lower() not in {"", "all"}:
        normalized = status.strip().lower()
        orders = [order for order in orders if str(order.get("status") or "").lower() == normalized]
    return orders


@router.get("/admin/settings")
def admin_settings(
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    require_admin_auth(x_pomich_admin_token, authorization)
    return build_admin_settings_payload()


@router.get("/admin/auth/accounts")
def admin_list_auth_accounts(
    role: str | None = None,
    includeDisabled: bool = False,
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> list[dict]:
    require_admin_auth(x_pomich_admin_token, authorization)
    _require_sql_auth_accounts()
    try:
        accounts = list_auth_accounts(role=role, include_disabled=includeDisabled)
    except ValueError as exc:
        raise _auth_account_http_error(exc) from exc
    return [_public_auth_account(account) for account in accounts]


@router.post("/admin/auth/accounts")
def admin_upsert_auth_account(
    payload: dict,
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    require_admin_auth(x_pomich_admin_token, authorization)
    _require_sql_auth_accounts()
    role = str(payload.get("role") or "").strip()
    if not role:
        raise HTTPException(status_code=400, detail="role_required")
    try:
        return _public_auth_account(upsert_auth_account(role, payload))
    except (KeyError, ValueError) as exc:
        raise _auth_account_http_error(exc) from exc


@router.patch("/admin/auth/accounts/{account_id}")
def admin_patch_auth_account(
    account_id: str,
    payload: dict,
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    require_admin_auth(x_pomich_admin_token, authorization)
    _require_sql_auth_accounts()
    existing = get_auth_account(account_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="auth_account_not_found")
    role = str(existing.get("role") or "").strip()
    if payload.get("role") and str(payload.get("role")).strip().lower() != role:
        raise HTTPException(status_code=400, detail="auth_account_role_immutable")
    try:
        return _public_auth_account(upsert_auth_account(role, {**existing, **payload, "id": account_id, "role": role}))
    except (KeyError, ValueError) as exc:
        raise _auth_account_http_error(exc) from exc


@router.post("/admin/auth/accounts/{account_id}/password")
def admin_set_auth_account_password(
    account_id: str,
    payload: dict,
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    require_admin_auth(x_pomich_admin_token, authorization)
    _require_sql_auth_accounts()
    try:
        return _public_auth_account(set_auth_account_password(account_id, str(payload.get("password") or "")))
    except (KeyError, ValueError) as exc:
        raise _auth_account_http_error(exc) from exc


@router.delete("/admin/auth/accounts/{account_id}")
def admin_deactivate_auth_account(
    account_id: str,
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    require_admin_auth(x_pomich_admin_token, authorization)
    _require_sql_auth_accounts()
    try:
        return _public_auth_account(deactivate_auth_account(account_id))
    except (KeyError, ValueError) as exc:
        raise _auth_account_http_error(exc) from exc


@router.patch("/admin/clients/{customer_id}")
def admin_patch_client(
    customer_id: str,
    payload: dict,
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    require_admin_auth(x_pomich_admin_token, authorization)
    try:
        return admin_update_customer_profile(customer_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.patch("/admin/providers/{provider_id}")
def admin_patch_provider(
    provider_id: str,
    payload: dict,
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    require_admin_auth(x_pomich_admin_token, authorization)
    try:
        return admin_update_provider_profile(provider_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.delete("/admin/providers/{provider_id}")
def admin_remove_provider(
    provider_id: str,
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    require_admin_auth(x_pomich_admin_token, authorization)
    try:
        return admin_delete_provider(provider_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/admin/providers/import/uzhgorod")
def admin_import_uzhgorod_providers(
    payload: dict | None = None,
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    if authorization or x_pomich_admin_token:
        try:
            require_admin_auth(x_pomich_admin_token, authorization)
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


@router.post("/admin/providers/import/ukraine")
def admin_import_ukraine_providers(
    payload: dict | None = None,
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    require_admin_auth(x_pomich_admin_token, authorization)
    options = payload or {}
    settlement_ids = options.get("settlementIds") or options.get("cities")
    oblast = options.get("oblast")
    prefer_osm = bool(options.get("preferOsm", True))
    seed_only = bool(options.get("seedOnly", False))
    delay_seconds = float(options.get("delaySeconds", 2.0))
    result = import_ukraine_providers(
        settlement_ids=settlement_ids if isinstance(settlement_ids, list) else None,
        oblast=str(oblast).strip() if oblast else None,
        prefer_osm=prefer_osm and not seed_only,
        use_seed=seed_only,
        delay_seconds=delay_seconds,
    )
    merge_result = merge_directory_providers(result["providers"])
    return {
        "counts": result["counts"],
        "perSettlement": result["perSettlement"],
        "merge": merge_result,
    }
