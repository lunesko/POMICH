from __future__ import annotations

from fastapi import APIRouter, Body, Header, HTTPException

from bot.api_deps import (
    apply_verified_telegram_identity,
    dispatch_conflict,
    optional_customer_auth,
    require_admin_auth,
    require_customer_auth,
    require_provider_auth,
    verify_init_data_or_raise,
)
from bot.order_store import (
    DispatchConflict,
    InvalidStatusTransition,
    attach_dispatch_to_order,
    attach_dispatch_to_orders,
    confirm_order_price,
    dispatch_order,
    expire_offers,
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
from bot.telegram_bot import notify_order_cancelled, notify_order_created

router = APIRouter(tags=["orders"])


@router.get("/orders")
def list_orders(
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> list[dict]:
    require_admin_auth(x_pomich_admin_token, authorization)
    return attach_dispatch_to_orders(load_orders(), load_offers())


@router.post("/orders", status_code=201)
def create_order(payload: dict, authorization: str | None = Header(default=None)) -> dict:
    source = payload.get("source")
    init_data = payload.pop("telegramInitData", None)
    customer_principal = optional_customer_auth(authorization)
    if customer_principal is not None:
        supplied_customer_id = payload.get("customerId")
        if supplied_customer_id is not None and str(supplied_customer_id) != customer_principal.subject_id:
            raise HTTPException(status_code=403, detail="customer_identity_mismatch")
        payload["customerId"] = customer_principal.subject_id

    verified_telegram = None
    if source == "telegram-mini-app":
        verified_telegram = verify_init_data_or_raise(init_data)
        user = (verified_telegram or {}).get("user") or {}
        supplied_telegram_id = payload.get("telegramUserId") or payload.get("chatId")
        if user.get("id") and supplied_telegram_id is not None and str(supplied_telegram_id) != str(user.get("id")):
            raise HTTPException(status_code=401, detail="telegram_user_mismatch")
        apply_verified_telegram_identity(payload, verified_telegram)
        if customer_principal is not None and payload.get("customerId") != customer_principal.subject_id:
            raise HTTPException(status_code=403, detail="customer_identity_mismatch")
    elif customer_principal is not None:
        payload["customerIdentity"] = {"type": "guest", "customerId": customer_principal.subject_id}

    order = save_order(payload)
    if order.get("status") == "searching":
        dispatched = dispatch_order(str(order.get("id")))
        if dispatched is not None:
            order = dispatched
            for offer in load_offers():
                if str(offer.get("orderId") or "") == str(order.get("id")) and str(offer.get("status") or "") == "pending":
                    publish_provider_event(str(offer.get("providerId") or ""), "offers.changed", {"orderId": order.get("id")})

    if payload.get("notify") and payload.get("chatId"):
        notify_order_created(str(payload.get("chatId")), order)

    publish_order_event(order, "order.created")
    return order


@router.get("/orders/{order_id}")
def read_order(order_id: str) -> dict:
    expire_offers()
    order = get_order(order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="order not found")
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
        raise dispatch_conflict(exc) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/orders/{order_id}/dispatch/retry")
def retry_order_dispatch(order_id: str) -> dict:
    order = dispatch_order(order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="order not found")
    publish_order_event(order, "order.dispatched")
    for offer in load_offers():
        if str(offer.get("orderId") or "") == str(order.get("id")) and str(offer.get("status") or "") == "pending":
            publish_provider_event(str(offer.get("providerId") or ""), "offers.changed", {"orderId": order.get("id")})
    return order


@router.post("/orders/{order_id}/confirm-price")
def confirm_order_price_endpoint(order_id: str) -> dict:
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
        if isinstance(exc, DispatchConflict):
            raise dispatch_conflict(exc) from exc
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    publish_order_event(order, "order.status")
    return order


@router.post("/orders/{order_id}/cancel")
def cancel_order(order_id: str) -> dict:
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
