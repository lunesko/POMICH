from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException

from bot.api_deps import (
    optional_customer_auth,
    require_admin_auth,
    require_customer_auth,
    require_customer_auth_linked,
    verify_init_data_or_raise,
)
from bot.order_store import (
    build_user_account_status,
    expire_stale_and_notify,
    get_customer_profile,
    list_orders_for_customer,
    mark_user_role_registered,
    review_customer_verification,
    set_user_preferred_role,
    submit_customer_verification,
    update_customer_profile,
)

router = APIRouter(tags=["customers"])


@router.get("/customers/{customer_id}/profile")
def read_customer_profile(customer_id: str, authorization: str | None = Header(default=None)) -> dict:
    require_customer_auth(customer_id, authorization)
    return get_customer_profile(customer_id)


@router.post("/customers/{customer_id}/profile")
@router.patch("/customers/{customer_id}/profile")
def patch_customer_profile(customer_id: str, payload: dict, authorization: str | None = Header(default=None)) -> dict:
    require_customer_auth(customer_id, authorization)
    try:
        profile = update_customer_profile(customer_id, payload)
    except ValueError as exc:
        if str(exc) == "phone_already_registered":
            raise HTTPException(status_code=409, detail="phone_already_registered") from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if payload.get("name") and payload.get("phone"):
        mark_user_role_registered(customer_id, "customer")
    return profile


@router.get("/users/{customer_id}/account")
def read_user_account(
    customer_id: str,
    authorization: str | None = Header(default=None),
    x_telegram_init_data: str | None = Header(default=None),
) -> dict:
    principal = optional_customer_auth(authorization)
    if principal is not None and principal.subject_id != str(customer_id):
        raise HTTPException(status_code=403, detail="customer_identity_mismatch")
    if principal is None:
        verified = verify_init_data_or_raise(x_telegram_init_data)
        if verified is None:
            raise HTTPException(status_code=401, detail="customer_session_required")
        user = verified.get("user") or {}
        telegram_user_id = str(user.get("id") or "").strip()
        if str(customer_id) != f"tg-{telegram_user_id}":
            raise HTTPException(status_code=403, detail="customer_identity_mismatch")
    return build_user_account_status(customer_id)


@router.patch("/users/{customer_id}/account/role")
def patch_user_preferred_role(customer_id: str, payload: dict, authorization: str | None = Header(default=None)) -> dict:
    require_customer_auth(customer_id, authorization)
    role = str(payload.get("role") or payload.get("preferredRole") or "").strip()
    try:
        return set_user_preferred_role(customer_id, role)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/users/{customer_id}/account/role")
def post_user_preferred_role(customer_id: str, payload: dict, authorization: str | None = Header(default=None)) -> dict:
    return patch_user_preferred_role(customer_id, payload, authorization)


@router.post("/customers/{customer_id}/verification/submit")
def customer_submit_verification(customer_id: str, payload: dict, authorization: str | None = Header(default=None)) -> dict:
    require_customer_auth(customer_id, authorization)
    return submit_customer_verification(customer_id, payload)


@router.patch("/customers/{customer_id}/verification/review")
def customer_review_verification(
    customer_id: str,
    payload: dict,
    x_pomich_admin_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> dict:
    require_admin_auth(x_pomich_admin_token, authorization)
    try:
        return review_customer_verification(customer_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/customers/{customer_id}/orders")
def customer_order_history(
    customer_id: str,
    authorization: str | None = Header(default=None),
    limit: int = 50,
) -> list[dict]:
    require_customer_auth_linked(customer_id, authorization)
    expire_stale_and_notify()
    return list_orders_for_customer(customer_id, limit=limit)
