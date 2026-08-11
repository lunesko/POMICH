from __future__ import annotations

import hashlib
import hmac
import json
import time
import urllib.parse
from typing import Any


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
