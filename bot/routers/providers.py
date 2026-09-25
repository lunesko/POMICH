from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Body, Header, HTTPException

from bot.api_deps import (
    dispatch_conflict,
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
from bot.realtime import publish_order_event, publish_provider_event
from bot.runtime_store import sql_map_providers, sql_storage_enabled
from bot.telegram_bot import notify_order_accepted

router = APIRouter(tags=["providers"])

# Public map pins — no phone/telegram/vehicle/exact coords until assignment.
_MAP_MARKER_KEYS = (
    "id",
    "name",
    "city",
    "rating",
    "status",
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
_MAP_COORD_DECIMALS = 3  # ~110 m grid — approximateLocation for privacy


def _approximate_location(provider: dict) -> dict[str, float] | None:
    location = provider.get("location")
    if not isinstance(location, dict):
        return None
    try:
        lat = float(location.get("lat"))
        lng = float(location.get("lng"))
    except (TypeError, ValueError):
        return None
    return {"lat": round(lat, _MAP_COORD_DECIMALS), "lng": round(lng, _MAP_COORD_DECIMALS)}


def public_map_marker(provider: dict) -> dict:
    """Slim public pin — redact contacts and exact coordinates."""
    marker: dict[str, Any] = {}
    for key in _MAP_MARKER_KEYS:
        value = provider.get(key)
        if value is not None:
            marker[key] = value
    approx = _approximate_location(provider)
    if approx is not None:
        marker["approximateLocation"] = approx
        # Keep `location` as the same rounded point so existing map clients keep working.
        marker["location"] = approx
    services = provider.get("specialties")
    if isinstance(services, list) and services:
        marker["services"] = [str(item) for item in services if item]
    return marker


def _provider_kind(provider: dict) -> str:
    return str(provider.get("providerKind") or "dispatch").strip().lower() or "dispatch"


def _parse_bbox(raw: str | None) -> tuple[float, float, float, float] | None:
    if not raw:
        return None
    parts = [part.strip() for part in str(raw).split(",")]
    if len(parts) != 4:
        raise HTTPException(status_code=400, detail="bbox must be minLng,minLat,maxLng,maxLat")
    try:
        min_lng, min_lat, max_lng, max_lat = (float(part) for part in parts)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="bbox values must be numbers") from exc
    if min_lng > max_lng or min_lat > max_lat:
        raise HTTPException(status_code=400, detail="bbox min must be <= max")
    if abs(max_lng - min_lng) > 20 or abs(max_lat - min_lat) > 20:
        raise HTTPException(status_code=400, detail="bbox span too large")
    return (min_lng, min_lat, max_lng, max_lat)


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
    status: str | None = None,
    verification_status: str | None = None,
    bbox: str | None = None,
    zoom: int | None = None,
    service: str | None = None,
) -> list[dict]:
    """Providers for map display; prefer bbox=minLng,minLat,maxLng,maxLat for SQL filtering.

    Public response redacts phone/telegram/vehicle and rounds coordinates.
    Client home should request kind=dispatch&status=online&verification_status=verified.
    """
    normalized_scope = str(scope or "").strip().lower()
    city_key = city.strip() if city and city.strip() else ""
    radius = max(1.0, min(radius_km, 100.0))
    kind_key = str(kind or "").strip().lower()
    status_keys = {
        part.strip().lower()
        for part in str(status or "").split(",")
        if part.strip()
    }
    verification_key = str(verification_status or "").strip().lower()
    service_key = str(service or "").strip().lower()
    parsed_bbox = _parse_bbox(bbox)
    zoom_key = int(zoom) if zoom is not None else ""
    cache_key = (
        f"{normalized_scope}|{city_key}|{lat}|{lng}|{radius}|{kind_key}|{','.join(sorted(status_keys))}|"
        f"{verification_key}|{parsed_bbox}|{zoom_key}|{service_key}"
    )

    def build() -> list[dict]:
        if sql_storage_enabled() and (
            parsed_bbox is not None or status_keys or verification_key or kind_key in {"dispatch", "directory"}
        ):
            providers = sql_map_providers(
                bbox=parsed_bbox,
                kind=kind_key if kind_key in {"dispatch", "directory"} else None,
                status_keys=status_keys or None,
                verification_status=verification_key or None,
                limit=800,
            )
            providers = filter_non_occupied_providers(providers)
        else:
            providers = filter_non_occupied_providers(load_providers())
            if kind_key in {"dispatch", "directory"}:
                providers = [provider for provider in providers if _provider_kind(provider) == kind_key]
            if status_keys:
                providers = [
                    provider
                    for provider in providers
                    if str(provider.get("status") or "").strip().lower() in status_keys
                ]
            if verification_key:
                providers = [
                    provider
                    for provider in providers
                    if str(provider.get("verificationStatus") or "").strip().lower() == verification_key
                ]

        if service_key:
            providers = [
                provider
                for provider in providers
                if service_key in {str(item).strip().lower() for item in (provider.get("specialties") or [])}
            ]

        if parsed_bbox is not None and not sql_storage_enabled():
            min_lng, min_lat, max_lng, max_lat = parsed_bbox
            filtered = []
            for provider in providers:
                location = provider.get("location") if isinstance(provider.get("location"), dict) else {}
                try:
                    plat = float(location.get("lat"))
                    plng = float(location.get("lng"))
                except (TypeError, ValueError):
                    continue
                if min_lat <= plat <= max_lat and min_lng <= plng <= max_lng:
                    filtered.append(provider)
        elif normalized_scope == "all" or parsed_bbox is not None:
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
        return review_provider_verification(provider_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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
