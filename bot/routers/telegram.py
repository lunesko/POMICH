from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException

from bot.api_deps import verify_init_data_or_raise
from bot.order_store import get_telegram_session, upsert_telegram_customer_profile
from bot.telegram_bot import handle_update

router = APIRouter(tags=["telegram"])


@router.get("/telegram/session/{chat_id}")
def telegram_session(chat_id: str, x_telegram_init_data: str | None = Header(default=None)) -> dict:
    verified = verify_init_data_or_raise(x_telegram_init_data)
    user = (verified or {}).get("user") or {}
    if user.get("id") and str(user.get("id")) != str(chat_id):
        raise HTTPException(status_code=401, detail="telegram_user_mismatch")

    session = get_telegram_session(chat_id) or {"chatId": chat_id}
    if user.get("id"):
        profile = upsert_telegram_customer_profile(user)
        return {
            **session,
            "chatId": chat_id,
            "customerId": profile.get("id"),
            "profile": profile,
            "customerIdentity": profile.get("customerIdentity"),
        }
    return session


@router.post("/telegram/webhook")
def telegram_webhook(payload: dict) -> dict:
    result = handle_update(payload)

    if not result.get("handled"):
        raise HTTPException(status_code=400, detail="chat_id missing")

    return {"ok": True, "result": result}
