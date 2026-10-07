"""Shared pytest helpers for POMICH backend tests."""

from __future__ import annotations

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
