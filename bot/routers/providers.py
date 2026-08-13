from __future__ import annotations

from fastapi import APIRouter, Body, Header, HTTPException

from bot.api_deps import dispatch_conflict, require_admin_auth, require_provider_auth
from bot.order_store import (
    DispatchConflict,
    accept_offer,
    decline_offer,
    expire_offers,
    get_provider_offers,
    get_provider_profile,
    list_orders_for_provider,
    load_providers,
    nearby_searching_orders,
    review_provider_verification,
    submit_provider_verification,
    update_provider_presence,
    update_provider_profile,
)
from bot.realtime import publish_order_event, publish_provider_event
from bot.telegram_bot import notify_order_accepted

router = APIRouter(tags=["providers"])


@router.get("/providers")
def list_providers(kind: str | None = None) -> list[dict]:
    expire_offers()
    providers = load_providers()
    if kind:
        normalized = kind.strip().lower()
        providers = [provider for provider in providers if str(provider.get("providerKind") or "dispatch").lower() == normalized]
    return providers


@router.get("/map/providers")
def map_providers() -> list[dict]:
    """All providers for map display, including directory listings."""
    return load_providers()


@router.get("/map/orders/nearby")
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


@router.get("/providers/{provider_id}/profile")
def read_provider_profile(
    provider_id: str,
    x_pomich_provider_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    require_provider_auth(provider_id, x_pomich_provider_token, authorization)
    provider = get_provider_profile(provider_id)
    if provider is None:
        raise HTTPException(status_code=404, detail="provider profile not found")
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
        return update_provider_presence(provider_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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
