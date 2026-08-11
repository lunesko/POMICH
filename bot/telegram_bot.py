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

from bot.order_store import get_telegram_session, load_orders, save_order, save_telegram_session

START_TEXT = (
    "Вітаємо у POMICH 👋\n\n"
    "Оберіть роль, щоб продовжити."
)

HELP_TEXT = (
    "POMICH допоможе викликати евакуатор, запуск АКБ, допомогу з колесом, "
    "пальним або іншою несправністю."
)

SERVICE_BUTTONS: dict[str, str] = {
    "tow": "🚛 Евакуатор",
    "battery": "🔋 Не заводиться",
    "wheel": "🛞 Проблема з колесом",
    "fuel": "⛽ Закінчилось пальне",
    "lockout": "🔑 Не можу відкрити авто",
    "mechanic": "🔧 Інша несправність",
}

ROLE_BUTTONS: dict[str, str] = {
    "customer": "👤 Клієнт",
    "provider": "🚛 Партнер",
    "admin": "🧭 Адмін",
}

SESSION_STATE: dict[str, dict[str, Any]] = {}


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
            "allowed_updates": ["message"],
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


def build_start_keyboard(web_app_url: str | None = None) -> dict[str, Any]:
    help_button: dict[str, Any] = {"text": "🆘 Викликати допомогу"}
    if _is_public_https_url(web_app_url):
        help_button["web_app"] = {"url": web_app_url}

    return {
        "keyboard": [
            [ROLE_BUTTONS["customer"], ROLE_BUTTONS["provider"], ROLE_BUTTONS["admin"]],
            [help_button],
            [{"text": "📍 Надіслати геолокацію", "request_location": True}],
            [{"text": "ℹ️ Допомога"}, {"text": "📋 Мої заявки"}],
        ],
        "resize_keyboard": True,
        "one_time_keyboard": False,
    }


def build_service_keyboard() -> dict[str, Any]:
    values = list(SERVICE_BUTTONS.values())
    return {
        "keyboard": [
            values[0:2],
            values[2:4],
            values[4:6],
            ["📋 Мої заявки", "⬅️ Назад"],
        ],
        "resize_keyboard": True,
        "one_time_keyboard": False,
    }


def build_provider_keyboard() -> dict[str, Any]:
    return {
        "keyboard": [
            ["✅ Прийняти заявку", "🚗 Я в дорозі"],
            ["📍 Я на місці", "🏁 Завершити"],
            ["📋 Мої заявки", "⬅️ Назад"],
        ],
        "resize_keyboard": True,
        "one_time_keyboard": False,
    }


def build_admin_keyboard(web_app_url: str | None = None) -> dict[str, Any]:
    admin_button: dict[str, Any] = {"text": "🧭 Відкрити адмін панель"}
    admin_url = f"{web_app_url}?role=admin" if web_app_url else None
    if _is_public_https_url(admin_url):
        admin_button["web_app"] = {"url": admin_url}

    return {
        "keyboard": [
            [admin_button],
            ["📋 Усі заявки", "🔄 Оновити статуси"],
            ["👤 Клієнт", "🚛 Партнер"],
            ["⬅️ Назад"],
        ],
        "resize_keyboard": True,
        "one_time_keyboard": False,
    }


def build_reply(message: str, username: Optional[str] = None) -> str:
    text = (message or "").strip()
    if not text:
        return "Надішліть /start, щоб почати"

    if text.startswith("/start"):
        return START_TEXT

    if text.startswith("/help") or text == "ℹ️ Допомога":
        return HELP_TEXT

    if text == ROLE_BUTTONS["customer"]:
        return "Клієнтський сценарій активний. Натисніть 🆘 Викликати допомогу або надішліть геолокацію."

    if text == ROLE_BUTTONS["provider"]:
        return "Партнерський сценарій активний. Тут можна приймати заявку та оновлювати статус виконання."

    if text == ROLE_BUTTONS["admin"]:
        return "Адмін сценарій активний. Тут можна дивитися заявки та керувати статусами."

    name = (username or "клієнте").strip()
    if text == "🆘 Викликати допомогу":
        if get_web_app_url():
            return f"{name}, відкрийте POMICH через кнопку нижче або надішліть геолокацію."
        return (
            "Для локальної розробки WEB_APP_URL ще не заданий як публічний HTTPS URL.\n\n"
            "Можете продовжити прямо в боті: надішліть геолокацію або оберіть послугу."
        )

    return "Я розумію /start, /help, геолокацію та вибір послуги."


