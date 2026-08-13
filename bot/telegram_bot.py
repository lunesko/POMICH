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

from bot.order_store import get_customer_profile


WELCOME_TEXT = (
    "Вітаємо у POMICH! 👋\n\n"
    "Оберіть роль нижче — кожна кнопка відкриває додаток одразу з потрібним сценарієм."
)

WELCOME_BACK_TEXT = (
    "З поверненням! 👋\n\n"
    "Натисніть кнопку нижче, щоб відкрити додаток."
)


def _customer_display_name(profile: dict) -> str:
    name = str(profile.get("name") or "").strip()
    if name and name != "Клієнт POMICH":
        return name
    return ""


def _check_customer_registered(tg_user_id: str) -> bool:
    """True when tg-{id} profile has name + phone in the shared DB."""
    if not tg_user_id:
        return False
    profile = get_customer_profile(f"tg-{tg_user_id}")
    name = _customer_display_name(profile)
    phone = str(profile.get("phone") or "").strip()
    return bool(name and phone)


HELP_TEXT = (
    "POMICH — допомога на дорозі.\n\n"
    "Натисніть кнопку нижче або /start, щоб відкрити додаток."
)


class TelegramApiError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None, payload: Any = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.payload = payload


def _project_root() -> Path:
    return Path(__file__).resolve().parent.parent


def load_local_env(path: Path | None = None) -> None:
    env_path = path or (_project_root() / ".env")
    if not env_path.exists():
        return

    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        name = name.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(name, value)


def get_configured_token() -> str | None:
    load_local_env()
    return os.getenv("TELEGRAM_BOT_TOKEN") or os.getenv("VITE_TELEGRAM_BOT_TOKEN")


def get_bot_mode() -> str:
    load_local_env()
    return (os.getenv("TELEGRAM_MODE") or "polling").strip().lower()


