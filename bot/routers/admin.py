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
    list_admin_customer_profiles,
    load_offers,
    load_orders,
    load_providers,
    merge_directory_providers,
    purge_stale_guest_customers,
)
from bot.provider_importer import import_uzhgorod_providers

router = APIRouter(tags=["admin"])


@router.get("/admin/stats")
def admin_stats(
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    require_admin_auth(x_pomich_admin_token, authorization)
    stats = build_admin_stats()
    return {**stats, "activity": build_admin_activity_feed(12)}


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
