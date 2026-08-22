from __future__ import annotations

import secrets
import time
from typing import Any

from fastapi import APIRouter, Body, Header, HTTPException

from bot.api_deps import (
    auth_accounts_source,
    dispatch_conflict,
    find_provider_account_by_provider_id,
    is_production_runtime,
    require_admin_auth,
    require_any_provider_auth,
    require_provider_auth,
)
from bot.occupied_territories import filter_non_occupied_providers, is_occupied_coordinates, occupied_zone_name
from bot.settlements import (
    filter_providers_by_city,
    filter_providers_near,
    load_settlements,
    nearest_settlement_with_distance,
    settlement_center,
)
from bot.order_store import (
    DispatchConflict,
    accept_offer,
    build_empty_provider_profile_shell,
    decline_offer,
    get_provider_offers,
    get_provider_profile,
    get_provider_public_card,
    list_orders_for_provider,
    load_providers,
    nearby_searching_orders,
    review_provider_verification,
    submit_provider_verification,
    update_provider_presence,
    update_provider_profile,
)
from bot.ops_log import record_ops_event
from bot.realtime import publish_order_event, publish_provider_event
from bot.runtime_store import sql_storage_enabled, upsert_auth_account
from bot.telegram_bot import notify_order_accepted

router = APIRouter(tags=["providers"])

_MAP_MARKER_KEYS = (
    "id",
    "name",
    "city",
    "phone",
    "telegram",
    "vehicle",
    "rating",
    "status",
    "location",
    "specialties",
    "providerKind",
    "contactStatus",
    "address",
    "openingHours",
    "serviceRadiusKm",
    "etaMinutes",
    "verificationStatus",
    "source",
)

_MAP_CACHE: dict[str, Any] = {"ts": 0.0, "key": "", "items": None}
_MAP_CACHE_TTL_SECONDS = 15.0


def _public_provider_auth_bootstrap(account: dict, *, temporary_password: str | None = None, created: bool = False, activated: bool = False) -> dict:
    payload = {
        "id": account.get("id"),
        "providerId": account.get("providerId"),
        "username": account.get("username"),
        "status": account.get("status") or "active",
        "created": created,
        "activated": activated,
        "passwordResetRequired": bool(account.get("passwordResetRequired")),
    }
    if temporary_password:
        payload["temporaryPassword"] = temporary_password
    return payload


def _sync_verified_provider_auth_account(provider_id: str, provider: dict) -> dict | None:
    """When SQL auth is enabled, approved partners get an active provider login."""
    if auth_accounts_source() not in {"sql", "mixed"} or not sql_storage_enabled():
        return None
    existing = find_provider_account_by_provider_id(provider_id, include_disabled=True)
    if existing:
        if str(existing.get("status") or "active").strip().lower() == "disabled":
            account = upsert_auth_account("provider", {**existing, "status": "active"})
            return _public_provider_auth_bootstrap(account, activated=True)
        return _public_provider_auth_bootstrap(existing)

    temporary_password = secrets.token_urlsafe(12)
    username = str(provider.get("username") or provider.get("phone") or provider_id).strip() or provider_id
    account = upsert_auth_account(
        "provider",
        {
            "providerId": provider_id,
            "username": username,
            "phone": provider.get("phone"),
            "email": provider.get("email"),
            "password": temporary_password,
            "passwordResetRequired": True,
            "temporaryPasswordIssuedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "status": "active",
        },
    )
    return _public_provider_auth_bootstrap(account, temporary_password=temporary_password, created=True, activated=True)


def public_map_marker(provider: dict) -> dict:
    """Slim pin payload for the public map — omit verification blobs and documents."""
    marker: dict[str, Any] = {}
    for key in _MAP_MARKER_KEYS:
        value = provider.get(key)
        if value is not None:
            marker[key] = value
    return marker


def _provider_kind(provider: dict) -> str:
    return str(provider.get("providerKind") or "dispatch").strip().lower() or "dispatch"