def _service_key_from_text(text: str) -> str | None:
    normalized = text.strip().lower()
    for key, label in SERVICE_BUTTONS.items():
        if normalized == label.lower() or normalized == label.split(" ", 1)[-1].lower():
            return key
    return None


def _safe_location_text(latitude: float, longitude: float) -> str:
    return f"{latitude:.5f},{longitude:.5f}"


def _session_for(chat_id: str) -> dict[str, Any]:
    return SESSION_STATE.setdefault(chat_id, {})


def _create_order_from_session(chat_id: str, user: dict[str, Any], service_key: str) -> dict[str, Any]:
    session = {**(get_telegram_session(chat_id) or {}), **_session_for(chat_id)}
    location = session.get("location") or {}
    latitude = location.get("latitude")
    longitude = location.get("longitude")
    customer_location = (
        f"Telegram location {_safe_location_text(float(latitude), float(longitude))}"
        if latitude is not None and longitude is not None
        else "Telegram chat"
    )

    return save_order(
        {
            "source": "telegram-bot",
            "service": service_key,
            "customerLocation": customer_location,
            "customerCoordinates": location if location else None,
            "destination": "Уточнюється в чаті",
            "distanceKm": 1.0,
            "status": "created",
            "chatId": chat_id,
            "telegramUserId": user.get("id"),
            "telegramUsername": user.get("username"),
        }
    )


def _format_order_summary(order: dict[str, Any]) -> str:
    service = SERVICE_BUTTONS.get(str(order.get("service")), str(order.get("service") or "Послуга"))
    return (
        f"✅ Заявку створено: #{order.get('id')}\n\n"
        f"Послуга: {service}\n"
        "Статус: шукаємо допомогу поруч."
    )


def _list_orders_for_chat(chat_id: str) -> str:
    orders = [order for order in load_orders() if str(order.get("chatId")) == str(chat_id)]
    if not orders:
        return "Поки немає заявок. Натисніть 🆘 Викликати допомогу або надішліть геолокацію."

    latest = orders[-3:]
    lines = ["Ваші останні заявки:"]
    for order in latest:
        service = SERVICE_BUTTONS.get(str(order.get("service")), str(order.get("service") or "Послуга"))
        lines.append(f"#{order.get('id')} · {service} · {order.get('status', 'created')}")
    return "\n".join(lines)


def _list_admin_orders() -> str:
    orders = load_orders()
    if not orders:
        return "Заявок поки немає."

    latest = orders[-8:]
    lines = ["Останні заявки:"]
    for order in latest:
        service = SERVICE_BUTTONS.get(str(order.get("service")), str(order.get("service") or "Послуга"))
        lines.append(f"#{order.get('id')} · {service} · {order.get('status', 'created')}")
    return "\n".join(lines)


