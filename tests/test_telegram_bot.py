from bot.telegram_bot import build_reply, build_start_keyboard, handle_update


class FakeTelegramClient:
    def __init__(self):
        self.messages = []

    def send_message(self, chat_id, text, *, reply_markup=None, parse_mode=None):
        self.messages.append({
            "chat_id": chat_id,
            "text": text,
            "reply_markup": reply_markup,
            "parse_mode": parse_mode,
        })
        return {"ok": True}


def test_start_command_returns_welcome_message():
    reply = build_reply("/start", "Аня")

    assert "POMICH" in reply
    assert "Вітаємо" in reply


def test_start_keyboard_requests_location():
    keyboard = build_start_keyboard()

    assert keyboard["keyboard"][0] == ["👤 Клієнт", "🚛 Партнер", "🧭 Адмін"]
    location_button = keyboard["keyboard"][2][0]
    assert location_button["text"] == "📍 Надіслати геолокацію"
    assert location_button["request_location"] is True


def test_start_update_sends_real_bot_message_shape():
    client = FakeTelegramClient()

    result = handle_update({
        "update_id": 1,
        "message": {
            "chat": {"id": 42},
            "from": {"id": 42, "first_name": "Аня"},
            "text": "/start",
        },
    }, client)

    assert result["handled"] is True
    assert client.messages[0]["chat_id"] == 42
    assert "Вітаємо у POMICH" in client.messages[0]["text"]
    assert client.messages[0]["reply_markup"]["keyboard"][0] == ["👤 Клієнт", "🚛 Партнер", "🧭 Адмін"]
    assert client.messages[0]["reply_markup"]["keyboard"][2][0]["request_location"] is True


def test_admin_role_opens_admin_keyboard():
    client = FakeTelegramClient()

    result = handle_update({
        "update_id": 3,
        "message": {
            "chat": {"id": 42},
            "from": {"id": 42},
            "text": "🧭 Адмін",
        },
    }, client)

    assert result == {"handled": True, "type": "role", "role": "admin"}
    assert "Адмін сценарій активний" in client.messages[0]["text"]
    assert client.messages[0]["reply_markup"]["keyboard"][0][0]["text"] == "🧭 Відкрити адмін панель"


def test_location_update_moves_to_service_selection():
    client = FakeTelegramClient()

    result = handle_update({
        "update_id": 2,
        "message": {
            "chat": {"id": 42},
            "from": {"id": 42},
            "location": {"latitude": 48.6208, "longitude": 22.2879},
        },
    }, client)

    assert result["handled"] is True
    assert "Геолокацію отримано" in client.messages[0]["text"]
    assert "🚛 Евакуатор" in client.messages[0]["reply_markup"]["keyboard"][0]