def _cached_map_markers(cache_key: str, builder) -> list[dict]:
    now = time.monotonic()
    if (
        is_production_runtime()
        and _MAP_CACHE["items"] is not None
        and _MAP_CACHE["key"] == cache_key
        and now - float(_MAP_CACHE["ts"]) < _MAP_CACHE_TTL_SECONDS
    ):
        return _MAP_CACHE["items"]
    items = builder()
    if is_production_runtime():
        _MAP_CACHE["ts"] = now
        _MAP_CACHE["key"] = cache_key
        _MAP_CACHE["items"] = items
    return items


@router.get("/providers")
def list_providers(
    kind: str | None = None,
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> list[dict]:
    """Dispatch partner directory — admin only (full rows). Public map uses /map/providers."""
    require_admin_auth(x_pomich_admin_token, authorization)
    providers = load_providers()
    if kind:
        normalized = kind.strip().lower()
        providers = [provider for provider in providers if _provider_kind(provider) == normalized]
    else:
        # Directory OSM rows (~thousands) belong on /map/providers, not the dispatch list.
        providers = [provider for provider in providers if _provider_kind(provider) != "directory"]
    return providers


@router.get("/map/providers")
def map_providers(
    scope: str | None = None,
    city: str | None = None,
    lat: float | None = None,
    lng: float | None = None,
    radius_km: float = 25.0,
    kind: str | None = None,
) -> list[dict]:
    """Providers for map display; scope=all (free UA) or city/geo filter. Occupied zones excluded."""
    normalized_scope = str(scope or "").strip().lower()
    city_key = city.strip() if city and city.strip() else ""
    radius = max(1.0, min(radius_km, 100.0))
    kind_key = str(kind or "").strip().lower()
    cache_key = f"{normalized_scope}|{city_key}|{lat}|{lng}|{radius}|{kind_key}"

    def build() -> list[dict]:
        providers = filter_non_occupied_providers(load_providers())
        if kind_key in {"dispatch", "directory"}:
            providers = [provider for provider in providers if _provider_kind(provider) == kind_key]
        if normalized_scope == "all":
            filtered = providers
        elif city_key:
            filtered = filter_providers_by_city(providers, city_key)
        elif lat is not None and lng is not None:
            filtered = filter_providers_near(providers, lat, lng, radius_km=radius)
        else:
            filtered = providers
        return [public_map_marker(provider) for provider in filtered]

    return _cached_map_markers(cache_key, build)


@router.get("/map/settlements/nearest")
def map_nearest_settlement(lat: float, lng: float, max_km: float = 80.0) -> dict:
    """Resolve nearest known settlement for geolocation-based directory scope."""
    if is_occupied_coordinates(lat, lng):
        zone = occupied_zone_name(lat, lng)
        raise HTTPException(
            status_code=400,
            detail={"code": "occupied_territory", "zone": zone, "message": "Ця територія тимчасово окупована."},
        )
    cap_km = max(5.0, min(max_km, 200.0))
    item, distance_km = nearest_settlement_with_distance(lat, lng, max_km=cap_km)
    if item is None:
        _, raw_km = nearest_settlement_with_distance(lat, lng)
        detail: dict = {
            "code": "no_nearby_settlement",
            "message": "Найближче місто занадто далеко — використайте радіус.",
            "fallback": "radius",
            "radiusKm": 25,
        }
        if raw_km is not None:
            detail["distanceKm"] = round(raw_km, 2)
        raise HTTPException(status_code=404, detail=detail)
    center = settlement_center(item)
    return {
        "id": item.get("id"),
        "name": item.get("name"),
        "oblast": item.get("oblast"),
        "center": center,
        "distanceKm": round(distance_km or 0, 2),
    }


@router.get("/map/settlements")
def map_settlements() -> list[dict]:
    """Known settlements with center/bbox for city picker and map recenter."""
    return load_settlements()


@router.get("/providers/{provider_id}/public")
def read_provider_public_card(provider_id: str, limit: int = 20) -> dict:
    """Public partner card with reviews for client map (no auth)."""
    card = get_provider_public_card(provider_id, limit=limit)
    if card is None:
        raise HTTPException(status_code=404, detail="provider profile not found")
    return card


@router.get("/map/orders/nearby")
def map_nearby_orders(
    lat: float,
    lng: float,
    radius_km: float = 20.0,
    service: str | None = None,
    x_pomich_provider_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> list[dict]:
    """Searching orders near a provider location for map pins.

    Completed, cancelled, assigned, and other non-searching orders are never returned.
    Requires a partner session so anonymous clients cannot scrape live request pins.
    """
    require_any_provider_auth(authorization, x_pomich_provider_token)
    return nearby_searching_orders(lat, lng, radius_km=radius_km, service=service)


@router.get("/providers/{provider_id}/profile")
def read_provider_profile(
    provider_id: str,
    x_pomich_provider_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    require_provider_auth(provider_id, x_pomich_provider_token, authorization)
    provider = get_provider_profile(provider_id)
    if provider is None:
        return build_empty_provider_profile_shell(provider_id)
    return provider


@router.patch("/providers/{provider_id}/presence")
def patch_provider_presence(
    provider_id: str,
    payload: dict,
    x_pomich_provider_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    require_provider_auth(provider_id, x_pomich_provider_token, authorization)
    status = str(payload.get("status") or "").strip()
    if status not in {"online", "busy", "offline"}:
        raise HTTPException(status_code=400, detail="provider status must be online, busy or offline")
    try:
        updated = update_provider_presence(provider_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if str(updated.get("status") or "") == "online":
        publish_provider_event(provider_id, "offers.changed", {"source": "presence"})
    return updated


@router.post("/providers/{provider_id}/profile")
@router.patch("/providers/{provider_id}/profile")
def patch_provider_profile(
    provider_id: str,
    payload: dict,
    x_pomich_provider_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    require_provider_auth(provider_id, x_pomich_provider_token, authorization)
    try:
        return update_provider_profile(provider_id, payload)
    except ValueError as exc:
        if str(exc) == "phone_already_registered":
            raise HTTPException(status_code=409, detail="phone_already_registered") from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/providers/{provider_id}/verification/submit")
def provider_submit_verification(
    provider_id: str,
    payload: dict,
    x_pomich_provider_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    require_provider_auth(provider_id, x_pomich_provider_token, authorization)
    try:
        return submit_provider_verification(provider_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/providers/{provider_id}/verification/review")
def provider_review_verification(
    provider_id: str,
    payload: dict,
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    require_admin_auth(x_pomich_admin_token, authorization)
    try:
        reviewed = review_provider_verification(provider_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    status = str(reviewed.get("verificationStatus") or payload.get("status") or "").strip().lower()
    record_ops_event(
        event_type="PROVIDER_VERIFICATION_REVIEWED",
        message=f"Provider verification {status or 'reviewed'}",
        provider_id=provider_id,
        code=status or None,
        source="providers.verification.review",
    )
    if status == "verified":
        try:
            auth_bootstrap = _sync_verified_provider_auth_account(provider_id, reviewed)
        except Exception as exc:  # noqa: BLE001 - review must not disappear behind account bootstrap details
            record_ops_event(
                event_type="AUTH_ACCOUNT_FAILED",
                message=str(exc),
                provider_id=provider_id,
                code="provider_account_bootstrap_failed",
                source="providers.verification.review",
            )
            raise HTTPException(status_code=500, detail="provider_auth_account_bootstrap_failed") from exc
        if auth_bootstrap:
            reviewed = {**reviewed, "authAccountBootstrap": auth_bootstrap}
            if auth_bootstrap.get("created") or auth_bootstrap.get("activated"):
                record_ops_event(
                    event_type="AUTH_ACCOUNT_CREATED" if auth_bootstrap.get("created") else "AUTH_ACCOUNT_ACTIVATED",
                    message="Provider auth account ready after verification",
                    provider_id=provider_id,
                    code=str(auth_bootstrap.get("id") or ""),
                    source="providers.verification.review",
                )
    return reviewed


@router.get("/providers/{provider_id}/orders")
def provider_order_history(
    provider_id: str,
    x_pomich_provider_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
    limit: int = 50,
) -> list[dict]:
    principal = require_provider_auth(provider_id, x_pomich_provider_token, authorization)
    return list_orders_for_provider(principal.subject_id, limit=limit)


@router.get("/providers/{provider_id}/offers")
def provider_offers(
    provider_id: str,
    x_pomich_provider_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> list[dict]:
    require_provider_auth(provider_id, x_pomich_provider_token, authorization)
    return get_provider_offers(provider_id)


@router.post("/providers/{provider_id}/offers/{offer_id}/accept")
def provider_accept_offer(
    provider_id: str,
    offer_id: str,
    payload: dict | None = Body(default=None),
    x_pomich_provider_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    require_provider_auth(provider_id, x_pomich_provider_token, authorization)
    body = payload or {}
    proposed_price = body.get("proposedPrice", body.get("partnerProposedPrice"))
    price_note = body.get("priceNote", body.get("partnerPriceNote"))
    try:
        result = accept_offer(offer_id, provider_id, proposed_price=proposed_price, price_note=price_note)
    except DispatchConflict as exc:
        raise dispatch_conflict(exc) from exc
    order = result.get("order") if isinstance(result, dict) else None
    if isinstance(order, dict):
        notify_order_accepted(order)
        publish_order_event(order, "order.accepted")
    publish_provider_event(provider_id, "offers.changed", {"offerId": offer_id, "action": "accept"})
    return result


@router.post("/offers/{offer_id}/accept")
def accept_offer_legacy(
    offer_id: str,
    payload: dict,
    x_pomich_provider_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    provider_id = str(payload.get("providerId") or "").strip()
    if not provider_id:
        raise HTTPException(status_code=400, detail="providerId missing")
    require_provider_auth(provider_id, x_pomich_provider_token, authorization)
    proposed_price = payload.get("proposedPrice", payload.get("partnerProposedPrice"))
    price_note = payload.get("priceNote", payload.get("partnerPriceNote"))
    try:
        result = accept_offer(offer_id, provider_id, proposed_price=proposed_price, price_note=price_note)
    except DispatchConflict as exc:
        raise dispatch_conflict(exc) from exc
    order = result.get("order") if isinstance(result, dict) else None
    if isinstance(order, dict):
        notify_order_accepted(order)
        publish_order_event(order, "order.accepted")
    publish_provider_event(provider_id, "offers.changed", {"offerId": offer_id, "action": "accept"})
    return result


@router.post("/providers/{provider_id}/offers/{offer_id}/decline")
def provider_decline_offer(
    provider_id: str,
    offer_id: str,
    x_pomich_provider_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    require_provider_auth(provider_id, x_pomich_provider_token, authorization)
    try:
        result = decline_offer(offer_id, provider_id)
    except DispatchConflict as exc:
        raise dispatch_conflict(exc) from exc
    publish_provider_event(provider_id, "offers.changed", {"offerId": offer_id, "action": "decline"})
    return result


@router.post("/offers/{offer_id}/decline")
def decline_offer_legacy(
    offer_id: str,
    payload: dict,
    x_pomich_provider_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    provider_id = str(payload.get("providerId") or "").strip()
    if not provider_id:
        raise HTTPException(status_code=400, detail="providerId missing")
    require_provider_auth(provider_id, x_pomich_provider_token, authorization)
    try:
        result = decline_offer(offer_id, provider_id)
    except DispatchConflict as exc:
        raise dispatch_conflict(exc) from exc
    publish_provider_event(provider_id, "offers.changed", {"offerId": offer_id, "action": "decline"})
    return result