def handle_update(update: dict[str, Any], client: TelegramBotClient | None = None) -> dict[str, Any]:
    bot = client or TelegramBotClient()
    message = update.get("message") or {}
    chat = message.get("chat") or {}
    user = message.get("from") or {}
    chat_id = chat.get("id")

    if not chat_id:
        return {"handled": False, "reason": "chat_id missing"}

    chat_id_text = str(chat_id)
    text = (message.get("text") or "").strip()
    location = message.get("location")

    if location:
        latitude = float(location["latitude"])
        longitude = float(location["longitude"])
        session_payload = {
            "telegramUserId": user.get("id"),
            "telegramUsername": user.get("username"),
            "firstName": user.get("first_name"),
            "location": {"latitude": latitude, "longitude": longitude},
        }
        _session_for(chat_id_text).update(session_payload)
        save_telegram_session(chat_id_text, session_payload)
        print(
            f"Location received telegram_user_id={user.get('id')} "
            f"latitude={latitude:.5f} longitude={longitude:.5f}",
            flush=True,
        )
        bot.send_message(
            chat_id,
            "📍 Геолокацію отримано.\n\nЩо сталося?",
            reply_markup=build_service_keyboard(),
        )
        return {"handled": True, "type": "location"}

    if text.startswith("/start") or text == "⬅️ Назад":
        bot.send_message(chat_id, START_TEXT, reply_markup=build_start_keyboard(get_web_app_url()))
        return {"handled": True, "type": "start"}

    if text == ROLE_BUTTONS["customer"]:
        _session_for(chat_id_text)["role"] = "customer"
        save_telegram_session(chat_id_text, {"role": "customer", "telegramUserId": user.get("id")})
        bot.send_message(chat_id, build_reply(text, user.get("first_name")), reply_markup=build_start_keyboard(get_web_app_url()))
        return {"handled": True, "type": "role", "role": "customer"}

    if text == ROLE_BUTTONS["provider"]:
        _session_for(chat_id_text)["role"] = "provider"
        save_telegram_session(chat_id_text, {"role": "provider", "telegramUserId": user.get("id")})
        bot.send_message(chat_id, build_reply(text, user.get("first_name")), reply_markup=build_provider_keyboard())
        return {"handled": True, "type": "role", "role": "provider"}

    if text == ROLE_BUTTONS["admin"]:
        _session_for(chat_id_text)["role"] = "admin"
        save_telegram_session(chat_id_text, {"role": "admin", "telegramUserId": user.get("id")})
        bot.send_message(chat_id, build_reply(text, user.get("first_name")), reply_markup=build_admin_keyboard(get_web_app_url()))
        return {"handled": True, "type": "role", "role": "admin"}

    if text.startswith("/help") or text == "ℹ️ Допомога":
        bot.send_message(chat_id, HELP_TEXT, reply_markup=build_start_keyboard(get_web_app_url()))
        return {"handled": True, "type": "help"}

    if text in {"/admin", "📋 Усі заявки", "🔄 Оновити статуси", "🧭 Відкрити адмін панель"}:
        bot.send_message(chat_id, _list_admin_orders(), reply_markup=build_admin_keyboard(get_web_app_url()))
        return {"handled": True, "type": "admin_orders"}

    if text in {"/status", "/orders", "📋 Мої заявки"}:
        bot.send_message(chat_id, _list_orders_for_chat(chat_id_text), reply_markup=build_start_keyboard(get_web_app_url()))
        return {"handled": True, "type": "orders"}

    if text == "🆘 Викликати допомогу":
        bot.send_message(chat_id, build_reply(text, user.get("first_name")), reply_markup=build_service_keyboard())
        return {"handled": True, "type": "help_request"}

    service_key = _service_key_from_text(text)
    if service_key:
        _session_for(chat_id_text)["service"] = service_key
        save_telegram_session(chat_id_text, {"service": service_key, "telegramUserId": user.get("id")})
        order = _create_order_from_session(chat_id_text, user, service_key)
        bot.send_message(chat_id, _format_order_summary(order), reply_markup=build_start_keyboard(get_web_app_url()))
        return {"handled": True, "type": "service", "orderId": order.get("id")}

    bot.send_message(chat_id, build_reply(text, user.get("first_name")), reply_markup=build_start_keyboard(get_web_app_url()))
    return {"handled": True, "type": "fallback"}


def send_message(chat_id: str, text: str, username: Optional[str] = None) -> dict[str, Any]:
    try:
        return TelegramBotClient().send_message(chat_id, text)
    except TelegramApiError as exc:
        return {"ok": False, "error": str(exc), "reply": build_reply(text, username)}


def notify_order_created(chat_id: str | None, order: dict[str, Any]) -> dict[str, Any] | None:
    if not chat_id:
        return None

    try:
        return TelegramBotClient().send_message(str(chat_id), _format_order_summary(order))
    except TelegramApiError as exc:
        print(f"Telegram API error while notifying order: {exc}", flush=True)
        return {"ok": False, "error": str(exc)}


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