def _truthy(value: str | None, *, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def _is_public_https_url(value: str | None) -> bool:
    if not value:
        return False
    parsed = urllib.parse.urlparse(value)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not host:
        return False
    if host in {"localhost", "127.0.0.1", "0.0.0.0", "::1"}:
        return False
    if host.endswith(".local"):
        return False
    return True


def get_web_app_url() -> str | None:
    load_local_env()
    url = os.getenv("WEB_APP_URL") or os.getenv("VITE_WEB_APP_URL")
    return url if _is_public_https_url(url) else None


def _webapp_url_for_role(role: str | None = None) -> str | None:
    """Build WebApp URL; role is customer|provider for deep-linked onboarding."""
    base = get_web_app_url()
    if not base:
        return None
    if not role:
        return base
    parsed = urllib.parse.urlparse(base)
    query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
    query["role"] = [role]
    new_query = urllib.parse.urlencode(query, doseq=True)
    return urllib.parse.urlunparse(parsed._replace(query=new_query))


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
    def __init__(self, token: str | None = None) -> None:
        self.token = token or get_configured_token()
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


def _build_webapp_keyboard(*, role: str | None = None) -> dict[str, Any] | None:
    url = _webapp_url_for_role(role)
    if not url:
        return None
    labels = {
        None: "Відкрити POMICH",
        "customer": "Відкрити POMICH",
        "provider": "Відкрити POMICH",
    }
    return {
        "inline_keyboard": [[{
            "text": labels.get(role, "Відкрити POMICH"),
            "web_app": {"url": url},
        }]]
    }


def _build_role_keyboard() -> dict[str, Any]:
    """Three distinct WebApp entry points: smart entry, client onboarding, provider onboarding."""
    base_url = _webapp_url_for_role()
    customer_url = _webapp_url_for_role("customer")
    provider_url = _webapp_url_for_role("provider")
    keyboard: dict[str, Any] = {"inline_keyboard": []}
    if base_url:
        keyboard["inline_keyboard"].append([{
            "text": "Відкрити POMICH",
            "web_app": {"url": base_url},
        }])
    if customer_url:
        keyboard["inline_keyboard"].append([{
            "text": "Я клієнт",
            "web_app": {"url": customer_url},
        }])
    if provider_url:
        keyboard["inline_keyboard"].append([{
            "text": "Я партнер",
            "web_app": {"url": provider_url},
        }])
    return keyboard


def _handle_callback(callback: dict[str, Any], client: TelegramBotClient | None = None) -> dict[str, Any]:
    bot = client or TelegramBotClient()
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
    if data == "role:customer":
        bot.send_message(
            chat_id,
            "Реєстрація клієнта — натисніть кнопку нижче.",
            reply_markup=_build_webapp_keyboard(role="customer"),
        )
        return {"handled": True, "type": "role-customer"}
    if data == "role:provider":
        bot.send_message(
            chat_id,
            "Реєстрація партнера — натисніть кнопку нижче.",
            reply_markup=_build_webapp_keyboard(role="provider"),
        )
        return {"handled": True, "type": "role-provider"}
    return {"handled": True, "type": "callback-ignored"}


def handle_update(update: dict[str, Any], client: TelegramBotClient | None = None) -> dict[str, Any]:
    callback = update.get("callback_query") or {}
    if callback:
        return _handle_callback(callback, client)

    message = update.get("message") or {}
    chat = message.get("chat") or {}
    user = message.get("from") or {}
    chat_id = chat.get("id")

    if not chat_id:
        return {"handled": False, "reason": "chat_id missing"}

    bot = client or TelegramBotClient()

    text = (message.get("text") or "").strip()
    tg_user_id = str(user.get("id") or "")

    keyboard = _build_webapp_keyboard()

    if text.startswith("/start"):
        registered = _check_customer_registered(tg_user_id)
        if registered:
            profile = get_customer_profile(f"tg-{tg_user_id}")
            display_name = _customer_display_name(profile)
            greeting = (
                f"З поверненням, {display_name}! 👋\n\nНатисніть кнопку нижче, щоб відкрити додаток."
                if display_name
                else WELCOME_BACK_TEXT
            )
        else:
            greeting = WELCOME_TEXT
        reply_markup = _build_webapp_keyboard() if registered else _build_role_keyboard()
        bot.send_message(chat_id, greeting, reply_markup=reply_markup)
        return {"handled": True, "type": "start", "registered": registered}

    if text.startswith("/help"):
        bot.send_message(chat_id, HELP_TEXT, reply_markup=keyboard)
        return {"handled": True, "type": "help"}

    bot.send_message(
        chat_id,
        "Натисніть /start або кнопку нижче, щоб відкрити POMICH.",
        reply_markup=keyboard,
    )
    return {"handled": True, "type": "fallback"}


def send_message(
    chat_id: str,
    text: str,
    username: Optional[str] = None,
    *,
    parse_mode: str | None = None,
) -> dict[str, Any]:
    try:
        return TelegramBotClient().send_message(chat_id, text, parse_mode=parse_mode)
    except TelegramApiError as exc:
        return {"ok": False, "error": str(exc)}


def delete_message(chat_id: str | int, message_id: int) -> dict[str, Any]:
    try:
        return TelegramBotClient().delete_message(chat_id, message_id)
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
        return TelegramBotClient().send_message(str(chat_id), text)
    except TelegramApiError as exc:
        print(f"Telegram API error while notifying order: {exc}", flush=True)
        return {"ok": False, "error": str(exc)}


def notify_order_accepted(order: dict[str, Any]) -> dict[str, Any] | None:
    chat_id = str(order.get("chatId") or "").strip()
    if not chat_id:
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
        return TelegramBotClient().send_message(chat_id, text)
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
    for telegram_user_id in partner_telegram_user_ids_for_order(order_id, order):
        try:
            results.append(TelegramBotClient().send_message(str(telegram_user_id), text))
        except TelegramApiError as exc:
            print(f"Telegram API error while notifying partner cancel: {exc}", flush=True)
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
    offset: int | None = None

    try:
        client = TelegramBotClient()
        me = client.get_me()
        username = me.get("username") or "unknown"
        webhook_info = client.get_webhook_info()
        webhook_url = webhook_info.get("url") or ""
        drop_pending = _truthy(os.getenv("TELEGRAM_DROP_PENDING_UPDATES"), default=False)

        print("POMICH Telegram bot starting", flush=True)
        print("Mode: polling", flush=True)
        print(f"Bot: @{username} id={me.get('id')}", flush=True)
        print(
            f"Webhook: url={webhook_url or '<empty>'} "
            f"pending_update_count={webhook_info.get('pending_update_count', 0)} "
            f"last_error_message={webhook_info.get('last_error_message') or ''}",
            flush=True,
        )

        if webhook_url or drop_pending:
            client.delete_webhook(drop_pending_updates=drop_pending)
            print(f"Webhook disabled for polling. drop_pending_updates={drop_pending}", flush=True)

        print("Polling started", flush=True)

        while True:
            try:
                updates = client.get_updates(offset=offset, timeout_seconds=30)
            except TelegramApiError as exc:
                print(f"Telegram API error: {exc}", flush=True)
                time.sleep(5)
                continue

            for update in updates:
                update_id = update.get("update_id")
                if isinstance(update_id, int):
                    offset = update_id + 1
                try:
                    result = handle_update(update, client)
                    print(f"Update handled: {result}", flush=True)
                except Exception as exc:
                    print(f"handler error: {exc}", flush=True)
                    traceback.print_exc()
    except TelegramApiError as exc:
        print(f"Telegram connection error: {exc}", flush=True)
        raise
    finally:
        _release_runtime_lock()


def print_diagnostics() -> int:
    try:
        client = TelegramBotClient()
        me = client.get_me()
        webhook_info = client.get_webhook_info()
    except TelegramApiError as exc:
        print(f"Telegram diagnostics failed: {exc}")
        return 1

    print(f"Bot: @{me.get('username')} id={me.get('id')}")
    print(
        f"Webhook: url={webhook_info.get('url') or '<empty>'} "
        f"pending_update_count={webhook_info.get('pending_update_count', 0)} "
        f"last_error_message={webhook_info.get('last_error_message') or ''}"
    )
    return 0


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
