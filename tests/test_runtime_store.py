from datetime import datetime

import pytest

from bot import runtime_store
from bot.order_store import (
    accept_offer,
    dispatch_order,
    get_provider_offers,
    load_offers,
    load_orders,
    load_providers,
    save_order,
    save_providers,
)


@pytest.fixture()
def sql_runtime(monkeypatch, tmp_path):
    monkeypatch.setenv("POMICH_STORAGE_BACKEND", "sql")
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'pomich-runtime.db'}")
    monkeypatch.setenv("POMICH_ORDER_STORE_PATH", str(tmp_path / "orders.json"))
    monkeypatch.setenv("POMICH_PROVIDER_STORE_PATH", str(tmp_path / "providers.json"))
    monkeypatch.setenv("POMICH_OFFER_STORE_PATH", str(tmp_path / "offers.json"))
    monkeypatch.setenv("POMICH_CUSTOMER_STORE_PATH", str(tmp_path / "customers.json"))
    monkeypatch.setenv("POMICH_SESSION_STORE_PATH", str(tmp_path / "sessions.json"))
    runtime_store.reset_runtime_store_for_tests()
    yield tmp_path
    runtime_store.reset_runtime_store_for_tests()


def _provider(provider_id, lat, lng):
    now = datetime.utcnow().isoformat(timespec="seconds")
    return {
        "id": provider_id,
        "name": provider_id,
        "rating": 4.8,
        "vehicle": "Service van",
        "plate": "TEST",
        "phone": "+380000000000",
        "telegram": "pomich_help_bot",
        "status": "online",
        "etaMinutes": 10,
        "location": {"lat": lat, "lng": lng},
        "specialties": ["tow"],
        "serviceRadiusKm": 50,
        "verificationStatus": "verified",
        "verification": {
            "identityDocument": True,
            "driverLicense": True,
            "vehicleRegistration": True,
            "serviceProof": True,
            "selfieCheck": True,
            "backgroundCheck": "passed",
        },
        "registeredAt": now,
        "profileUpdatedAt": now,
        "lastSeenAt": now,
        "lastLocationAt": now,
        "updatedAt": now,
    }


def test_sql_runtime_store_persists_orders_without_json_file(sql_runtime):
    order = save_order({"service": "tow", "customerLocation": "Kyiv"})

    assert load_orders()[0]["id"] == order["id"]
    assert not (sql_runtime / "orders.json").exists()


def test_sql_runtime_store_supports_dispatch_and_offer_acceptance(sql_runtime):
    save_providers([_provider("p1", 50.4501, 30.5234)])
    order = save_order({"service": "tow", "customerCoordinates": {"lat": 50.4502, "lng": 30.5235}})

    dispatched = dispatch_order(order["id"])
    offer = get_provider_offers("p1")[0]
    accepted = accept_offer(offer["id"], "p1")

    assert dispatched is not None
    assert dispatched["dispatchState"] == "OFFERS_SENT"
    assert load_offers()[0]["status"] == "accepted"
    assert accepted["order"]["status"] == "assigned"
    assert load_orders()[0]["assignedProviderId"] == "p1"
    assert load_providers()[0]["status"] == "busy"
