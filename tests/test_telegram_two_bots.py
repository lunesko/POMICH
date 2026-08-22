"""Tests for Telegram two-bot registry, initData verification, webhooks, and notify routing."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
import urllib.parse
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from bot import order_store
from bot.telegram_auth import verify_telegram_init_data_any_bot
from bot.telegram_bot import (
    handle_update,
    notify_dispatch_offers,
    notify_order_accepted,
    notify_order_cancelled,
    notify_order_created,
)
from bot.telegram_config import (
    get_telegram_bot_config,
    get_telegram_bot_configs,
    get_telegram_bot_token,
    get_telegram_web_app_url,
)


def _signed_init_data(payload: dict[str, str], token: str) -> str:
    data_check_string = "\n".join(f"{key}={value}" for key, value in sorted(payload.items()))
    secret_key = hmac.new(b"WebAppData", token.encode("utf-8"), hashlib.sha256).digest()
    signature = hmac.new(secret_key, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()
    return urllib.parse.urlencode({**payload, "hash": signature})


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
            "kind": self.kind,
        })
        return {"ok": True, "result": {"message_id": 1}}

    def request(self, method, payload=None, *, timeout=30):
        if method == "answerCallbackQuery":
            self.callback_answers.append(payload)
            return {"ok": True}
        raise AssertionError(f"Unexpected request: {method}")


TWO_BOT_ENV = {
    "TELEGRAM_CUSTOMER_BOT_TOKEN": "111:customer-secret",
    "TELEGRAM_PROVIDER_BOT_TOKEN": "222:provider-secret",
    "TELEGRAM_CUSTOMER_BOT_USERNAME": "pomich_ua_bot",
    "TELEGRAM_PROVIDER_BOT_USERNAME": "pomich_help_bot",
    "TELEGRAM_CUSTOMER_WEB_APP_URL": "https://pomich.help/?role=customer&tgBot=customer",
    "TELEGRAM_PROVIDER_WEB_APP_URL": "https://pomich.help/?role=provider&tgBot=provider",
    "WEB_APP_URL": "https://pomich.help",
}


@pytest.fixture
def two_bots(monkeypatch):
    for key, value in TWO_BOT_ENV.items():
        monkeypatch.setenv(key, value)
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("VITE_TELEGRAM_BOT_TOKEN", raising=False)


def test_bot_registry_returns_both_configs(two_bots):
    configs = get_telegram_bot_configs()
    kinds = {c.kind for c in configs}
    assert kinds == {"customer", "provider"}
    assert get_telegram_bot_token("customer") == "111:customer-secret"
    assert get_telegram_bot_token("provider") == "222:provider-secret"
    assert "tgBot=customer" in (get_telegram_web_app_url("customer") or "")
    assert "tgBot=provider" in (get_telegram_web_app_url("provider") or "")
    customer = get_telegram_bot_config("customer")
    assert customer is not None
    assert customer.username == "pomich_ua_bot"


def test_bot_registry_falls_back_to_legacy_token(monkeypatch):
    monkeypatch.delenv("TELEGRAM_CUSTOMER_BOT_TOKEN", raising=False)
    monkeypatch.delenv("TELEGRAM_PROVIDER_BOT_TOKEN", raising=False)
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "999:legacy")
    monkeypatch.setenv("WEB_APP_URL", "https://pomich.help")
    assert get_telegram_bot_token("customer") == "999:legacy"
    assert get_telegram_bot_token("provider") == "999:legacy"


def test_verify_init_data_any_bot_prefers_hint_then_other(two_bots):
    customer_token = TWO_BOT_ENV["TELEGRAM_CUSTOMER_BOT_TOKEN"]
    provider_token = TWO_BOT_ENV["TELEGRAM_PROVIDER_BOT_TOKEN"]
    payload = {
        "auth_date": str(int(time.time())),
        "user": json.dumps({"id": 42, "first_name": "Vitalii"}, separators=(",", ":")),
    }
    customer_init = _signed_init_data(payload, customer_token)
    provider_init = _signed_init_data(payload, provider_token)

    verified_customer = verify_telegram_init_data_any_bot(customer_init, "provider")
    assert verified_customer["botKind"] == "customer"
    assert verified_customer["user"]["id"] == 42

    verified_provider = verify_telegram_init_data_any_bot(provider_init, "customer")
    assert verified_provider["botKind"] == "provider"

    with pytest.raises(ValueError):
        verify_telegram_init_data_any_bot(customer_init + "x", None)


def test_customer_start_uses_customer_menu(two_bots):
    client = FakeTelegramClient(kind="customer")
    with patch("bot.telegram_bot.upsert_telegram_customer_profile", return_value={}):
        with patch("bot.telegram_bot._check_customer_registered", return_value=False):
            result = handle_update(
                {
                    "update_id": 1,
                    "message": {
                        "chat": {"id": 42},
                        "from": {"id": 42, "first_name": "Аня"},
                        "text": "/start",
                    },
                },
                client,
                bot_kind="customer",
            )
    assert result["botKind"] == "customer"
    assert "Викликати допомогу" in json.dumps(client.messages[0]["reply_markup"], ensure_ascii=False)


def test_provider_start_uses_partner_menu(two_bots):
    client = FakeTelegramClient(kind="provider")
    with patch("bot.telegram_bot.upsert_telegram_customer_profile", return_value={}):
        with patch("bot.telegram_bot._check_provider_registered", return_value=False):
            result = handle_update(
                {
                    "update_id": 2,
                    "message": {
                        "chat": {"id": 99},
                        "from": {"id": 99, "first_name": "Партнер"},
                        "text": "/start",
                    },
                },
                client,
                bot_kind="provider",
            )
    assert result["botKind"] == "provider"
    markup = json.dumps(client.messages[0]["reply_markup"], ensure_ascii=False)
    assert "Кабінет партнера" in markup
    assert "screen=cabinet" in markup
    assert "Вийти на лінію" in markup
    assert "screen=duty" in markup
    assert "Активні офери" in markup
    assert "screen=offers" in markup
    assert "Підтвердити профіль" in markup
    assert "screen=verify" in markup


def test_customer_start_buttons_include_screen_deep_links(two_bots):
    client = FakeTelegramClient(kind="customer")
    with patch("bot.telegram_bot.upsert_telegram_customer_profile", return_value={"id": "tg-42", "name": "Аня", "phone": "+380501112233"}):
        with patch("bot.telegram_bot._check_customer_registered", return_value=True):
            result = handle_update(
                {
                    "update_id": 1,
                    "message": {
                        "chat": {"id": 42},
                        "from": {"id": 42, "first_name": "Аня"},
                        "text": "/start",
                    },
                },
                client,
                bot_kind="customer",
            )
    assert result["botKind"] == "customer"
    markup = json.dumps(client.messages[0]["reply_markup"], ensure_ascii=False)
    assert "Викликати допомогу" in markup
    assert "screen=order" in markup
    assert "Мій профіль" in markup
    assert "screen=profile" in markup
    assert "Історія" in markup
    assert "screen=history" in markup


def test_webhook_routes_by_kind(two_bots, monkeypatch, tmp_path):
    monkeypatch.setenv("POMICH_RUNTIME", "dev")
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", "local-customer-session-secret-for-tests")
    monkeypatch.setenv("POMICH_STORAGE_BACKEND", "json")
    monkeypatch.setenv("POMICH_CUSTOMER_STORE_PATH", str(tmp_path / "customers.json"))
    from bot.fastapi_app import app

    http = TestClient(app)
    with patch("bot.routers.telegram.handle_update", return_value={"handled": True, "type": "start"}) as mocked:
        customer = http.post("/api/telegram/customer/webhook", json={"update_id": 1, "message": {"chat": {"id": 1}, "text": "/start"}})
        provider = http.post("/api/telegram/provider/webhook", json={"update_id": 2, "message": {"chat": {"id": 2}, "text": "/start"}})
        legacy = http.post("/api/telegram/webhook", json={"update_id": 3, "message": {"chat": {"id": 3}, "text": "/start"}})

    assert customer.status_code == 200
    assert provider.status_code == 200
    assert legacy.status_code == 200
    assert mocked.call_args_list[0].kwargs.get("bot_kind") == "customer" or mocked.call_args_list[0][1].get("bot_kind") == "customer"
    # positional/keyword flexible assert
    kinds = []
    for call in mocked.call_args_list:
        if call.kwargs.get("bot_kind"):
            kinds.append(call.kwargs["bot_kind"])
        elif len(call.args) >= 2:
            kinds.append(call.args[1])
    # handle_update(payload, bot_kind=...) — only kwargs in our router
    assert [c.kwargs["bot_kind"] for c in mocked.call_args_list] == ["customer", "provider", "customer"]


def test_telegram_session_includes_bot_kind_and_provider_account(two_bots, monkeypatch, tmp_path):
    monkeypatch.setenv("POMICH_RUNTIME", "dev")
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", "local-customer-session-secret-for-tests-xx")
    monkeypatch.setenv("POMICH_STORAGE_BACKEND", "json")
    monkeypatch.setenv("POMICH_CUSTOMER_STORE_PATH", str(tmp_path / "customers.json"))
    monkeypatch.setenv("POMICH_PROVIDER_STORE_PATH", str(tmp_path / "providers.json"))
    from bot.fastapi_app import app

    provider_token = TWO_BOT_ENV["TELEGRAM_PROVIDER_BOT_TOKEN"]
    init_data = _signed_init_data(
        {
            "auth_date": str(int(time.time())),
            "user": json.dumps({"id": 77, "first_name": "Partner", "username": "p77"}, separators=(",", ":")),
        },
        provider_token,
    )
    http = TestClient(app)
    response = http.post(
        "/api/auth/customer/telegram/session",
        headers={
            "X-Telegram-Init-Data": init_data,
            "X-POMICH-Telegram-Bot": "provider",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["customerId"] == "tg-77"
    assert body["role"] == "customer"  # never auto-provider
    assert body["telegramBotKind"] == "provider"
    assert body["preferredRole"] == "provider"
    assert "providerAccount" in body
    assert body["providerAccount"]["linked"] is False


def test_provider_bot_session_reports_active_linked_account_and_self_session(two_bots, monkeypatch, tmp_path):
    monkeypatch.setenv("POMICH_RUNTIME", "dev")
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", "local-customer-session-secret-for-tests-xx")
    monkeypatch.setenv("POMICH_PROVIDER_TOKEN", "local-provider-session-secret-for-tests")
    monkeypatch.setenv("POMICH_STORAGE_BACKEND", "json")
    monkeypatch.setenv("POMICH_CUSTOMER_STORE_PATH", str(tmp_path / "customers.json"))
    monkeypatch.setenv("POMICH_PROVIDER_STORE_PATH", str(tmp_path / "providers.json"))
    monkeypatch.setenv("POMICH_PROVIDER_ACCOUNTS", json.dumps([
        {
            "id": "provider-account-77",
            "providerId": "provider-tg-77",
            "username": "partner77",
            "password": "provider-pass",
            "status": "active",
        },
    ]))
    order_store.save_providers([
        {
            "id": "provider-tg-77",
            "name": "Partner 77",
            "phone": "+380501112233",
            "vehicle": "Renault Master",
            "plate": "AA1234BB",
            "specialties": ["tow"],
            "verificationStatus": "verified",
            "registeredAt": "2026-08-22T12:00:00",
        },
    ])
    from bot.fastapi_app import app

    provider_token = TWO_BOT_ENV["TELEGRAM_PROVIDER_BOT_TOKEN"]
    init_data = _signed_init_data(
        {
            "auth_date": str(int(time.time())),
            "user": json.dumps({"id": 77, "first_name": "Partner", "username": "p77"}, separators=(",", ":")),
        },
        provider_token,
    )
    http = TestClient(app)

    response = http.post(
        "/api/auth/customer/telegram/session",
        headers={
            "X-Telegram-Init-Data": init_data,
            "X-POMICH-Telegram-Bot": "provider",
        },
    )
    body = response.json()
    self_session = http.post(
        "/api/auth/provider/self/session",
        headers={"Authorization": f"Bearer {body['accessToken']}"},
        json={"customerId": body["customerId"]},
    )

    assert response.status_code == 200
    assert body["role"] == "customer"
    assert body["customerId"] == "tg-77"
    assert body["providerAccount"]["linked"] is True
    assert body["providerAccount"]["providerId"] == "provider-tg-77"
    assert body["providerAccount"]["verificationStatus"] == "verified"
    assert body["providerAccount"]["canOpenProviderSession"] is True
    assert body["providerAccount"]["authAccount"] == {
        "id": "provider-account-77",
        "username": "partner77",
        "status": "active",
        "active": True,
        "passwordResetRequired": False,
        "required": True,
    }
    assert self_session.status_code == 200
    assert self_session.json()["role"] == "provider"
    assert self_session.json()["providerId"] == "provider-tg-77"
    assert self_session.json()["username"] == "partner77"
    assert self_session.json()["passwordResetRequired"] is False


def test_provider_bot_linked_disabled_account_cannot_open_self_session(two_bots, monkeypatch, tmp_path):
    monkeypatch.setenv("POMICH_RUNTIME", "dev")
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", "local-customer-session-secret-for-tests-xx")
    monkeypatch.setenv("POMICH_PROVIDER_TOKEN", "local-provider-session-secret-for-tests")
    monkeypatch.setenv("POMICH_STORAGE_BACKEND", "json")
    monkeypatch.setenv("POMICH_CUSTOMER_STORE_PATH", str(tmp_path / "customers.json"))
    monkeypatch.setenv("POMICH_PROVIDER_STORE_PATH", str(tmp_path / "providers.json"))
    monkeypatch.setenv("POMICH_PROVIDER_ACCOUNTS", json.dumps([
        {
            "id": "provider-account-88",
            "providerId": "provider-tg-88",
            "username": "partner88",
            "password": "provider-pass",
            "status": "disabled",
        },
    ]))
    order_store.save_providers([
        {
            "id": "provider-tg-88",
            "name": "Partner 88",
            "phone": "+380501112233",
            "vehicle": "Renault Master",
            "plate": "AA1234BB",
            "specialties": ["tow"],
            "verificationStatus": "verified",
            "registeredAt": "2026-08-22T12:00:00",
        },
    ])
    from bot.fastapi_app import app

    provider_token = TWO_BOT_ENV["TELEGRAM_PROVIDER_BOT_TOKEN"]
    init_data = _signed_init_data(
        {
            "auth_date": str(int(time.time())),
            "user": json.dumps({"id": 88, "first_name": "Partner", "username": "p88"}, separators=(",", ":")),
        },
        provider_token,
    )
    http = TestClient(app)

    response = http.post(
        "/api/auth/customer/telegram/session",
        headers={
            "X-Telegram-Init-Data": init_data,
            "X-POMICH-Telegram-Bot": "provider",
        },
    )
    body = response.json()
    self_session = http.post(
        "/api/auth/provider/self/session",
        headers={"Authorization": f"Bearer {body['accessToken']}"},
        json={"customerId": body["customerId"]},
    )

    assert response.status_code == 200
    assert body["providerAccount"]["linked"] is True
    assert body["providerAccount"]["canOpenProviderSession"] is False
    assert body["providerAccount"]["authAccount"]["status"] == "disabled"
    assert body["providerAccount"]["authAccount"]["active"] is False
    assert self_session.status_code == 403
    assert self_session.json()["detail"] == "provider_account_disabled"


def test_provider_bot_linked_reset_required_account_cannot_open_self_session(two_bots, monkeypatch, tmp_path):
    monkeypatch.setenv("POMICH_RUNTIME", "dev")
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", "local-customer-session-secret-for-tests-xx")
    monkeypatch.setenv("POMICH_PROVIDER_TOKEN", "local-provider-session-secret-for-tests")
    monkeypatch.setenv("POMICH_STORAGE_BACKEND", "json")
    monkeypatch.setenv("POMICH_CUSTOMER_STORE_PATH", str(tmp_path / "customers.json"))
    monkeypatch.setenv("POMICH_PROVIDER_STORE_PATH", str(tmp_path / "providers.json"))
    monkeypatch.setenv("POMICH_PROVIDER_ACCOUNTS", json.dumps([
        {
            "id": "provider-account-99",
            "providerId": "provider-tg-99",
            "username": "partner99",
            "password": "temporary-pass",
            "status": "active",
            "passwordResetRequired": True,
        },
    ]))
    order_store.save_providers([
        {
            "id": "provider-tg-99",
            "name": "Partner 99",
            "phone": "+380501112233",
            "vehicle": "Renault Master",
            "plate": "AA1234BB",
            "specialties": ["tow"],
            "verificationStatus": "verified",
            "registeredAt": "2026-08-22T12:00:00",
        },
    ])
    from bot.fastapi_app import app

    provider_token = TWO_BOT_ENV["TELEGRAM_PROVIDER_BOT_TOKEN"]
    init_data = _signed_init_data(
        {
            "auth_date": str(int(time.time())),
            "user": json.dumps({"id": 99, "first_name": "Partner", "username": "p99"}, separators=(",", ":")),
        },
        provider_token,
    )
    http = TestClient(app)

    response = http.post(
        "/api/auth/customer/telegram/session",
        headers={
            "X-Telegram-Init-Data": init_data,
            "X-POMICH-Telegram-Bot": "provider",
        },
    )
    body = response.json()
    self_session = http.post(
        "/api/auth/provider/self/session",
        headers={"Authorization": f"Bearer {body['accessToken']}"},
        json={"customerId": body["customerId"]},
    )

    assert response.status_code == 200
    assert body["providerAccount"]["linked"] is True
    assert body["providerAccount"]["canOpenProviderSession"] is False
    assert body["providerAccount"]["authAccount"]["status"] == "active"
    assert body["providerAccount"]["authAccount"]["active"] is True
    assert body["providerAccount"]["authAccount"]["passwordResetRequired"] is True
    assert self_session.status_code == 403
    assert self_session.json()["detail"] == "provider_password_reset_required"


def test_notify_order_created_uses_customer_bot(two_bots):
    fake = FakeTelegramClient(kind="customer")
    with patch("bot.telegram_bot.TelegramBotClient", return_value=fake) as ctor:
        notify_order_created("42", {"id": "PM-1", "service": "tow"})
    assert ctor.call_args.kwargs.get("kind") == "customer"
    assert fake.messages[0]["chat_id"] == "42"


def test_notify_dispatch_offers_uses_provider_bot(two_bots):
    fake = FakeTelegramClient(kind="provider")
    with patch("bot.telegram_bot.TelegramBotClient", return_value=fake) as ctor:
        with patch("bot.order_store.resolve_provider_telegram_user_id", return_value="991"):
            results = notify_dispatch_offers(
                {"id": "PM-2", "service": "battery"},
                [{"id": "OF-1", "orderId": "PM-2", "providerId": "p1", "status": "pending", "distanceKm": 1.2}],
            )
    assert results
    assert ctor.call_args.kwargs.get("kind") == "provider"
    assert fake.messages[0]["chat_id"] == "991"
    assert "Нова заявка" in fake.messages[0]["text"]


def test_notify_order_cancelled_partners_use_provider_bot(two_bots):
    fake = FakeTelegramClient(kind="provider")
    with patch("bot.telegram_bot.TelegramBotClient", return_value=fake) as ctor:
        with patch("bot.order_store.partner_telegram_user_ids_for_order", return_value=["445566"]):
            notify_order_cancelled({"id": "PM-3", "customerId": "tg-1", "telegramUserId": "1"})
    kinds = [call.kwargs.get("kind") for call in ctor.call_args_list]
    assert "provider" in kinds
    partner_msgs = [m for m in fake.messages if m["chat_id"] == "445566"]
    assert partner_msgs
    assert "скасовано" in partner_msgs[0]["text"]


def test_notify_order_accepted_uses_customer_bot(two_bots):
    fake = FakeTelegramClient(kind="customer")
    with patch("bot.telegram_bot.TelegramBotClient", return_value=fake) as ctor:
        notify_order_accepted({"id": "PM-4", "telegramUserId": "42", "providerName": "Олег"})
    assert ctor.call_args.kwargs.get("kind") == "customer"
