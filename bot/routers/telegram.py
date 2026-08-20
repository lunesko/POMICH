from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException

from bot.api_deps import require_telegram_webhook_secret, verify_init_data_or_raise
from bot.order_store import get_telegram_session, upsert_telegram_customer_profile
from bot.telegram_bot import handle_update
from bot.telegram_config import TelegramBotKind, normalize_telegram_bot_kind

router = APIRouter(tags=["telegram"])


def _webhook_for_kind(
    payload: dict,
    bot_kind: TelegramBotKind,
    *,
    x_telegram_bot_api_secret_token: str | None,
) -> dict:
    require_telegram_webhook_secret(x_telegram_bot_api_secret_token, bot_kind=bot_kind)
    result = handle_update(payload, bot_kind=bot_kind)
    if not result.get("handled"):
        raise HTTPException(status_code=400, detail="chat_id missing")
    return {"ok": True, "result": result, "botKind": bot_kind}


@router.get("/telegram/session/{chat_id}")
def telegram_session(
    chat_id: str,
    x_telegram_init_data: str | None = Header(default=None),
    x_pomich_telegram_bot: str | None = Header(default=None),
) -> dict:
    verified = verify_init_data_or_raise(x_telegram_init_data, x_pomich_telegram_bot)
    user = (verified or {}).get("user") or {}
    if user.get("id") and str(user.get("id")) != str(chat_id):
        raise HTTPException(status_code=401, detail="telegram_user_mismatch")

    session = get_telegram_session(chat_id) or {"chatId": chat_id}
    bot_kind = normalize_telegram_bot_kind((verified or {}).get("botKind")) or normalize_telegram_bot_kind(x_pomich_telegram_bot)
    if user.get("id"):
        profile = upsert_telegram_customer_profile(user, bot_kind=bot_kind)
        return {
            **session,
            "chatId": chat_id,
            "customerId": profile.get("id"),
            "profile": profile,
            "customerIdentity": profile.get("customerIdentity"),
            "telegramBotKind": bot_kind,
        }
    return session


@router.post("/telegram/customer/webhook")
def telegram_customer_webhook(
    payload: dict,
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
) -> dict:
    return _webhook_for_kind(payload, "customer", x_telegram_bot_api_secret_token=x_telegram_bot_api_secret_token)


@router.post("/telegram/provider/webhook")
def telegram_provider_webhook(
    payload: dict,
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
) -> dict:
    return _webhook_for_kind(payload, "provider", x_telegram_bot_api_secret_token=x_telegram_bot_api_secret_token)


@router.post("/telegram/webhook")
def telegram_webhook(
    payload: dict,
    x_telegram_bot_api_secret_token: str | None = Header(default=None),
) -> dict:
    """Legacy single webhook — routes to the customer bot handler for compatibility."""
    return _webhook_for_kind(payload, "customer", x_telegram_bot_api_secret_token=x_telegram_bot_api_secret_token)
