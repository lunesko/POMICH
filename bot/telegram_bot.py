from __future__ import annotations

import json
import os
import sys
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Optional

from bot.order_store import (
    get_customer_profile,
    get_order,
    get_provider_offers,
    get_provider_profile,
    load_orders,
    normalize_order_status,
    resolve_linked_provider_id,
    update_provider_presence,
    upsert_telegram_customer_profile,
)
from bot.telegram_config import (
    TelegramBotKind,
    get_base_web_app_url,
    get_configured_token,
    get_telegram_bot_config,
    get_telegram_bot_configs,
    get_telegram_bot_token,
    get_telegram_web_app_url,
    load_local_env,
    normalize_telegram_bot_kind,
)

# Re-export for older imports.
__all__ = [
    "TelegramApiError",
    "TelegramBotClient",
    "get_bot_mode",
    "get_configured_token",
    "get_web_app_url",
    "handle_update",
    "load_local_env",
    "notify_dispatch_offers",
    "notify_order_accepted",
    "notify_order_cancelled",
    "notify_order_created",
    "send_message",
    "delete_message",
]


CUSTOMER_WELCOME_TEXT = (
    "Вітаємо у POMICH.\n\n"
    "Якщо потрібна допомога на дорозі, відкрийте додаток — це найшвидший спосіб створити заявку."
)

CUSTOMER_WELCOME_BACK_TEXT = (
    "З поверненням! 👋\n\n"
    "Натисніть «Викликати допомогу», щоб відкрити додаток."
)

PROVIDER_WELCOME_TEXT = (
    "Вітаємо у партнерському боті POMICH.\n\n"
    "Тут ви приймаєте заявки, виходите на лінію та керуєте профілем як партнер служби."
)

PROVIDER_WELCOME_BACK_TEXT = (
    "З поверненням, партнере! 👋\n\n"
    "Натисніть «Кабінет партнера», щоб відкрити додаток."
)

CUSTOMER_HELP_TEXT = (
    "POMICH — допомога на дорозі для клієнтів.\n\n"
    "Команди: /app /order /status /profile /history /cancel /support\n"
    "Натисніть кнопку нижче, щоб відкрити додаток."
)

PROVIDER_HELP_TEXT = (
    "POMICH — кабінет партнера.\n\n"
    "Команди: /app /dashboard /online /offline /offers /orders /profile /verify /support\n"
    "Натисніть кнопку нижче, щоб відкрити кабінет."
)

CUSTOMER_MENU_TEXT = "Викликати допомогу"
PROVIDER_MENU_TEXT = "Кабінет партнера"

_ACTIVE_ORDER_STATUSES = {"searching", "accepted", "price_confirmed", "assigned", "en_route", "arrived", "in_progress"}


def _customer_display_name(profile: dict) -> str:
    name = str(profile.get("name") or "").strip()
    if name and name != "Клієнт POMICH":
        return name
    return ""


def _check_customer_registered(tg_user_id: str) -> bool:
    if not tg_user_id:
        return False
    profile = get_customer_profile(f"tg-{tg_user_id}")
    name = _customer_display_name(profile)
    phone = str(profile.get("phone") or "").strip()
    return bool(name and phone)


def _check_provider_registered(tg_user_id: str) -> bool:
    if not tg_user_id:
        return False
    customer_id = f"tg-{tg_user_id}"
    profile = get_customer_profile(customer_id)
    provider_id = resolve_linked_provider_id(customer_id, profile)
    if not provider_id:
        return False
    provider = get_provider_profile(provider_id)
    return bool(provider and provider.get("registeredAt"))


class TelegramApiError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None, payload: Any = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload


def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent


def get_bot_mode() -> str:
    load_local_env()
    return (os.getenv("TELEGRAM_MODE") or "polling").strip().lower()


