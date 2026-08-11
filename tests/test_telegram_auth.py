import hashlib
import hmac
import json
import time
import urllib.parse

from bot.telegram_auth import verify_telegram_init_data


def _signed_init_data(payload: dict[str, str], token: str) -> str:
    data_check_string = "\n".join(f"{key}={value}" for key, value in sorted(payload.items()))
    secret_key = hmac.new(b"WebAppData", token.encode("utf-8"), hashlib.sha256).digest()
    signature = hmac.new(secret_key, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()
    return urllib.parse.urlencode({**payload, "hash": signature})


def test_verify_telegram_init_data_accepts_valid_signature():
    token = "123456:secret"
    payload = {
        "auth_date": str(int(time.time())),
        "query_id": "demo",
        "user": json.dumps({"id": 42, "first_name": "Аня"}, separators=(",", ":")),
    }

    verified = verify_telegram_init_data(_signed_init_data(payload, token), token)

    assert verified["user"]["id"] == 42


def test_verify_telegram_init_data_rejects_invalid_signature():
    token = "123456:secret"
    payload = {
        "auth_date": str(int(time.time())),
        "query_id": "demo",
        "user": json.dumps({"id": 42}, separators=(",", ":")),
    }

    init_data = _signed_init_data(payload, token).replace("42", "43")

    try:
        verify_telegram_init_data(init_data, token)
    except ValueError as exc:
        assert "invalid" in str(exc)
    else:
        raise AssertionError("invalid initData should fail")
