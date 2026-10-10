from __future__ import annotations

import math

from fastapi import APIRouter, Body, Header, HTTPException

from bot.api_deps import (
    apply_verified_telegram_identity,
    dispatch_conflict,
    extract_bearer_token,
    optional_customer_auth,
    require_admin_auth,
    require_customer_auth,
    require_customer_auth_from_bearer,
    require_order_customer_owner,
    require_order_owner_or_admin,
    require_order_participant_auth,
    require_provider_auth,
    verify_init_data_or_raise,
)
from bot.occupied_territories import is_occupied_coordinates, occupied_zone_name
from bot.order_store import (
    DispatchConflict,
    InvalidStatusTransition,
    attach_dispatch_to_order,
    attach_dispatch_to_orders,
    confirm_order_price,
    dispatch_order,
    expire_stale_and_notify,
    get_order,
    load_offers,
    load_orders,
    normalize_order_status,
    save_order,
    submit_order_review,
    update_order_status,
    update_provider_order_status,
)
from bot.realtime import publish_order_event, publish_provider_event
from bot.runtime_store import OrderIdConflict
from bot.telegram_bot import notify_dispatch_offers, notify_order_cancelled, notify_order_created
from bot.ops_log import record_ops_event
from bot.service_details import ServiceDetailsValidationError, validate_service_details

router = APIRouter(tags=["orders"])

# Client must not set lifecycle / ownership / dispatch fields on create (F01/F02).
_CLIENT_FORBIDDEN_ORDER_FIELDS = frozenset(
    {
        "id",
        "status",
        "statusHistory",
        "dispatchEvents",
        "dispatchState",
        "dispatchInfo",
        "assignedProviderId",
        "partnerId",
        "partnerProposedPrice",
        "priceConfirmedAt",
        "priceConfirmedBy",
        "acceptedAt",
        "completedAt",
        "cancelledAt",
        "createdAt",
        "updatedAt",
        "version",
        "history",
        "offers",
        "etaMinutes",
        "earnings",
    }
)
_ALLOWED_CREATE_SOURCES = frozenset({"web", "telegram-mini-app"})


def _finite_coord(value: object) -> float:
    try:
        number = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError) as exc:
        raise ValueError("invalid") from exc
    if not math.isfinite(number):
        raise ValueError("non_finite")
    return number


def _strip_server_owned_order_fields(payload: dict) -> dict:
    cleaned = dict(payload)
    for key in _CLIENT_FORBIDDEN_ORDER_FIELDS:
        cleaned.pop(key, None)
    return cleaned