def _truthy(value: str | None, *, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def get_web_app_url() -> str | None:
    return get_base_web_app_url()


def _request_json(url: str, payload: dict[str, Any] | None = None, *, timeout: int = 30) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST" if payload is not None else "GET",
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            body = json.load(response)
    except urllib.error.HTTPError as exc:
        try:
            error_body = json.loads(exc.read().decode("utf-8"))
        except Exception:
            error_body = None
        description = error_body.get("description") if isinstance(error_body, dict) else str(exc)
        raise TelegramApiError(description, status_code=exc.code, payload=error_body) from exc
    except Exception as exc:
        raise TelegramApiError(str(exc)) from exc

    if not body.get("ok"):
        raise TelegramApiError(body.get("description", "Telegram API returned ok=false"), payload=body)
    return body


class TelegramBotClient:
    def __init__(self, token: str | None = None, *, kind: TelegramBotKind | str | None = None) -> None:
        self.kind = normalize_telegram_bot_kind(kind) if kind is not None else None
        if token:
            self.token = token
        elif self.kind is not None:
            self.token = get_telegram_bot_token(self.kind)
        else:
            self.token = get_configured_token()
        if not self.token:
            raise TelegramApiError("Telegram bot token is not configured")
        self.base_url = f"https://api.telegram.org/bot{self.token}"

    def request(self, method: str, payload: dict[str, Any] | None = None, *, timeout: int = 30) -> dict[str, Any]:
        return _request_json(f"{self.base_url}/{method}", payload, timeout=timeout)

    def get_me(self) -> dict[str, Any]:
        return self.request("getMe")["result"]

    def get_webhook_info(self) -> dict[str, Any]:
        return self.request("getWebhookInfo")["result"]

    def delete_webhook(self, *, drop_pending_updates: bool = False) -> dict[str, Any]:
        return self.request("deleteWebhook", {"drop_pending_updates": drop_pending_updates})

    def get_updates(self, *, offset: int | None = None, timeout_seconds: int = 30) -> list[dict[str, Any]]:
        payload: dict[str, Any] = {
            "timeout": timeout_seconds,
            "allowed_updates": ["message", "callback_query"],
        }
        if offset is not None:
            payload["offset"] = offset
        response = self.request("getUpdates", payload, timeout=timeout_seconds + 10)
        return response.get("result", [])

    def send_message(
        self,
        chat_id: str | int,
        text: str,
        *,
        reply_markup: dict[str, Any] | None = None,
        parse_mode: str | None = None,
    ) -> dict[str, Any]:
        payload: dict[str, Any] = {"chat_id": chat_id, "text": text}
        if reply_markup is not None:
            payload["reply_markup"] = reply_markup
        if parse_mode is not None:
            payload["parse_mode"] = parse_mode
        return self.request("sendMessage", payload)

    def delete_message(self, chat_id: str | int, message_id: int) -> dict[str, Any]:
        return self.request("deleteMessage", {"chat_id": chat_id, "message_id": message_id})

    def set_chat_menu_button(self, text: str, web_app_url: str) -> dict[str, Any]:
        return self.request(
            "setChatMenuButton",
            {
                "menu_button": {
                    "type": "web_app",
                    "text": text,
                    "web_app": {"url": web_app_url},
                }
            },
        )

    def set_my_commands(self, commands: list[dict[str, str]]) -> dict[str, Any]:
        return self.request("setMyCommands", {"commands": commands})


def _client_for_kind(kind: TelegramBotKind, client: TelegramBotClient | None = None) -> TelegramBotClient:
    if client is not None and (client.kind is None or client.kind == kind):
        return client
    return TelegramBotClient(kind=kind)


def _screen_url(kind: TelegramBotKind, screen: str | None = None) -> str | None:
    base = get_telegram_web_app_url(kind)
    if not base:
        return None
    if not screen:
        return base
    parsed = urllib.parse.urlparse(base)
    query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
    query["screen"] = [screen]
    new_query = urllib.parse.urlencode(query, doseq=True)
    return urllib.parse.urlunparse(parsed._replace(query=new_query))


def _webapp_button(text: str, url: str | None) -> dict[str, Any] | None:
    if not url:
        return None
    return {"text": text, "web_app": {"url": url}}


def _url_button(text: str, url: str) -> dict[str, Any]:
    return {"text": text, "url": url}


def _build_webapp_keyboard(*, role: str | None = None, kind: TelegramBotKind | None = None, screen: str | None = None) -> dict[str, Any] | None:
    bot_kind = normalize_telegram_bot_kind(role) or kind or "customer"
    # Default Mini App target matches the primary menu button for that bot.
    default_screen = "order" if bot_kind == "customer" else "cabinet"
    url = _screen_url(bot_kind, screen or default_screen)
    label = CUSTOMER_MENU_TEXT if bot_kind == "customer" else PROVIDER_MENU_TEXT
    button = _webapp_button(label, url)
    if not button:
        return None
    return {"inline_keyboard": [[button]]}


def _build_customer_start_keyboard() -> dict[str, Any]:
    rows: list[list[dict[str, Any]]] = []
    # Button label must match the Mini App screen (?screen=) opened by the WebApp URL.
    open_btn = _webapp_button(CUSTOMER_MENU_TEXT, _screen_url("customer", "order"))
    profile_btn = _webapp_button("Мій профіль", _screen_url("customer", "profile"))
    history_btn = _webapp_button("Історія", _screen_url("customer", "history"))
    if open_btn:
        rows.append([open_btn])
    profile_row = [btn for btn in (profile_btn, history_btn) if btn]
    if profile_row:
        rows.append(profile_row)
    provider_cfg = get_telegram_bot_config("provider")
    partner_username = provider_cfg.username if provider_cfg else "pomich_help_bot"
    rows.append([_url_button("Стати партнером", f"https://t.me/{partner_username}?start=partner")])
    return {"inline_keyboard": rows}


def _build_provider_start_keyboard() -> dict[str, Any]:
    rows: list[list[dict[str, Any]]] = []
    # «Кабінет партнера» must open cabinet — not the generic duty map.
    open_btn = _webapp_button(PROVIDER_MENU_TEXT, _screen_url("provider", "cabinet"))
    duty_btn = _webapp_button("Вийти на лінію", _screen_url("provider", "duty"))
    offers_btn = _webapp_button("Активні офери", _screen_url("provider", "offers"))
    verify_btn = _webapp_button("Підтвердити профіль", _screen_url("provider", "verify"))
    if open_btn:
        rows.append([open_btn])
    duty_row = [btn for btn in (duty_btn, offers_btn) if btn]
    if duty_row:
        rows.append(duty_row)
    if verify_btn:
        rows.append([verify_btn])
    customer_cfg = get_telegram_bot_config("customer")
    customer_username = customer_cfg.username if customer_cfg else "pomich_ua_bot"
    rows.append([_url_button("Я клієнт", f"https://t.me/{customer_username}?start=customer")])
    return {"inline_keyboard": rows}


def _build_role_keyboard() -> dict[str, Any]:
    """Legacy multi-role keyboard for single-bot fallback."""
    base_url = get_web_app_url()
    customer_url = get_telegram_web_app_url("customer") or _screen_url("customer")
    provider_url = get_telegram_web_app_url("provider") or _screen_url("provider")
    keyboard: dict[str, Any] = {"inline_keyboard": []}
    if base_url:
        keyboard["inline_keyboard"].append([{"text": "Відкрити POMICH", "web_app": {"url": base_url}}])
    if customer_url:
        keyboard["inline_keyboard"].append([{"text": "Я клієнт", "web_app": {"url": customer_url}}])
    if provider_url:
        keyboard["inline_keyboard"].append([{"text": "Я партнер", "web_app": {"url": provider_url}}])
    return keyboard


def _webapp_url_for_role(role: str | None = None) -> str | None:
    kind = normalize_telegram_bot_kind(role)
    if kind:
        return get_telegram_web_app_url(kind)
    return get_web_app_url()


def _latest_active_customer_order(tg_user_id: str) -> dict[str, Any] | None:
    customer_id = f"tg-{tg_user_id}"
    candidates: list[dict[str, Any]] = []
    for order in load_orders():
        if str(order.get("customerId") or "") != customer_id and str(order.get("telegramUserId") or "") != tg_user_id:
            continue
        status = normalize_order_status(order.get("status"))
        if status in _ACTIVE_ORDER_STATUSES:
            candidates.append(order)
    if not candidates:
        return None
    return candidates[-1]


def _provider_id_for_telegram_user(tg_user_id: str) -> str:
    customer_id = f"tg-{tg_user_id}"
    profile = get_customer_profile(customer_id)
    return resolve_linked_provider_id(customer_id, profile)


def _support_text(kind: TelegramBotKind) -> str:
    if kind == "provider":
        return (
            "Підтримка партнерів POMICH.\n\n"
            "Напишіть сюди суть проблеми або відкрийте кабінет і розділ підтримки."
        )
    return (
        "Підтримка клієнтів POMICH.\n\n"
        "Опишіть проблему тут або відкрийте додаток — ми допоможемо з заявкою."
    )


def _handle_customer_command(
    bot: TelegramBotClient,
    chat_id: str | int,
    text: str,
    tg_user_id: str,
) -> dict[str, Any]:
    command = text.split()[0].split("@")[0].lower()
    keyboard = _build_webapp_keyboard(kind="customer")

    if command == "/start":
        registered = _check_customer_registered(tg_user_id)
        if registered:
            profile = get_customer_profile(f"tg-{tg_user_id}")
            display_name = _customer_display_name(profile)
            greeting = (
                f"З поверненням, {display_name}! 👋\n\nНатисніть «Викликати допомогу», щоб відкрити додаток."
                if display_name
                else CUSTOMER_WELCOME_BACK_TEXT
            )
        else:
            greeting = CUSTOMER_WELCOME_TEXT
        bot.send_message(chat_id, greeting, reply_markup=_build_customer_start_keyboard())
        return {"handled": True, "type": "start", "botKind": "customer", "registered": registered}

    if command == "/app":
        bot.send_message(chat_id, "Відкрийте POMICH:", reply_markup=keyboard)
        return {"handled": True, "type": "app", "botKind": "customer"}

    if command == "/order":
        bot.send_message(
            chat_id,
            "Створіть заявку на допомогу:",
            reply_markup=_build_webapp_keyboard(kind="customer", screen="order"),
        )
        return {"handled": True, "type": "order", "botKind": "customer"}

    if command == "/status":
        order = _latest_active_customer_order(tg_user_id)
        if order:
            status = normalize_order_status(order.get("status"))
            bot.send_message(
                chat_id,
                f"Активна заявка #{order.get('id')}\nСтатус: {status}",
                reply_markup=_build_webapp_keyboard(kind="customer", screen="status"),
            )
        else:
            bot.send_message(
                chat_id,
                "Немає активної заявки. Створіть нову через кнопку нижче.",
                reply_markup=_build_webapp_keyboard(kind="customer", screen="order"),
            )
        return {"handled": True, "type": "status", "botKind": "customer"}

    if command == "/profile":
        bot.send_message(
            chat_id,
            "Профіль клієнта:",
            reply_markup=_build_webapp_keyboard(kind="customer", screen="profile"),
        )
        return {"handled": True, "type": "profile", "botKind": "customer"}

    if command == "/history":
        bot.send_message(
            chat_id,
            "Історія заявок:",
            reply_markup=_build_webapp_keyboard(kind="customer", screen="history"),
        )
        return {"handled": True, "type": "history", "botKind": "customer"}

    if command == "/cancel":
        order = _latest_active_customer_order(tg_user_id)
        if not order:
            bot.send_message(chat_id, "Немає активної заявки для скасування.", reply_markup=keyboard)
            return {"handled": True, "type": "cancel-empty", "botKind": "customer"}
        order_id = str(order.get("id") or "")
        bot.send_message(
            chat_id,
            f"Скасувати заявку #{order_id}?",
            reply_markup={
                "inline_keyboard": [[
                    {"text": "Так, скасувати", "callback_data": f"cancel:confirm:{order_id}"},
                    {"text": "Ні", "callback_data": "cancel:abort"},
                ]]
            },
        )
        return {"handled": True, "type": "cancel-confirm", "botKind": "customer"}

    if command == "/support":
        bot.send_message(chat_id, _support_text("customer"), reply_markup=keyboard)
        return {"handled": True, "type": "support", "botKind": "customer"}

    if command == "/help":
        bot.send_message(chat_id, CUSTOMER_HELP_TEXT, reply_markup=keyboard)
        return {"handled": True, "type": "help", "botKind": "customer"}

    bot.send_message(
        chat_id,
        "Натисніть /start або кнопку нижче, щоб відкрити POMICH.",
        reply_markup=keyboard,
    )
    return {"handled": True, "type": "fallback", "botKind": "customer"}


def _handle_provider_command(
    bot: TelegramBotClient,
    chat_id: str | int,
    text: str,
    tg_user_id: str,
) -> dict[str, Any]:
    command = text.split()[0].split("@")[0].lower()
    keyboard = _build_webapp_keyboard(kind="provider")

    if command == "/start":
        registered = _check_provider_registered(tg_user_id)
        greeting = PROVIDER_WELCOME_BACK_TEXT if registered else PROVIDER_WELCOME_TEXT
        bot.send_message(chat_id, greeting, reply_markup=_build_provider_start_keyboard())
        return {"handled": True, "type": "start", "botKind": "provider", "registered": registered}

    if command in {"/app", "/dashboard"}:
        bot.send_message(chat_id, "Кабінет партнера:", reply_markup=keyboard)
        return {"handled": True, "type": command.lstrip("/"), "botKind": "provider"}

    if command == "/online":
        provider_id = _provider_id_for_telegram_user(tg_user_id)
        if not provider_id:
            bot.send_message(
                chat_id,
                "Спочатку завершіть реєстрацію партнера в додатку.",
                reply_markup=_build_webapp_keyboard(kind="provider", screen="verify"),
            )
            return {"handled": True, "type": "online-unlinked", "botKind": "provider"}
        try:
            update_provider_presence(provider_id, {"status": "online"})
            bot.send_message(chat_id, "Ви на лінії ✅ Очікуйте нові заявки.")
            return {"handled": True, "type": "online", "botKind": "provider"}
        except ValueError as exc:
            bot.send_message(
                chat_id,
                f"Не вдалося вийти на лінію: {exc}\nВідкрийте кабінет для перевірки профілю.",
                reply_markup=_build_webapp_keyboard(kind="provider", screen="verify"),
            )
            return {"handled": True, "type": "online-failed", "botKind": "provider"}

    if command == "/offline":
        provider_id = _provider_id_for_telegram_user(tg_user_id)
        if not provider_id:
            bot.send_message(chat_id, "Профіль партнера ще не прив’язано.", reply_markup=keyboard)
            return {"handled": True, "type": "offline-unlinked", "botKind": "provider"}
        try:
            update_provider_presence(provider_id, {"status": "offline"})
            bot.send_message(chat_id, "Ви офлайн. Заявки більше не надходитимуть.")
            return {"handled": True, "type": "offline", "botKind": "provider"}
        except ValueError as exc:
            bot.send_message(chat_id, f"Не вдалося змінити статус: {exc}", reply_markup=keyboard)
            return {"handled": True, "type": "offline-failed", "botKind": "provider"}

    if command == "/offers":
        provider_id = _provider_id_for_telegram_user(tg_user_id)
        pending = []
        if provider_id:
            pending = [offer for offer in get_provider_offers(provider_id) if offer.get("status") == "pending"]
        if pending:
            lines = [f"Активні офери ({len(pending)}):"]
            for offer in pending[:5]:
                lines.append(f"• {offer.get('id')} → заявка {offer.get('orderId')}")
            bot.send_message(
                chat_id,
                "\n".join(lines),
                reply_markup=_build_webapp_keyboard(kind="provider", screen="offers"),
            )
        else:
            bot.send_message(
                chat_id,
                "Немає активних оферів. Відкрийте кабінет або вийдіть на лінію (/online).",
                reply_markup=_build_webapp_keyboard(kind="provider", screen="offers"),
            )
        return {"handled": True, "type": "offers", "botKind": "provider"}

    if command == "/orders":
        bot.send_message(
            chat_id,
            "Ваші заявки:",
            reply_markup=_build_webapp_keyboard(kind="provider", screen="orders"),
        )
        return {"handled": True, "type": "orders", "botKind": "provider"}

    if command == "/profile":
        bot.send_message(
            chat_id,
            "Профіль партнера:",
            reply_markup=_build_webapp_keyboard(kind="provider", screen="profile"),
        )
        return {"handled": True, "type": "profile", "botKind": "provider"}

    if command == "/verify":
        bot.send_message(
            chat_id,
            "Підтвердження профілю:",
            reply_markup=_build_webapp_keyboard(kind="provider", screen="verify"),
        )
        return {"handled": True, "type": "verify", "botKind": "provider"}

    if command == "/support":
        bot.send_message(chat_id, _support_text("provider"), reply_markup=keyboard)
        return {"handled": True, "type": "support", "botKind": "provider"}

    if command == "/help":
        bot.send_message(chat_id, PROVIDER_HELP_TEXT, reply_markup=keyboard)
        return {"handled": True, "type": "help", "botKind": "provider"}

    bot.send_message(
        chat_id,
        "Натисніть /start або кнопку нижче, щоб відкрити кабінет партнера.",
        reply_markup=keyboard,
    )
    return {"handled": True, "type": "fallback", "botKind": "provider"}


def _handle_callback(
    callback: dict[str, Any],
    client: TelegramBotClient | None = None,
    *,
    bot_kind: TelegramBotKind = "customer",
) -> dict[str, Any]:
    bot = _client_for_kind(bot_kind, client)
    data = str(callback.get("data") or "")
    message = callback.get("message") or {}
    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    callback_id = callback.get("id")
    if callback_id:
        try:
            bot.request("answerCallbackQuery", {"callback_query_id": callback_id})
        except TelegramApiError:
            pass
    if not chat_id:
        return {"handled": False, "reason": "chat_id missing"}

    if data.startswith("cancel:confirm:"):
        order_id = data.split(":", 2)[-1]
        bot.send_message(
            chat_id,
            f"Щоб скасувати #{order_id}, відкрийте додаток і підтвердіть скасування.",
            reply_markup=_build_webapp_keyboard(kind="customer", screen="status"),
        )
        return {"handled": True, "type": "cancel-confirmed", "botKind": bot_kind}

    if data == "cancel:abort":
        bot.send_message(chat_id, "Скасування скасовано.", reply_markup=_build_webapp_keyboard(kind="customer"))
        return {"handled": True, "type": "cancel-aborted", "botKind": bot_kind}

    if data == "role:customer":
        bot.send_message(
            chat_id,
            "Реєстрація клієнта — натисніть кнопку нижче.",
            reply_markup=_build_webapp_keyboard(kind="customer"),
        )
        return {"handled": True, "type": "role-customer", "botKind": bot_kind}
    if data == "role:provider":
        bot.send_message(
            chat_id,
            "Реєстрація партнера — натисніть кнопку нижче.",
            reply_markup=_build_webapp_keyboard(kind="provider"),
        )
        return {"handled": True, "type": "role-provider", "botKind": bot_kind}
    return {"handled": True, "type": "callback-ignored", "botKind": bot_kind}


def handle_update(
    update: dict[str, Any],
    client: TelegramBotClient | None = None,
    *,
    bot_kind: TelegramBotKind | str | None = None,
) -> dict[str, Any]:
    kind = normalize_telegram_bot_kind(bot_kind) or (client.kind if client and client.kind else "customer")

    callback = update.get("callback_query") or {}
    if callback:
        return _handle_callback(callback, client, bot_kind=kind)

    message = update.get("message") or {}
    chat = message.get("chat") or {}
    user = message.get("from") or {}
    chat_id = chat.get("id")

    if not chat_id:
        return {"handled": False, "reason": "chat_id missing"}

    bot = _client_for_kind(kind, client)
    text = (message.get("text") or "").strip()
    tg_user_id = str(user.get("id") or "")

    # Remember which bot channel this human used (for notifications).
    if tg_user_id and user:
        try:
            upsert_telegram_customer_profile(user, bot_kind=kind)
        except Exception:
            pass

    if not text.startswith("/"):
        if kind == "provider":
            bot.send_message(
                chat_id,
                "Натисніть /start або кнопку нижче, щоб відкрити кабінет партнера.",
                reply_markup=_build_webapp_keyboard(kind="provider"),
            )
            return {"handled": True, "type": "fallback", "botKind": kind}
        bot.send_message(
            chat_id,
            "Натисніть /start або кнопку нижче, щоб відкрити POMICH.",
            reply_markup=_build_webapp_keyboard(kind="customer"),
        )
        return {"handled": True, "type": "fallback", "botKind": kind}

    if kind == "provider":
        return _handle_provider_command(bot, chat_id, text, tg_user_id)
    return _handle_customer_command(bot, chat_id, text, tg_user_id)


def send_message(
    chat_id: str,
    text: str,
    username: Optional[str] = None,
    *,
    parse_mode: str | None = None,
    kind: TelegramBotKind | str | None = "customer",
) -> dict[str, Any]:
    bot_kind = normalize_telegram_bot_kind(kind) or "customer"
    try:
        return TelegramBotClient(kind=bot_kind).send_message(chat_id, text, parse_mode=parse_mode)
    except TelegramApiError as exc:
        return {"ok": False, "error": str(exc)}


def delete_message(chat_id: str | int, message_id: int, *, kind: TelegramBotKind | str | None = "customer") -> dict[str, Any]:
    bot_kind = normalize_telegram_bot_kind(kind) or "customer"
    try:
        return TelegramBotClient(kind=bot_kind).delete_message(chat_id, message_id)
    except TelegramApiError as exc:
        return {"ok": False, "error": str(exc)}


def notify_order_created(chat_id: str | None, order: dict[str, Any]) -> dict[str, Any] | None:
    if not chat_id:
        return None

    service = str(order.get("service") or "Послуга")
    text = (
        f"✅ Заявку створено: #{order.get('id')}\n\n"
        f"Послуга: {service}\n"
        "Статус: шукаємо допомогу поруч."
    )
    try:
        return TelegramBotClient(kind="customer").send_message(str(chat_id), text)
    except TelegramApiError as exc:
        print(f"Telegram API error while notifying order: {exc}", flush=True)
        return {"ok": False, "error": str(exc)}


def _resolve_customer_telegram_chat_id(order: dict[str, Any]) -> str:
    for key in ("chatId", "telegramUserId", "telegram_user_id"):
        value = str(order.get(key) or "").strip()
        if value:
            return value
    customer_id = str(order.get("customerId") or order.get("customer_id") or "").strip()
    if customer_id.startswith("tg-") and len(customer_id) > 3:
        return customer_id[3:]
    return ""


def notify_order_accepted(order: dict[str, Any]) -> dict[str, Any] | None:
    chat_id = _resolve_customer_telegram_chat_id(order)
    if not chat_id:
        print(f"Skip accept notify: no telegram chat for order {order.get('id')}", flush=True)
        return None

    order_id = str(order.get("id") or "").strip() or "—"
    assigned = order.get("assignedProvider") if isinstance(order.get("assignedProvider"), dict) else {}
    partner_name = str(assigned.get("name") or order.get("providerName") or "Партнер").strip() or "Партнер"
    price = order.get("partnerProposedPrice")
    try:
        price_label = f"{float(price):.0f} ₴" if price is not None and str(price).strip() != "" else "ціну"
    except (TypeError, ValueError):
        price_label = "ціну"

    text = (
        f"✅ Партнер прийняв вашу заявку #{order_id}\n\n"
        f"Хто: {partner_name}\n"
        f"Запропонована ціна: {price_label}\n\n"
        "Відкрийте POMICH, щоб підтвердити ціну або зв'язатися з партнером."
    )
    try:
        return TelegramBotClient(kind="customer").send_message(chat_id, text)
    except TelegramApiError as exc:
        print(f"Telegram API error while notifying accept: {exc}", flush=True)
        return {"ok": False, "error": str(exc)}


def notify_order_cancelled(order: dict[str, Any]) -> list[dict[str, Any]]:
    from bot.order_store import partner_telegram_user_ids_for_order

    order_id = str(order.get("id") or "").strip()
    if not order_id:
        return []

    text = f"Заявку #{order_id} скасовано клієнтом"
    results: list[dict[str, Any]] = []
    # Provider audience → provider bot only.
    for telegram_user_id in partner_telegram_user_ids_for_order(order_id, order):
        try:
            results.append(TelegramBotClient(kind="provider").send_message(str(telegram_user_id), text))
        except TelegramApiError as exc:
            print(f"Telegram API error while notifying partner cancel: {exc}", flush=True)
            results.append({"ok": False, "error": str(exc), "chat_id": telegram_user_id})

    customer_chat = _resolve_customer_telegram_chat_id(order)
    if customer_chat:
        try:
            results.append(
                TelegramBotClient(kind="customer").send_message(
                    customer_chat,
                    f"Заявку #{order_id} скасовано.",
                )
            )
        except TelegramApiError as exc:
            print(f"Telegram API error while notifying customer cancel: {exc}", flush=True)
            results.append({"ok": False, "error": str(exc), "chat_id": customer_chat})
    return results


def notify_dispatch_offers(order: dict[str, Any], offers: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """Notify partners about new dispatch offers via the provider bot only."""
    from bot.order_store import load_offers, resolve_provider_telegram_user_id

    order_id = str(order.get("id") or "").strip()
    if not order_id:
        return []

    related = offers
    if related is None:
        related = [
            offer
            for offer in load_offers()
            if str(offer.get("orderId") or "") == order_id and str(offer.get("status") or "") == "pending"
        ]

    service = str(order.get("service") or "Послуга")
    results: list[dict[str, Any]] = []
    seen: set[str] = set()
    for offer in related:
        if str(offer.get("status") or "") != "pending":
            continue
        provider_id = str(offer.get("providerId") or "").strip()
        if not provider_id:
            continue
        telegram_user_id = resolve_provider_telegram_user_id(provider_id)
        if not telegram_user_id or telegram_user_id in seen:
            continue
        seen.add(telegram_user_id)
        distance = offer.get("distanceKm")
        distance_label = f"{float(distance):.1f} км" if distance is not None else "поруч"
        text = (
            f"🚨 Нова заявка #{order_id}\n"
            f"Послуга: {service}\n"
            f"Відстань: {distance_label}\n\n"
            "Відкрийте кабінет партнера, щоб прийняти офер."
        )
        try:
            results.append(
                TelegramBotClient(kind="provider").send_message(
                    telegram_user_id,
                    text,
                    reply_markup=_build_webapp_keyboard(kind="provider", screen="offers"),
                )
            )
        except TelegramApiError as exc:
            print(f"Telegram API error while notifying dispatch offer: {exc}", flush=True)
            results.append({"ok": False, "error": str(exc), "chat_id": telegram_user_id})
    return results


def _pid_file() -> Path:
    return _project_root() / "data" / "telegram_bot.pid"


def _process_is_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    if os.name == "nt":
        try:
            import ctypes

            process_query_limited_information = 0x1000
            handle = ctypes.windll.kernel32.OpenProcess(process_query_limited_information, False, pid)
            if not handle:
                return False
            ctypes.windll.kernel32.CloseHandle(handle)
            return True
        except Exception:
            return False

    return Path(f"/proc/{pid}").exists()


def _acquire_runtime_lock() -> None:
    path = _pid_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        try:
            existing_pid = int(path.read_text(encoding="utf-8").strip())
        except ValueError:
            existing_pid = 0
        if existing_pid and existing_pid != os.getpid() and _process_is_alive(existing_pid):
            raise RuntimeError(f"Another POMICH Telegram polling worker is already running: pid={existing_pid}")
    path.write_text(str(os.getpid()), encoding="utf-8")


def _release_runtime_lock() -> None:
    path = _pid_file()
    try:
        if path.exists() and path.read_text(encoding="utf-8").strip() == str(os.getpid()):
            path.unlink()
    except OSError:
        pass


def run_polling() -> None:
    if get_bot_mode() != "polling":
        raise RuntimeError("python -m bot.telegram_bot starts only TELEGRAM_MODE=polling")

    _acquire_runtime_lock()
    try:
        configs = get_telegram_bot_configs()
        if not configs:
            raise TelegramApiError("Telegram bot token is not configured")

        # Deduplicate identical tokens (legacy single-token local mode).
        unique: dict[str, Any] = {}
        for config in configs:
            unique.setdefault(config.token, config)

        clients: dict[str, TelegramBotClient] = {}
        offsets: dict[str, int | None] = {}
        kinds: dict[str, TelegramBotKind] = {}
        for config in unique.values():
            client = TelegramBotClient(kind=config.kind)
            me = client.get_me()
            username = me.get("username") or config.username
            webhook_info = client.get_webhook_info()
            webhook_url = webhook_info.get("url") or ""
            drop_pending = _truthy(os.getenv("TELEGRAM_DROP_PENDING_UPDATES"), default=False)

            print("POMICH Telegram bot starting", flush=True)
            print("Mode: polling", flush=True)
            print(f"Bot kind: {config.kind} @{username} id={me.get('id')}", flush=True)
            print(
                f"Webhook: url={webhook_url or '<empty>'} "
                f"pending_update_count={webhook_info.get('pending_update_count', 0)} "
                f"last_error_message={webhook_info.get('last_error_message') or ''}",
                flush=True,
            )

            if webhook_url or drop_pending:
                client.delete_webhook(drop_pending_updates=drop_pending)
                print(f"Webhook disabled for polling. drop_pending_updates={drop_pending}", flush=True)

            clients[config.token] = client
            offsets[config.token] = None
            kinds[config.token] = config.kind

        print("Polling started", flush=True)

        while True:
            for token, client in clients.items():
                try:
                    updates = client.get_updates(offset=offsets[token], timeout_seconds=20)
                except TelegramApiError as exc:
                    print(f"Telegram API error ({kinds[token]}): {exc}", flush=True)
                    time.sleep(2)
                    continue

                for update in updates:
                    update_id = update.get("update_id")
                    if isinstance(update_id, int):
                        offsets[token] = update_id + 1
                    try:
                        result = handle_update(update, client, bot_kind=kinds[token])
                        print(f"Update handled ({kinds[token]}): {result}", flush=True)
                    except Exception as exc:
                        print(f"handler error ({kinds[token]}): {exc}", flush=True)
                        traceback.print_exc()
    except TelegramApiError as exc:
        print(f"Telegram connection error: {exc}", flush=True)
        raise
    finally:
        _release_runtime_lock()


def print_diagnostics() -> int:
    configs = get_telegram_bot_configs()
    if not configs:
        print("Telegram diagnostics failed: no bot tokens configured")
        return 1

    exit_code = 0
    seen: set[str] = set()
    for config in configs:
        if config.token in seen:
            continue
        seen.add(config.token)
        try:
            client = TelegramBotClient(kind=config.kind)
            me = client.get_me()
            webhook_info = client.get_webhook_info()
        except TelegramApiError as exc:
            print(f"Telegram diagnostics failed ({config.kind}): {exc}")
            exit_code = 1
            continue

        print(f"Bot kind={config.kind} @{me.get('username')} id={me.get('id')}")
        print(
            f"Webhook: url={webhook_info.get('url') or '<empty>'} "
            f"pending_update_count={webhook_info.get('pending_update_count', 0)} "
            f"last_error_message={webhook_info.get('last_error_message') or ''}"
        )
    return exit_code


def main() -> int:
    command = sys.argv[1] if len(sys.argv) > 1 else "polling"
    if command in {"doctor", "diagnostics"}:
        return print_diagnostics()
    if command == "polling":
        run_polling()
        return 0

    print("Usage: python -m bot.telegram_bot [polling|doctor]")
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
