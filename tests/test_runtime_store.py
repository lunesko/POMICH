import json
import sqlite3
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, inspect, select

from bot import runtime_store
from bot.order_store import (
    DispatchConflict,
    accept_offer,
    dispatch_order,
    get_provider_offers,
    load_offers,
    load_orders,
    load_providers,
    save_order,
    save_providers,
    update_provider_presence,
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


def _provider(
    provider_id,
    lat,
    lng,
    *,
    specialties=None,
    status="online",
    verification_status="verified",
    radius=50,
    assigned_order_id=None,
    last_seen_at=None,
):
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds")
    payload = {
        "id": provider_id,
        "name": provider_id,
        "rating": 4.8,
        "vehicle": "Service van",
        "plate": "TEST",
        "phone": "+380000000000",
        "telegram": "pomich_help_bot",
        "status": status,
        "etaMinutes": 10,
        "location": {"lat": lat, "lng": lng},
        "specialties": specialties or ["tow"],
        "serviceRadiusKm": radius,
        "verificationStatus": verification_status,
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
        "lastSeenAt": last_seen_at or now,
        "lastLocationAt": last_seen_at or now,
        "updatedAt": last_seen_at or now,
    }
    if assigned_order_id:
        payload["assignedOrderId"] = assigned_order_id
    return payload


def test_sql_runtime_store_persists_orders_without_json_file(sql_runtime):
    order = save_order({"service": "tow", "customerLocation": "Kyiv"})

    assert load_orders()[0]["id"] == order["id"]
    assert not (sql_runtime / "orders.json").exists()
    assert _table_names() >= {
        "orders",
        "providers",
        "provider_presence",
        "dispatch_offers",
        "sessions",
        "order_events",
        "pomich_schema_migrations",
    }
    assert [migration["version"] for migration in runtime_store.applied_schema_migrations()] == [
        "2026081101",
        "2026081102",
        "2026081103",
        "2026081104",
        "2026081201",
    ]


def test_sql_schema_migrations_are_idempotent(sql_runtime):
    first_run = runtime_store.applied_schema_migrations()

    runtime_store.reset_runtime_store_for_tests()
    second_run = runtime_store.applied_schema_migrations()

    assert [migration["version"] for migration in second_run] == [migration["version"] for migration in first_run]
    assert _table_count(runtime_store.schema_migrations) == len(first_run)


def test_sql_schema_migration_backfills_legacy_provider_capabilities(sql_runtime):
    db_path = sql_runtime / "pomich-runtime.db"
    with sqlite3.connect(db_path) as connection:
        connection.execute("CREATE TABLE providers (id VARCHAR(120) PRIMARY KEY, payload JSON NOT NULL)")
        connection.execute(
            "INSERT INTO providers (id, payload) VALUES (?, ?)",
            ("legacy-provider", json.dumps({"id": "legacy-provider", "specialties": ["tow", "fuel"]})),
        )

    engine = runtime_store.get_engine()

    columns = {column["name"] for column in inspect(engine).get_columns("providers")}
    with engine.begin() as connection:
        capability_index = connection.scalar(
            select(runtime_store.providers.c.capabilities)
            .where(runtime_store.providers.c.id == "legacy-provider")
        )

    assert "capabilities" in columns
    assert capability_index == "|tow|fuel|"


def test_sql_runtime_store_supports_dispatch_and_offer_acceptance(sql_runtime):
    save_providers([_provider("p1", 50.4501, 30.5234)])
    order = save_order({"service": "tow", "customerCoordinates": {"lat": 50.4502, "lng": 30.5235}})

    dispatched = dispatch_order(order["id"])
    offer = get_provider_offers("p1")[0]
    accepted = accept_offer(offer["id"], "p1", proposed_price=1200)

    assert dispatched is not None
    assert dispatched["dispatchState"] == "OFFERS_SENT"
    assert load_offers()[0]["status"] == "accepted"
    assert accepted["order"]["status"] == "accepted"
    assert accepted["order"]["partnerProposedPrice"] == 1200
    assert load_orders()[0]["assignedProviderId"] == "p1"
    assert load_providers()[0]["status"] == "busy"
    assert _table_count(runtime_store.orders) == 1
    assert _table_count(runtime_store.providers) == 1
    assert _table_count(runtime_store.provider_presence) == 1
    assert _table_count(runtime_store.dispatch_offers) == 1
    assert _table_count(runtime_store.order_events) >= 1


def test_sql_dispatch_filters_candidates_in_database(sql_runtime):
    stale_time = (datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=120)).isoformat(timespec="seconds")
    save_providers(
        [
            _provider("eligible", 50.4501, 30.5234),
            _provider("wrong-service", 50.4501, 30.5234, specialties=["fuel"]),
            _provider("offline", 50.4501, 30.5234, status="offline"),
            _provider("unverified", 50.4501, 30.5234, verification_status="pending"),
            _provider("busy", 50.4501, 30.5234, assigned_order_id="PM-BUSY"),
            _provider("stale", 50.4501, 30.5234, last_seen_at=stale_time),
            _provider("too-far", 50.9001, 30.9234, radius=3),
        ]
    )
    order = save_order({"service": "tow", "customerCoordinates": {"lat": 50.4502, "lng": 30.5235}})

    dispatched = dispatch_order(order["id"])
    offers = load_offers()

    assert dispatched is not None
    assert dispatched["dispatchState"] == "OFFERS_SENT"
    assert dispatched["dispatchInfo"]["eligibleProviders"] == 1
    assert [offer["providerId"] for offer in offers] == ["eligible"]


