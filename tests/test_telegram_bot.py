import os
from unittest.mock import patch

from bot.telegram_bot import (
    _build_role_keyboard,
    _build_webapp_keyboard,
    _webapp_url_for_role,
    handle_update,
    notify_order_cancelled,
)


class FakeTelegramClient:
    def __init__(self, kind=None):
        self.kind = kind
        self.messages = []
        self.callback_answers = []

    def send_message(self, chat_id, text, *, reply_markup=None, parse_mode=None):
        self.messages.append({
            "chat_id": chat_id,
            "text": text,
            "reply_markup": reply_markup,
            "parse_mode": parse_mode,
        })
        return {"ok": True}

    def request(self, method, payload=None, *, timeout=30):
        if method == "answerCallbackQuery":
            self.callback_answers.append(payload)
            return {"ok": True}
        raise AssertionError(f"Unexpected request: {method}")


WEB_APP_BASE = "https://app.pomich.example/"


def test_webapp_url_for_role_appends_query():
    with patch.dict(
        os.environ,
        {
            "WEB_APP_URL": WEB_APP_BASE,
            "TELEGRAM_CUSTOMER_WEB_APP_URL": "",
            "TELEGRAM_PROVIDER_WEB_APP_URL": "",
            "TELEGRAM_BOT_TOKEN": "1:x",
        },
        clear=False,
    ):
        assert _webapp_url_for_role() == WEB_APP_BASE
        assert "role=customer" in (_webapp_url_for_role("customer") or "")
        assert "tgBot=customer" in (_webapp_url_for_role("customer") or "")
        assert "role=provider" in (_webapp_url_for_role("provider") or "")


def test_role_keyboard_uses_distinct_webapp_urls():
    with patch.dict(
        os.environ,
        {
            "WEB_APP_URL": WEB_APP_BASE,
            "TELEGRAM_CUSTOMER_WEB_APP_URL": "",
            "TELEGRAM_PROVIDER_WEB_APP_URL": "",
            "TELEGRAM_BOT_TOKEN": "1:x",
        },
        clear=False,
    ):
        keyboard = _build_role_keyboard()
        rows = keyboard["inline_keyboard"]
        assert len(rows) == 3
        assert rows[0][0]["text"] == "Відкрити POMICH"
        assert rows[0][0]["web_app"]["url"] == WEB_APP_BASE
        assert rows[1][0]["text"] == "Я клієнт"
        assert "role=customer" in rows[1][0]["web_app"]["url"]
        assert rows[2][0]["text"] == "Я партнер"
        assert "role=provider" in rows[2][0]["web_app"]["url"]


def test_start_command_returns_welcome_message():
    client = FakeTelegramClient(kind="customer")

    with patch.dict(os.environ, {"WEB_APP_URL": WEB_APP_BASE, "TELEGRAM_BOT_TOKEN": "1:x"}, clear=False):
        with patch("bot.telegram_bot.upsert_telegram_customer_profile", return_value={}):
            with patch("bot.telegram_bot._check_customer_registered", return_value=False):
                result = handle_update({
                    "update_id": 1,
                    "message": {
                        "chat": {"id": 42},
                        "from": {"id": 42, "first_name": "Аня"},
                        "text": "/start",
                    },
                }, client, bot_kind="customer")

    assert result["handled"] is True
    assert result["type"] == "start"
    assert "POMICH" in client.messages[0]["text"]
    markup = client.messages[0]["reply_markup"]
    assert markup["inline_keyboard"][0][0]["text"] == "Викликати допомогу"


def test_start_registered_user_gets_customer_webapp_button():
    client = FakeTelegramClient(kind="customer")

    with patch.dict(os.environ, {"WEB_APP_URL": WEB_APP_BASE, "TELEGRAM_BOT_TOKEN": "1:x"}, clear=False):
        with patch("bot.telegram_bot.upsert_telegram_customer_profile", return_value={}):
            with patch("bot.telegram_bot._check_customer_registered", return_value=True):
                with patch("bot.telegram_bot.get_customer_profile", return_value={"name": "Аня", "phone": "+380671112233"}):
                    result = handle_update({
                        "update_id": 5,
                        "message": {
                            "chat": {"id": 42},
                            "from": {"id": 42, "first_name": "Аня"},
                            "text": "/start",
                        },
                    }, client, bot_kind="customer")

    assert result["registered"] is True
    assert "З поверненням" in client.messages[0]["text"]
    assert client.messages[0]["reply_markup"]["inline_keyboard"][0][0]["text"] == "Викликати допомогу"


def test_legacy_role_callback_sends_role_specific_webapp():
    client = FakeTelegramClient(kind="customer")

    with patch.dict(os.environ, {"WEB_APP_URL": WEB_APP_BASE, "TELEGRAM_BOT_TOKEN": "1:x"}, clear=False):
        result = handle_update({
            "update_id": 6,
            "callback_query": {
                "id": "cb-1",
                "data": "role:customer",
                "message": {"chat": {"id": 42}},
            },
        }, client, bot_kind="customer")

    assert result["type"] == "role-customer"
    markup = client.messages[0]["reply_markup"]
    assert "role=customer" in markup["inline_keyboard"][0][0]["web_app"]["url"]


def test_help_command():
    client = FakeTelegramClient(kind="customer")

    with patch("bot.telegram_bot.upsert_telegram_customer_profile", return_value={}):
        result = handle_update({
            "update_id": 2,
            "message": {
                "chat": {"id": 42},
                "from": {"id": 42},
                "text": "/help",
            },
        }, client, bot_kind="customer")

    assert result["handled"] is True
    assert result["type"] == "help"
    assert "допомога" in client.messages[0]["text"].lower() or "POMICH" in client.messages[0]["text"]


def test_fallback_message():
    client = FakeTelegramClient(kind="customer")

    with patch("bot.telegram_bot.upsert_telegram_customer_profile", return_value={}):
        result = handle_update({
            "update_id": 3,
            "message": {
                "chat": {"id": 42},
                "from": {"id": 42},
                "text": "Привіт",
            },
        }, client, bot_kind="customer")

    assert result["handled"] is True
    assert result["type"] == "fallback"
    assert "/start" in client.messages[0]["text"]


def test_missing_chat_id():
    result = handle_update({"update_id": 4, "message": {}})
    assert result["handled"] is False


def test_webapp_keyboard_without_url_returns_none():
    with patch.dict(
        os.environ,
        {
            "WEB_APP_URL": "",
            "TELEGRAM_CUSTOMER_WEB_APP_URL": "",
            "TELEGRAM_PROVIDER_WEB_APP_URL": "",
            "VITE_WEB_APP_URL": "",
        },
        clear=False,
    ):
        assert _build_webapp_keyboard(kind="customer") is None


def test_notify_order_cancelled_sends_partner_message():
    client = FakeTelegramClient(kind="provider")

    with patch("bot.telegram_bot.TelegramBotClient", return_value=client) as ctor:
        with patch("bot.order_store.partner_telegram_user_ids_for_order", return_value=["445566"]):
            results = notify_order_cancelled({"id": "PM-123456"})

    assert results[0]["ok"] is True
    assert client.messages[0]["chat_id"] == "445566"
    assert client.messages[0]["text"] == "Заявку #PM-123456 скасовано клієнтом"
    assert ctor.call_args_list[0].kwargs.get("kind") == "provider"
