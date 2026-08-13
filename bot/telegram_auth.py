from __future__ import annotations

import hashlib
import hmac
import json
import time
import urllib.parse
from typing import Any

from bot.telegram_config import (
    TelegramBotKind,
    get_telegram_bot_configs,
    get_telegram_bot_token,
    normalize_telegram_bot_kind,
)


def parse_init_data(init_data: str) -> dict[str, str]:
    return dict(urllib.parse.parse_qsl(init_data, strict_parsing=False))


def verify_telegram_init_data(init_data: str, bot_token: str, *, max_age_seconds: int = 86400) -> dict[str, Any]:
    parsed = parse_init_data(init_data)
    received_hash = parsed.pop("hash", "")
    if not init_data or not received_hash:
        raise ValueError("Telegram initData hash is missing")

    data_check_string = "\n".join(f"{key}={value}" for key, value in sorted(parsed.items()))
    secret_key = hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()
    calculated_hash = hmac.new(secret_key, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()

    if not hmac.compare_digest(calculated_hash, received_hash):
        raise ValueError("Telegram initData hash is invalid")

    auth_date = int(parsed.get("auth_date", "0") or "0")
    if auth_date and time.time() - auth_date > max_age_seconds:
        raise ValueError("Telegram initData is expired")

    user_payload = parsed.get("user")
    user = json.loads(user_payload) if user_payload else None
    return {"raw": parsed, "user": user}


def verify_telegram_init_data_any_bot(
    init_data: str,
    hinted_bot_kind: str | TelegramBotKind | None = None,
    *,
    max_age_seconds: int = 86400,
) -> dict[str, Any]:
    """Verify initData against configured bot tokens.

    Hint is tried first, then remaining bots. Rejects if no token validates.
    """
    if not init_data:
        raise ValueError("Telegram initData hash is missing")

    hint = normalize_telegram_bot_kind(hinted_bot_kind if isinstance(hinted_bot_kind, str) else hinted_bot_kind)
    configs = get_telegram_bot_configs()
    if not configs:
        raise ValueError("Telegram bot tokens are not configured")

    ordered_kinds: list[TelegramBotKind] = []
    if hint is not None:
        ordered_kinds.append(hint)
    for config in configs:
        if config.kind not in ordered_kinds:
            ordered_kinds.append(config.kind)

    last_error: Exception | None = None
    tried_tokens: set[str] = set()
    for kind in ordered_kinds:
        token = get_telegram_bot_token(kind)
        if not token or token in tried_tokens:
            continue
        tried_tokens.add(token)
        try:
            verified = verify_telegram_init_data(init_data, token, max_age_seconds=max_age_seconds)
            return {
                "botKind": kind,
                "user": verified.get("user"),
                "raw": verified.get("raw"),
            }
        except ValueError as exc:
            last_error = exc
            continue

    if last_error is not None:
        raise ValueError(str(last_error))
    raise ValueError("Telegram initData hash is invalid")
