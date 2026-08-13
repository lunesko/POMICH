#!/usr/bin/env python3
"""Configure Telegram webhooks + menu buttons for both POMICH bots.

Does not print tokens. Requires env (or .env):

  TELEGRAM_CUSTOMER_BOT_TOKEN
  TELEGRAM_PROVIDER_BOT_TOKEN
  WEB_APP_URL=https://pomich.help   # or per-bot WEB_APP URLs

Usage:
  python scripts/ops/telegram_set_webhooks.py
  python scripts/ops/telegram_set_webhooks.py --origin https://pomich.help

BotFather (manual, once per bot):
  1. Set name / description / short description
  2. Set commands (customer vs provider lists in docs/TELEGRAM_TWO_BOTS.md)
  3. Domain: pomich.help
  4. This script sets menu button + webhook
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from bot.telegram_config import (  # noqa: E402
    get_base_web_app_url,
    get_telegram_bot_config,
    get_telegram_web_app_url,
    load_local_env,
    telegram_webhook_url,
)
from bot.telegram_bot import (  # noqa: E402
    CUSTOMER_MENU_TEXT,
    PROVIDER_MENU_TEXT,
    TelegramApiError,
    TelegramBotClient,
)

CUSTOMER_COMMANDS = [
    {"command": "start", "description": "Старт клієнта"},
    {"command": "app", "description": "Відкрити POMICH"},
    {"command": "order", "description": "Створити заявку"},
    {"command": "status", "description": "Статус заявки"},
    {"command": "profile", "description": "Профіль клієнта"},
    {"command": "history", "description": "Історія заявок"},
    {"command": "cancel", "description": "Скасувати заявку"},
    {"command": "support", "description": "Підтримка"},
    {"command": "help", "description": "Довідка"},
]

PROVIDER_COMMANDS = [
    {"command": "start", "description": "Старт партнера"},
    {"command": "app", "description": "Кабінет партнера"},
    {"command": "dashboard", "description": "Дашборд"},
    {"command": "online", "description": "Вийти на лінію"},
    {"command": "offline", "description": "Зійти з лінії"},
    {"command": "offers", "description": "Активні офери"},
    {"command": "orders", "description": "Мої заявки"},
    {"command": "profile", "description": "Профіль партнера"},
    {"command": "verify", "description": "Верифікація"},
    {"command": "support", "description": "Підтримка"},
    {"command": "help", "description": "Довідка"},
]


def configure_bot(kind: str, origin: str | None) -> int:
    config = get_telegram_bot_config(kind)  # type: ignore[arg-type]
    if config is None:
        print(f"SKIP {kind}: token not configured")
        return 0

    webhook = telegram_webhook_url(kind, origin=origin)  # type: ignore[arg-type]
    web_app = get_telegram_web_app_url(kind)  # type: ignore[arg-type]
    if origin and not web_app:
        role = kind
        web_app = f"{origin.rstrip('/')}/?role={role}&tgBot={role}"
    if not webhook or not web_app:
        print(f"FAIL {kind}: missing WEB_APP_URL / origin for webhook + menu")
        return 1

    client = TelegramBotClient(kind=kind)  # type: ignore[arg-type]
    me = client.get_me()
    username = me.get("username") or config.username
    menu_text = CUSTOMER_MENU_TEXT if kind == "customer" else PROVIDER_MENU_TEXT
    commands = CUSTOMER_COMMANDS if kind == "customer" else PROVIDER_COMMANDS

    print(f"Configuring {kind} bot @{username}")
    print(f"  webhook: {webhook}")
    print(f"  menu: {menu_text} -> {web_app}")

    try:
        client.request(
            "setWebhook",
            {"url": webhook, "allowed_updates": ["message", "callback_query"]},
        )
        client.set_chat_menu_button(menu_text, web_app)
        client.set_my_commands(commands)
    except TelegramApiError as exc:
        print(f"FAIL {kind}: {exc}")
        return 1

    info = client.get_webhook_info()
    print(f"  ok webhook_url={info.get('url') or '<empty>'}")
    return 0


def main() -> int:
    load_local_env()
    parser = argparse.ArgumentParser(description="Set POMICH Telegram webhooks and menu buttons")
    parser.add_argument("--origin", default=None, help="Public HTTPS origin, e.g. https://pomich.help")
    args = parser.parse_args()
    origin = (args.origin or get_base_web_app_url() or "").rstrip("/") or None
    if not origin:
        print("Set WEB_APP_URL or pass --origin https://pomich.help")
        return 2

    code = 0
    for kind in ("customer", "provider"):
        code = max(code, configure_bot(kind, origin))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
