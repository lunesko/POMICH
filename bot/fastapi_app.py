import os
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from bot.order_store import (
    DispatchConflict,
    InvalidStatusTransition,
    accept_offer,
    attach_dispatch_to_order,
    attach_dispatch_to_orders,
    decline_offer,
    dispatch_order,
    expire_offers,
    get_customer_profile,
    get_order,
    get_provider_profile,
    get_provider_offers,
    get_telegram_session,
    invalidate_order_offers,
    load_offers,
    load_orders,
    load_providers,
    review_customer_verification,
    review_provider_verification,
    save_order,
    submit_customer_verification,
    submit_provider_verification,
    update_customer_profile,
    update_order_status,
    update_provider_order_status,
    update_provider_presence,
    update_provider_profile,
)
from bot.telegram_auth import verify_telegram_init_data
from bot.telegram_bot import get_configured_token, handle_update, notify_order_created

app = FastAPI(title="POMICH MVP", version="0.1.0")
DIST_DIR = Path(__file__).resolve().parent.parent / "dist"
ASSETS_DIR = DIST_DIR / "assets"

def _get_cors_origins() -> list[str]:
    raw_origins = os.getenv("POMICH_CORS_ORIGINS", "*")
    origins = [origin.strip() for origin in raw_origins.split(",") if origin.strip()]
    return origins or ["*"]


app.add_middleware(
    CORSMiddleware,
    allow_origins=_get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "protocol": "fastapi"}


def _verify_init_data_or_raise(init_data: str | None) -> dict | None:
    token = get_configured_token()
    if not token:
        return None

    if not init_data:
        raise HTTPException(status_code=401, detail="telegram_init_data_missing")

    try:
        return verify_telegram_init_data(init_data, token)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc


def _require_admin_token(token: str | None) -> None:
    expected_token = os.getenv("POMICH_ADMIN_TOKEN")
    if not expected_token:
        raise HTTPException(status_code=403, detail="admin_auth_not_configured")
    if token != expected_token:
        raise HTTPException(status_code=401, detail="admin_token_invalid")


def _require_provider_token(token: str | None) -> None:
    expected_token = os.getenv("POMICH_PROVIDER_TOKEN")
    if not expected_token:
        return
    if token != expected_token:
        raise HTTPException(status_code=401, detail="provider_token_invalid")


def _dispatch_conflict(exc: DispatchConflict) -> HTTPException:
    return HTTPException(status_code=409, detail={"code": exc.code, "message": exc.message})


@app.get("/orders")
@app.get("/api/orders")
def list_orders(x_pomich_admin_token: str | None = Header(default=None)) -> list[dict]:
    _require_admin_token(x_pomich_admin_token)
    return attach_dispatch_to_orders(load_orders(), load_offers())


@app.get("/providers")
@app.get("/api/providers")
def list_providers() -> list[dict]:
    expire_offers()
    return load_providers()


@app.get("/customers/{customer_id}/profile")
@app.get("/api/customers/{customer_id}/profile")
def read_customer_profile(customer_id: str) -> dict:
    return get_customer_profile(customer_id)


@app.post("/customers/{customer_id}/profile")
@app.post("/api/customers/{customer_id}/profile")
@app.patch("/customers/{customer_id}/profile")
@app.patch("/api/customers/{customer_id}/profile")
def patch_customer_profile(customer_id: str, payload: dict) -> dict:
    return update_customer_profile(customer_id, payload)


@app.post("/customers/{customer_id}/verification/submit")
@app.post("/api/customers/{customer_id}/verification/submit")
def customer_submit_verification(customer_id: str, payload: dict) -> dict:
    return submit_customer_verification(customer_id, payload)


