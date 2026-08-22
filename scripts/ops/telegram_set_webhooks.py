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
import os
import sys
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

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


def _is_public_https_origin(origin: str | None) -> bool:
    parsed = urllib.parse.urlparse(str(origin or "").strip())
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not host:
        return False
    return host not in {"localhost", "127.0.0.1", "0.0.0.0", "::1"} and not host.endswith(".local")


def _dedicated_token_configured(kind: str) -> bool:
    return bool((os.getenv(f"TELEGRAM_{kind.upper()}_BOT_TOKEN") or "").strip())


def configure_bot(kind: str, origin: str | None, *, dry_run: bool = False, strict: bool = False, drop_pending_updates: bool = False) -> int:
    config = get_telegram_bot_config(kind)  # type: ignore[arg-type]
    if config is None:
        print(f"SKIP {kind}: token not configured")
        return 0
    if strict and not _dedicated_token_configured(kind):
        print(f"FAIL {kind}: strict mode requires TELEGRAM_{kind.upper()}_BOT_TOKEN")
        return 1

    webhook = telegram_webhook_url(kind, origin=origin)  # type: ignore[arg-type]
    web_app = get_telegram_web_app_url(kind)  # type: ignore[arg-type]
    if origin and not web_app:
        role = kind
        web_app = f"{origin.rstrip('/')}/?role={role}&tgBot={role}"
    if not webhook or not web_app:
        print(f"FAIL {kind}: missing WEB_APP_URL / origin for webhook + menu")
        return 1

    username = config.username
    menu_text = CUSTOMER_MENU_TEXT if kind == "customer" else PROVIDER_MENU_TEXT
    commands = CUSTOMER_COMMANDS if kind == "customer" else PROVIDER_COMMANDS

    print(f"{'DRY RUN ' if dry_run else ''}Configuring {kind} bot @{username}")
    print(f"  webhook: {webhook}")
    print(f"  menu: {menu_text} -> {web_app}")

    secret = (
        (os.getenv(f"TELEGRAM_{kind.upper()}_WEBHOOK_SECRET") or "").strip()
        or (os.getenv("TELEGRAM_WEBHOOK_SECRET") or "").strip()
    )
    webhook_payload: dict = {"url": webhook, "allowed_updates": ["message", "callback_query"]}
    if drop_pending_updates:
        webhook_payload["drop_pending_updates"] = True
    if secret:
        webhook_payload["secret_token"] = secret
        print("  secret_token: configured")
    else:
        print("  secret_token: MISSING (set TELEGRAM_WEBHOOK_SECRET)")
        if strict:
            return 1
    print(f"  commands: {', '.join('/' + item['command'] for item in commands)}")
    if dry_run:
        return 0

    client = TelegramBotClient(kind=kind)  # type: ignore[arg-type]
    me = client.get_me()
    username = me.get("username") or username
    print(f"  Telegram getMe: @{username}")

    try:
        client.request("setWebhook", webhook_payload)
        client.set_chat_menu_button(menu_text, web_app)
        client.set_my_commands(commands)
    except TelegramApiError as exc:
        print(f"FAIL {kind}: {exc}")
        return 1

    info = client.get_webhook_info()
    print(f"  ok webhook_url={info.get('url') or '<empty>'}")
    return 0


def main(argv: list[str] | None = None) -> int:
    load_local_env()
    parser = argparse.ArgumentParser(description="Set POMICH Telegram webhooks and menu buttons")
    parser.add_argument("--origin", default=None, help="Public HTTPS origin, e.g. https://pomich.help")
    parser.add_argument("--kind", choices=("all", "customer", "provider"), default="all", help="Bot kind to configure")
    parser.add_argument("--dry-run", action="store_true", help="Print webhook/menu/commands without calling Telegram API")
    parser.add_argument("--strict", action="store_true", help="Production checks: dedicated tokens + webhook secret required")
    parser.add_argument("--drop-pending-updates", action="store_true", help="Ask Telegram to drop pending updates when setting webhook")
    args = parser.parse_args(argv)
    origin = (args.origin or get_base_web_app_url() or "").rstrip("/") or None
    if not origin:
        print("Set WEB_APP_URL or pass --origin https://pomich.help")
        return 2
    if not _is_public_https_origin(origin):
        print(f"Origin must be a public HTTPS URL, got: {origin}")
        return 2
    if args.strict:
        customer_token = (os.getenv("TELEGRAM_CUSTOMER_BOT_TOKEN") or "").strip()
        provider_token = (os.getenv("TELEGRAM_PROVIDER_BOT_TOKEN") or "").strip()
        if customer_token and provider_token and customer_token == provider_token:
            print("Strict mode requires different customer/provider bot tokens")
            return 1

    code = 0
    kinds = ("customer", "provider") if args.kind == "all" else (args.kind,)
    for kind in kinds:
        code = max(code, configure_bot(kind, origin, dry_run=args.dry_run, strict=args.strict, drop_pending_updates=args.drop_pending_updates))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
