"""Shared pytest helpers for POMICH backend tests."""

from __future__ import annotations

from typing import Any

from bot import order_store


def use_temp_store(monkeypatch, tmp_path) -> tuple:
    """Point order/provider/customer JSON stores at a pytest tmp directory."""
    order_path = tmp_path / "orders.json"
    provider_path = tmp_path / "providers.json"
    offer_path = tmp_path / "offers.json"
    customer_path = tmp_path / "customers.json"
    monkeypatch.setattr(order_store, "_default_store_path", lambda: order_path)
    monkeypatch.setattr(order_store, "_default_provider_store_path", lambda: provider_path)
    monkeypatch.setattr(order_store, "_default_offer_store_path", lambda: offer_path)
    monkeypatch.setattr(order_store, "_default_customer_store_path", lambda: customer_path)
    from bot import otp_verification as otp_mod

    otp_mod._TELEGRAM_OTP_GUARD.clear()
    return order_path, provider_path, offer_path


def valid_customer_order_payload(service: str = "tow", **extra: Any) -> dict[str, Any]:
    """Minimal POST /orders body that passes server-side create validation."""
    service_key = str(service or "tow").strip().lower()
    details = {
        "tow": {"incident": "breakdown", "mobility": "rolls"},
        "battery": {"symptom": "silent", "help": "jump"},
        "wheel": {"damage": "one", "spare": "yes"},
        "fuel": {"fuelType": "petrol95", "amount": "10"},
        "lockout": {"keySituation": "inside", "occupants": "none"},
        "mechanic": {"issue": "overheating", "mobility": "stopped"},
    }
    payload: dict[str, Any] = {
        "source": "web",
        "service": service_key,
        "customerLocation": "Тестова точка",
        "customerCoordinates": {"lat": 48.6208, "lng": 22.2879},
        "serviceDetails": {
            "version": 1,
            "service": service_key,
            "answers": details.get(service_key, details["tow"]),
        },
    }
    if service_key == "tow":
        payload["destination"] = "СТО"
        payload["destinationCoordinates"] = {"lat": 48.625, "lng": 22.295}
    payload.update(extra)
    return payload