def test_sql_first_accept_wins_with_transaction(sql_runtime):
    save_providers(
        [
            _provider("p1", 50.4501, 30.5234),
            _provider("p2", 50.4503, 30.5236),
        ]
    )
    order = save_order({"service": "tow", "customerCoordinates": {"lat": 50.4502, "lng": 30.5235}})
    dispatch_order(order["id"])
    pending_offers = load_offers()

    def try_accept(offer):
        try:
            result = accept_offer(offer["id"], offer["providerId"], proposed_price=1200)
            return ("accepted", result["provider"]["id"])
        except DispatchConflict as exc:
            return ("conflict", exc.code)

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(try_accept, pending_offers))

    result_counts = Counter(result[0] for result in results)
    accepted_provider_id = next(value for status, value in results if status == "accepted")

    assert result_counts == {"accepted": 1, "conflict": 1}
    assert ("conflict", "ORDER_ALREADY_ACCEPTED") in results
    assert Counter(offer["status"] for offer in load_offers()) == {"accepted": 1, "lost": 1}
    assert load_orders()[0]["assignedProviderId"] == accepted_provider_id
    assert {provider["id"]: provider for provider in load_providers()}[accepted_provider_id]["status"] == "busy"


def test_sql_provider_presence_upsert_merges_live_status(sql_runtime):
    save_providers([_provider("p1", 48.6208, 22.2879, status="offline")])
    updated = update_provider_presence(
        "p1",
        {"status": "online", "location": {"lat": 48.6208, "lng": 22.2879}, "etaMinutes": 12},
    )

    assert updated["status"] == "online"
    loaded = load_providers()[0]
    assert loaded["status"] == "online"
    assert loaded["lastSeenAt"] == updated["lastSeenAt"]

    order = save_order({"service": "tow", "customerCoordinates": {"lat": 48.621, "lng": 22.288}})
    dispatched = dispatch_order(order["id"])

    assert dispatched is not None
    assert dispatched["dispatchState"] == "OFFERS_SENT"
    assert get_provider_offers("p1")


def test_sql_runtime_store_preserves_explicit_empty_provider_collection(sql_runtime):
    save_providers([])

    assert load_providers() == []
    assert _table_count(runtime_store.providers) == 0
    assert _table_count(runtime_store.provider_presence) == 0


def test_sql_storage_enabled_respects_backend_and_database_url(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("POMICH_STORAGE_BACKEND", raising=False)
    assert runtime_store.sql_storage_enabled() is False

    monkeypatch.setenv("DATABASE_URL", "postgresql://pomich:x@localhost:5432/pomich")
    assert runtime_store.sql_storage_enabled() is True

    monkeypatch.setenv("POMICH_STORAGE_BACKEND", "json")
    assert runtime_store.sql_storage_enabled() is False

    monkeypatch.setenv("POMICH_STORAGE_BACKEND", "sql")
    assert runtime_store.sql_storage_enabled() is True


def _table_names():
    return set(inspect(runtime_store.get_engine()).get_table_names())


def _table_count(table):
    with runtime_store.get_engine().begin() as connection:
        return connection.scalar(select(func.count()).select_from(table))