@router.get("/orders")
def list_orders(
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> list[dict]:
    require_admin_auth(x_pomich_admin_token, authorization)
    expire_stale_and_notify()
    return attach_dispatch_to_orders(load_orders(), load_offers())


@router.post("/orders", status_code=201)
def create_order(payload: dict, authorization: str | None = Header(default=None)) -> dict:
    payload = _strip_server_owned_order_fields(dict(payload or {}))
    source_hint = str(payload.get("source") or "").strip().lower()
    init_data = payload.pop("telegramInitData", None)
    customer_principal = optional_customer_auth(authorization)
    if customer_principal is not None:
        supplied_customer_id = payload.get("customerId")
        if supplied_customer_id is not None and str(supplied_customer_id) != customer_principal.subject_id:
            raise HTTPException(status_code=403, detail="customer_identity_mismatch")
        payload["customerId"] = customer_principal.subject_id

    verified_telegram = None
    wants_telegram = source_hint == "telegram-mini-app" or bool(init_data)
    if wants_telegram:
        verified_telegram = verify_init_data_or_raise(init_data)
        # When Telegram bots are not configured, verify_init_data_or_raise returns None
        # without checking initData — require a customer bearer so anonymous clients
        # cannot create orders under an attacker-chosen customerId.
        if verified_telegram is None:
            if customer_principal is None:
                raise HTTPException(status_code=401, detail="customer_session_required")
            payload["customerId"] = customer_principal.subject_id
            payload["customerIdentity"] = {"type": "guest", "customerId": customer_principal.subject_id}
        else:
            user = verified_telegram.get("user") or {}
            supplied_telegram_id = payload.get("telegramUserId") or payload.get("chatId")
            if user.get("id") and supplied_telegram_id is not None and str(supplied_telegram_id) != str(user.get("id")):
                raise HTTPException(status_code=401, detail="telegram_user_mismatch")
            apply_verified_telegram_identity(payload, verified_telegram)
            if customer_principal is not None and payload.get("customerId") != customer_principal.subject_id:
                # Guest web session + verified Telegram Mini App: upgrade to tg-* owner.
                guest_upgrade = str(customer_principal.subject_id).startswith("guest-") and str(
                    payload.get("customerId") or ""
                ).startswith("tg-")
                if not guest_upgrade:
                    raise HTTPException(status_code=403, detail="customer_identity_mismatch")
    elif customer_principal is None:
        raise HTTPException(status_code=401, detail="customer_session_required")
    else:
        payload["customerIdentity"] = {"type": "guest", "customerId": customer_principal.subject_id}

    # Channel source is derived from auth, not used as a validation bypass switch (F02).
    if verified_telegram is not None:
        source = "telegram-mini-app"
    elif source_hint in _ALLOWED_CREATE_SOURCES:
        source = source_hint
    else:
        source = "web"
    payload["source"] = source
    payload["status"] = "searching"

    service = str(payload.get("service") or "").strip().lower()
    payload["service"] = service
    try:
        payload["serviceDetails"] = validate_service_details(service, payload.get("serviceDetails"))
    except ServiceDetailsValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    pickup_value = payload.get("customerCoordinates")
    if not isinstance(pickup_value, dict):
        raise HTTPException(status_code=422, detail="customer_coordinates_required")
    try:
        pickup_lat = _finite_coord(pickup_value.get("lat"))
        pickup_lng = _finite_coord(pickup_value.get("lng"))
    except ValueError:
        raise HTTPException(status_code=422, detail="customer_coordinates_invalid")
    if not (44.0 <= pickup_lat <= 52.5 and 22.0 <= pickup_lng <= 40.5):
        raise HTTPException(status_code=422, detail="service_area_ukraine_only")
    payload["customerCoordinates"] = {"lat": pickup_lat, "lng": pickup_lng}

    if service == "tow":
        destination_value = payload.get("destinationCoordinates")
        if not isinstance(destination_value, dict):
            raise HTTPException(status_code=422, detail="destination_coordinates_required")
        try:
            destination_lat = _finite_coord(destination_value.get("lat"))
            destination_lng = _finite_coord(destination_value.get("lng"))
        except ValueError:
            raise HTTPException(status_code=422, detail="destination_coordinates_invalid")
        if abs(destination_lat - pickup_lat) < 0.0001 and abs(destination_lng - pickup_lng) < 0.0001:
            raise HTTPException(status_code=422, detail="destination_must_differ_from_pickup")
        payload["destinationCoordinates"] = {"lat": destination_lat, "lng": destination_lng}

    pickup = payload.get("customerCoordinates")
    if isinstance(pickup, dict):
        plat = pickup.get("lat")
        plng = pickup.get("lng")
        if is_occupied_coordinates(plat, plng):
            zone = occupied_zone_name(plat, plng) or "occupied"
            record_ops_event(
                event_type="GEO_REJECTED",
                message=f"Order pickup in occupied zone: {zone}",
                code="occupied_pickup",
                source="orders.create",
                extra={"zone": zone},
            )
            raise HTTPException(status_code=400, detail=f"order_location_in_{zone}")

    destination = payload.get("destinationCoordinates")
    if isinstance(destination, dict):
        dlat = destination.get("lat")
        dlng = destination.get("lng")
        if is_occupied_coordinates(dlat, dlng):
            zone = occupied_zone_name(dlat, dlng) or "occupied"
            record_ops_event(
                event_type="GEO_REJECTED",
                message=f"Order destination in occupied zone: {zone}",
                code="occupied_destination",
                source="orders.create",
                extra={"zone": zone},
            )
            raise HTTPException(status_code=400, detail=f"destination_in_{zone}")

    try:
        order = save_order(payload, create_only=True)
    except OrderIdConflict as exc:
        raise HTTPException(status_code=409, detail="order_id_conflict") from exc

    if order.get("status") == "searching":
        dispatched = dispatch_order(str(order.get("id")))
        if dispatched is not None:
            order = dispatched
            pending_offers = [
                offer
                for offer in load_offers()
                if str(offer.get("orderId") or "") == str(order.get("id")) and str(offer.get("status") or "") == "pending"
            ]
            for offer in pending_offers:
                publish_provider_event(str(offer.get("providerId") or ""), "offers.changed", {"orderId": order.get("id")})
            notify_dispatch_offers(order, pending_offers)

    if payload.get("notify") and payload.get("chatId"):
        notify_order_created(str(payload.get("chatId")), order)

    publish_order_event(order, "order.created")
    return order


@router.get("/orders/{order_id}")
def read_order(
    order_id: str,
    authorization: str | None = Header(default=None),
    x_pomich_admin_token: str | None = Header(default=None),
) -> dict:
    # Auth before existence check so anonymous clients cannot probe order ids.
    if not extract_bearer_token(authorization):
        record_ops_event(
            event_type="AUTH_DENIED",
            message="Unauthenticated order read",
            order_id=order_id,
            code="auth_session_required",
            source="orders.read",
        )
        raise HTTPException(status_code=401, detail="auth_session_required")
    expire_stale_and_notify()
    order = get_order(order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="order not found")
    require_order_participant_auth(order, authorization, x_pomich_admin_token=x_pomich_admin_token)
    return attach_dispatch_to_order(order, load_offers())


@router.post("/orders/{order_id}/reviews")
def create_order_review(
    order_id: str,
    payload: dict = Body(default=None),
    authorization: str | None = Header(default=None),
    x_pomich_provider_token: str | None = Header(default=None),
) -> dict:
    body = payload or {}
    role = str(body.get("role") or body.get("authorRole") or "").strip().lower()
    rating = body.get("rating", body.get("stars"))
    comment = str(body.get("comment") or body.get("text") or "").strip()
    author_id = str(body.get("authorId") or "").strip()

    if role == "customer":
        if not author_id:
            principal = optional_customer_auth(authorization)
            if principal is None:
                raise HTTPException(status_code=401, detail="customer_session_required")
            author_id = principal.subject_id
        else:
            require_customer_auth(author_id, authorization)
    elif role == "partner":
        provider_id = author_id or str(body.get("providerId") or "").strip()
        if not provider_id:
            raise HTTPException(status_code=400, detail="providerId missing")
        require_provider_auth(provider_id, x_pomich_provider_token, authorization)
        author_id = provider_id
    else:
        raise HTTPException(status_code=400, detail="invalid_review_role")

    try:
        result = submit_order_review(
            order_id,
            author_role=role,
            rating=rating,
            comment=comment,
            author_id=author_id,
        )
        publish_order_event(result if isinstance(result, dict) else None, "order.reviewed")
        return result
    except DispatchConflict as exc:
        if exc.code == "REVIEW_ALREADY_SUBMITTED":
            existing = get_order(order_id)
            if existing is not None:
                return existing
        record_ops_event(
            event_type="REVIEW_FAILED",
            message=exc.message,
            order_id=order_id,
            provider_id=author_id if role == "partner" else None,
            customer_id=author_id if role == "customer" else None,
            code=exc.code,
            source="orders.reviews",
        )
        raise dispatch_conflict(exc) from exc
    except ValueError as exc:
        record_ops_event(
            event_type="REVIEW_FAILED",
            message=str(exc),
            order_id=order_id,
            code="invalid_review",
            source="orders.reviews",
        )
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/orders/{order_id}/dispatch/retry")
def retry_order_dispatch(
    order_id: str,
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    if not extract_bearer_token(authorization):
        raise HTTPException(status_code=401, detail="auth_session_required")
    existing = get_order(order_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="order not found")
    require_order_owner_or_admin(existing, authorization, x_pomich_admin_token)
    try:
        order = dispatch_order(order_id, reset_auto_retry=True)
    except Exception as exc:  # noqa: BLE001 - surface as ops breadcrumb then re-raise shaped errors
        record_ops_event(
            event_type="DISPATCH_FAILED",
            message=str(exc),
            order_id=order_id,
            source="orders.dispatch.retry",
        )
        raise
    if order is None:
        record_ops_event(
            event_type="DISPATCH_FAILED",
            message="order not found",
            order_id=order_id,
            code="ORDER_NOT_FOUND",
            source="orders.dispatch.retry",
        )
        raise HTTPException(status_code=404, detail="order not found")
    publish_order_event(order, "order.dispatched")
    pending_offers = [
        offer
        for offer in load_offers()
        if str(offer.get("orderId") or "") == str(order.get("id")) and str(offer.get("status") or "") == "pending"
    ]
    for offer in pending_offers:
        publish_provider_event(str(offer.get("providerId") or ""), "offers.changed", {"orderId": order.get("id")})
    notify_dispatch_offers(order, pending_offers)
    record_ops_event(
        event_type="DISPATCH_RETRY",
        message=f"Повторний dispatch · офферів {len(pending_offers)}",
        order_id=order_id,
        source="orders.dispatch.retry",
        extra={"offersSent": len(pending_offers)},
    )
    return order


@router.post("/orders/{order_id}/confirm-price")
def confirm_order_price_endpoint(order_id: str, authorization: str | None = Header(default=None)) -> dict:
    require_customer_auth_from_bearer(authorization)
    existing = get_order(order_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="order not found")
    require_order_customer_owner(existing, authorization)
    try:
        order = confirm_order_price(order_id)
    except DispatchConflict as exc:
        raise dispatch_conflict(exc) from exc
    publish_order_event(order, "order.price_confirmed")
    return order


@router.patch("/providers/{provider_id}/orders/{order_id}/status")
def provider_patch_order_status(
    provider_id: str,
    order_id: str,
    payload: dict,
    x_pomich_provider_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    require_provider_auth(provider_id, x_pomich_provider_token, authorization)
    status = str(payload.get("status") or "").strip()
    if not status:
        raise HTTPException(status_code=400, detail="status missing")
    try:
        order = update_provider_order_status(provider_id, order_id, status)
    except (DispatchConflict, InvalidStatusTransition, ValueError) as exc:
        code = getattr(exc, "code", None) or "status_transition"
        record_ops_event(
            event_type="STATUS_UPDATE_FAILED",
            message=str(exc),
            order_id=order_id,
            provider_id=provider_id,
            code=str(code),
            source="providers.orders.status",
            extra={"targetStatus": status},
        )
        if isinstance(exc, DispatchConflict):
            raise dispatch_conflict(exc) from exc
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    normalized = normalize_order_status(order.get("status"))
    if normalized in {"completed", "cancelled"}:
        publish_provider_event(provider_id, "offers.changed", {"orderId": order_id, "action": "terminal"})
    if normalized == "cancelled":
        notify_order_cancelled(order)
        publish_order_event(order, "order.cancelled")
    else:
        publish_order_event(order, "order.status")
    return order


@router.post("/orders/{order_id}/cancel")
def cancel_order(
    order_id: str,
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    if not extract_bearer_token(authorization):
        raise HTTPException(status_code=401, detail="auth_session_required")
    existing = get_order(order_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="order not found")
    require_order_owner_or_admin(existing, authorization, x_pomich_admin_token)
    try:
        order = update_order_status(order_id, "cancelled")
    except (InvalidStatusTransition, ValueError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if order is None:
        raise HTTPException(status_code=404, detail="order not found")
    payload = attach_dispatch_to_order(order, load_offers())
    notify_order_cancelled(payload)
    publish_order_event(payload, "order.cancelled")
    return payload


@router.patch("/orders/{order_id}/status")
def patch_order_status(
    order_id: str,
    payload: dict,
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    require_admin_auth(x_pomich_admin_token, authorization)
    status = str(payload.get("status") or "").strip()
    if not status:
        raise HTTPException(status_code=400, detail="status missing")

    try:
        order = update_order_status(order_id, status)
    except (InvalidStatusTransition, ValueError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if order is None:
        raise HTTPException(status_code=404, detail="order not found")
    result = attach_dispatch_to_order(order, load_offers())
    if normalize_order_status(result.get("status")) == "cancelled":
        notify_order_cancelled(result)
        publish_order_event(result, "order.cancelled")
    else:
        publish_order_event(result, "order.status")
    return result