@app.patch("/customers/{customer_id}/verification/review")
@app.patch("/api/customers/{customer_id}/verification/review")
def customer_review_verification(customer_id: str, payload: dict, x_pomich_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin_token(x_pomich_admin_token)
    try:
        return review_customer_verification(customer_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/providers/{provider_id}/profile")
@app.get("/api/providers/{provider_id}/profile")
def read_provider_profile(provider_id: str, x_pomich_provider_token: str | None = Header(default=None)) -> dict:
    _require_provider_token(x_pomich_provider_token)
    provider = get_provider_profile(provider_id)
    if provider is None:
        raise HTTPException(status_code=404, detail="provider profile not found")
    return provider


@app.patch("/providers/{provider_id}/presence")
@app.patch("/api/providers/{provider_id}/presence")
def patch_provider_presence(provider_id: str, payload: dict, x_pomich_provider_token: str | None = Header(default=None)) -> dict:
    _require_provider_token(x_pomich_provider_token)
    status = str(payload.get("status") or "").strip()
    if status not in {"online", "busy", "offline"}:
        raise HTTPException(status_code=400, detail="provider status must be online, busy or offline")
    try:
        return update_provider_presence(provider_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/providers/{provider_id}/profile")
@app.post("/api/providers/{provider_id}/profile")
@app.patch("/providers/{provider_id}/profile")
@app.patch("/api/providers/{provider_id}/profile")
def patch_provider_profile(provider_id: str, payload: dict, x_pomich_provider_token: str | None = Header(default=None)) -> dict:
    _require_provider_token(x_pomich_provider_token)
    try:
        return update_provider_profile(provider_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/providers/{provider_id}/verification/submit")
@app.post("/api/providers/{provider_id}/verification/submit")
def provider_submit_verification(provider_id: str, payload: dict, x_pomich_provider_token: str | None = Header(default=None)) -> dict:
    _require_provider_token(x_pomich_provider_token)
    try:
        return submit_provider_verification(provider_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.patch("/providers/{provider_id}/verification/review")
@app.patch("/api/providers/{provider_id}/verification/review")
def provider_review_verification(provider_id: str, payload: dict, x_pomich_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin_token(x_pomich_admin_token)
    try:
        return review_provider_verification(provider_id, payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/orders", status_code=201)
@app.post("/api/orders", status_code=201)
def create_order(payload: dict) -> dict:
    source = payload.get("source")
    init_data = payload.pop("telegramInitData", None)
    verified_telegram = None
    if source == "telegram-mini-app":
        verified_telegram = _verify_init_data_or_raise(init_data)
        user = (verified_telegram or {}).get("user") or {}
        if user.get("id") and str(payload.get("telegramUserId") or payload.get("chatId")) != str(user.get("id")):
            raise HTTPException(status_code=401, detail="telegram_user_mismatch")

    order = save_order(payload)
    if order.get("status") == "searching":
        dispatched = dispatch_order(str(order.get("id")))
        if dispatched is not None:
            order = dispatched

    if payload.get("notify") and payload.get("chatId"):
        notify_order_created(str(payload.get("chatId")), order)

    return order


@app.get("/orders/{order_id}")
@app.get("/api/orders/{order_id}")
def read_order(order_id: str) -> dict:
    expire_offers()
    order = get_order(order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="order not found")
    return attach_dispatch_to_order(order, load_offers())


@app.post("/orders/{order_id}/dispatch/retry")
@app.post("/api/orders/{order_id}/dispatch/retry")
def retry_order_dispatch(order_id: str) -> dict:
    order = dispatch_order(order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="order not found")
    return order


@app.get("/providers/{provider_id}/offers")
@app.get("/api/providers/{provider_id}/offers")
def provider_offers(provider_id: str, x_pomich_provider_token: str | None = Header(default=None)) -> list[dict]:
    _require_provider_token(x_pomich_provider_token)
    return get_provider_offers(provider_id)


@app.post("/providers/{provider_id}/offers/{offer_id}/accept")
@app.post("/api/providers/{provider_id}/offers/{offer_id}/accept")
def provider_accept_offer(provider_id: str, offer_id: str, x_pomich_provider_token: str | None = Header(default=None)) -> dict:
    _require_provider_token(x_pomich_provider_token)
    try:
        return accept_offer(offer_id, provider_id)
    except DispatchConflict as exc:
        raise _dispatch_conflict(exc) from exc


@app.post("/offers/{offer_id}/accept")
@app.post("/api/offers/{offer_id}/accept")
def accept_offer_legacy(offer_id: str, payload: dict, x_pomich_provider_token: str | None = Header(default=None)) -> dict:
    _require_provider_token(x_pomich_provider_token)
    provider_id = str(payload.get("providerId") or "").strip()
    if not provider_id:
        raise HTTPException(status_code=400, detail="providerId missing")
    try:
        return accept_offer(offer_id, provider_id)
    except DispatchConflict as exc:
        raise _dispatch_conflict(exc) from exc


@app.post("/providers/{provider_id}/offers/{offer_id}/decline")
@app.post("/api/providers/{provider_id}/offers/{offer_id}/decline")
def provider_decline_offer(provider_id: str, offer_id: str, x_pomich_provider_token: str | None = Header(default=None)) -> dict:
    _require_provider_token(x_pomich_provider_token)
    try:
        return decline_offer(offer_id, provider_id)
    except DispatchConflict as exc:
        raise _dispatch_conflict(exc) from exc


@app.post("/offers/{offer_id}/decline")
@app.post("/api/offers/{offer_id}/decline")
def decline_offer_legacy(offer_id: str, payload: dict, x_pomich_provider_token: str | None = Header(default=None)) -> dict:
    _require_provider_token(x_pomich_provider_token)
    provider_id = str(payload.get("providerId") or "").strip()
    if not provider_id:
        raise HTTPException(status_code=400, detail="providerId missing")
    try:
        return decline_offer(offer_id, provider_id)
    except DispatchConflict as exc:
        raise _dispatch_conflict(exc) from exc


@app.patch("/providers/{provider_id}/orders/{order_id}/status")
@app.patch("/api/providers/{provider_id}/orders/{order_id}/status")
def provider_patch_order_status(provider_id: str, order_id: str, payload: dict, x_pomich_provider_token: str | None = Header(default=None)) -> dict:
    _require_provider_token(x_pomich_provider_token)
    status = str(payload.get("status") or "").strip()
    if not status:
        raise HTTPException(status_code=400, detail="status missing")
    try:
        return update_provider_order_status(provider_id, order_id, status)
    except (DispatchConflict, InvalidStatusTransition, ValueError) as exc:
        if isinstance(exc, DispatchConflict):
            raise _dispatch_conflict(exc) from exc
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@app.post("/orders/{order_id}/cancel")
@app.post("/api/orders/{order_id}/cancel")
def cancel_order(order_id: str) -> dict:
    try:
        order = update_order_status(order_id, "cancelled")
    except (InvalidStatusTransition, ValueError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if order is None:
        raise HTTPException(status_code=404, detail="order not found")
    return attach_dispatch_to_order(order, load_offers())


@app.patch("/orders/{order_id}/status")
@app.patch("/api/orders/{order_id}/status")
def patch_order_status(order_id: str, payload: dict, x_pomich_admin_token: str | None = Header(default=None)) -> dict:
    _require_admin_token(x_pomich_admin_token)
    status = str(payload.get("status") or "").strip()
    if not status:
        raise HTTPException(status_code=400, detail="status missing")

    try:
        order = update_order_status(order_id, status)
    except (InvalidStatusTransition, ValueError) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if order is None:
        raise HTTPException(status_code=404, detail="order not found")
    return attach_dispatch_to_order(order, load_offers())


@app.get("/telegram/session/{chat_id}")
@app.get("/api/telegram/session/{chat_id}")
def telegram_session(chat_id: str, x_telegram_init_data: str | None = Header(default=None)) -> dict:
    verified = _verify_init_data_or_raise(x_telegram_init_data)
    user = (verified or {}).get("user") or {}
    if user.get("id") and str(user.get("id")) != str(chat_id):
        raise HTTPException(status_code=401, detail="telegram_user_mismatch")

    return get_telegram_session(chat_id) or {"chatId": chat_id}


@app.post("/telegram/webhook")
@app.post("/api/telegram/webhook")
def telegram_webhook(payload: dict) -> dict:
    result = handle_update(payload)

    if not result.get("handled"):
        raise HTTPException(status_code=400, detail="chat_id missing")

    return {"ok": True, "result": result}


if ASSETS_DIR.exists():
    app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")


@app.get("/robots.txt")
def robots_txt():
    robots_path = DIST_DIR / "robots.txt"
    if robots_path.exists():
        return FileResponse(robots_path, media_type="text/plain")
    return {"detail": "robots.txt not built"}


@app.get("/")
@app.get("/{full_path:path}")
def serve_frontend(full_path: str = ""):
    index_path = DIST_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return {"detail": "Frontend build is missing. Run npm run build first."}
