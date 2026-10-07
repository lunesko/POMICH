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
        "plate": "AO 1248 CH",
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
        "2026082001",
        "2026092701",
        "2026092702",
        "2026100701",
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


def test_sql_save_order_is_row_level_not_full_rewrite(sql_runtime):
    first = save_order({"service": "tow", "customerLocation": "A"})
    second = save_order({"service": "wheel", "customerLocation": "B"})
    assert _table_count(runtime_store.orders) == 2

    # Touching one order must not wipe the other.
    runtime_store.sql_upsert_order({**first, "customerLocation": "A2", "updatedAt": "2026-01-01T00:00:00Z"})
    assert _table_count(runtime_store.orders) == 2
    assert runtime_store.sql_get_order(second["id"])["service"] == "wheel"
    assert runtime_store.sql_get_order(first["id"])["customerLocation"] == "A2"


def test_sql_decline_offer_is_row_level(sql_runtime):
    from bot.order_store import decline_offer, load_offers

    save_providers(
        [
            _provider("p1", 50.4501, 30.5234),
            _provider("p2", 50.4503, 30.5236),
        ]
    )
    order = save_order({"service": "tow", "customerCoordinates": {"lat": 50.4502, "lng": 30.5235}})
    dispatch_order(order["id"])
    pending = [offer for offer in load_offers() if offer["status"] == "pending"]
    assert pending
    target = pending[0]
    other_count_before = _table_count(runtime_store.dispatch_offers)

    declined = decline_offer(target["id"], target["providerId"])
    assert declined["status"] == "declined"
    assert _table_count(runtime_store.dispatch_offers) == other_count_before
    assert runtime_store.sql_get_order(order["id"])["dispatchEvents"]


def test_sql_map_providers_bbox_filter(sql_runtime):
    save_providers(
        [
            _provider("near", 48.62, 22.28),
            _provider("far", 50.45, 30.52),
        ]
    )
    inside = runtime_store.sql_map_providers(bbox=(22.20, 48.55, 22.40, 48.72), kind="dispatch")
    ids = {item["id"] for item in inside}
    assert "near" in ids
    assert "far" not in ids


def test_sql_map_filters_kind_and_service_before_limit(sql_runtime):
    directory = {**_provider("a-directory", 48.62, 22.28, specialties=["tow"]), "providerKind": "directory"}
    wrong_service = _provider("b-fuel", 48.62, 22.28, specialties=["fuel"])
    matching = _provider("z-tow", 48.62, 22.28, specialties=["tow"])
    save_providers([directory, wrong_service, matching])

    visible = runtime_store.sql_map_providers(kind="dispatch", service="tow", limit=1)

    assert [item["id"] for item in visible] == ["z-tow"]


def test_sql_dispatch_wave_commit_blocks_duplicate_active_offer(sql_runtime):
    order = save_order({"service": "tow", "customerCoordinates": {"lat": 48.62, "lng": 22.28}})
    proposed_order = {
        **order,
        "dispatchState": "OFFERS_SENT",
        "dispatchInfo": {"offersSent": 1, "offersSentThisWave": 1},
        "dispatchEvents": [{"type": "OFFER_CREATED", "offerId": "OF-ONE", "providerId": "p1"}],
    }
    first = {
        "id": "OF-ONE",
        "orderId": order["id"],
        "providerId": "p1",
        "status": "pending",
        "createdAt": "2026-09-27T10:00:00Z",
        "expiresAt": "2026-09-27T10:02:00Z",
    }
    duplicate = {**first, "id": "OF-TWO"}

    runtime_store.sql_commit_dispatch_wave(proposed_order, [first])
    persisted_order, persisted_offers = runtime_store.sql_commit_dispatch_wave(
        {**proposed_order, "dispatchEvents": [{"type": "OFFER_CREATED", "offerId": "OF-TWO", "providerId": "p1"}]},
        [duplicate],
    )

    assert persisted_order["id"] == order["id"]
    assert [offer["id"] for offer in persisted_offers] == ["OF-ONE"]
    assert _table_count(runtime_store.dispatch_offers) == 1


def test_price_confirmation_does_not_restore_concurrently_cancelled_order(sql_runtime, monkeypatch):
    from bot import order_store

    order = save_order({"service": "tow", "status": "accepted"})
    runtime_store.sql_upsert_order({**order, "status": "accepted"})
    monkeypatch.setattr(order_store, "expire_stale_and_notify", lambda **kwargs: [])
    commit = runtime_store.sql_commit_order_snapshot

    def cancel_before_commit(original, proposed):
        runtime_store.sql_upsert_order({**original, "status": "cancelled"})
        return commit(original, proposed)

    monkeypatch.setattr(order_store, "sql_commit_order_snapshot", cancel_before_commit)
    with pytest.raises(order_store.DispatchConflict):
        order_store.confirm_order_price(order["id"])
    assert runtime_store.sql_get_order(order["id"])["status"] == "cancelled"


def test_expiration_preserves_concurrent_confirmation_and_unrelated_orders(sql_runtime, monkeypatch):
    from bot import order_store

    idle = save_order({"service": "tow"})
    runtime_store.sql_upsert_order({**idle, "status": "accepted", "acceptedAt": "2020-01-01T00:00:00Z"})
    unrelated = save_order({"service": "tow"})
    cancel = order_store._cancel_idle_accepted_orders_in_memory

    def confirm_while_expiring(orders, offers):
        result = cancel(orders, offers)
        runtime_store.sql_upsert_order({**runtime_store.sql_get_order(idle["id"]), "status": "price_confirmed"})
        runtime_store.sql_upsert_order({**runtime_store.sql_get_order(unrelated["id"]), "status": "accepted"})
        return result

    monkeypatch.setattr(order_store, "_cancel_idle_accepted_orders_in_memory", confirm_while_expiring)
    assert order_store.expire_stale_dispatch() == []
    assert runtime_store.sql_get_order(idle["id"])["status"] == "price_confirmed"
    assert runtime_store.sql_get_order(unrelated["id"])["status"] == "accepted"


def test_expiration_scans_beyond_first_thousand_active_orders(sql_runtime):
    from bot import order_store

    payloads = [{"id": f"order-{index:04}", "status": "searching", "service": "tow"} for index in range(1000)]
    payloads.append({"id": "order-1000", "status": "accepted", "service": "tow", "acceptedAt": "2020-01-01T00:00:00Z"})
    runtime_store.save_collection("orders", payloads)
    cancelled = order_store.expire_stale_dispatch()
    assert [item["id"] for item in cancelled] == ["order-1000"]
    assert runtime_store.sql_get_order("order-1000")["status"] == "cancelled"


def test_dispatch_snapshot_rejects_concurrently_changed_offer(sql_runtime):
    order = save_order({"service": "tow"})
    offer = {"id": "offer-race", "orderId": order["id"], "providerId": "p1", "status": "pending"}
    runtime_store.sql_upsert_offer(offer)
    original_offers = runtime_store.sql_offers_for_order(order["id"])
    runtime_store.sql_upsert_offer({**offer, "status": "accepted"})
    assert not runtime_store.sql_commit_order_snapshot(order, {**order, "status": "cancelled"},
        original_offers, [{**original_offers[0], "status": "cancelled"}])
    assert runtime_store.sql_get_order(order["id"])["status"] == "searching"
    assert runtime_store.sql_offers_for_order(order["id"])[0]["status"] == "accepted"


def _table_names():
    return set(inspect(runtime_store.get_engine()).get_table_names())


def _table_count(table):
    with runtime_store.get_engine().begin() as connection:
        return connection.scalar(select(func.count()).select_from(table))


def test_order_versions_reject_stale_update_and_keep_columns_consistent(sql_runtime):
    from bot.runtime_store import SqlDispatchConflict
    original = runtime_store.sql_upsert_order({"id": "PM-VERSION", "status": "searching", "service": "tow"})
    assert original["version"] == 1
    updated = runtime_store.sql_upsert_order({**original, "status": "accepted", "assignedProviderId": "p2",
        "customerId": "c2", "customerCoordinates": {"lat": 48.1, "lng": 22.2}})
    assert updated["version"] == 2
    with pytest.raises(SqlDispatchConflict):
        runtime_store.sql_upsert_order({**original, "status": "cancelled"})
    assert not runtime_store.sql_commit_order_snapshot(original, {**original, "status": "cancelled"})
    with runtime_store.get_engine().connect() as connection:
        row = connection.execute(select(runtime_store.orders).where(runtime_store.orders.c.id == original["id"])).mappings().one()
    assert row["version"] == row["payload"]["version"] == 2
    assert row["status"] == row["payload"]["status"] == "accepted"
    assert row["assigned_provider_id"] == row["payload"]["assignedProviderId"] == "p2"
    assert row["customer_id"] == row["payload"]["customerId"] == "c2"
    assert row["customer_lat"] == row["payload"]["customerCoordinates"]["lat"]


def test_otp_state_is_shared_across_independent_processes(sql_runtime):
    import subprocess
    import sys
    from bot import otp_repository
    with otp_repository.transaction():
        otp_repository.save({"c1": {"failedAttempts": 0, "codeHash": "hashed", "expiresAt": "2099-01-01T00:00:00Z"}})
    worker = '''
from bot import otp_repository
for _ in range(5):
    with otp_repository.transaction():
        data = otp_repository.load()
        data["c1"]["failedAttempts"] += 1
        otp_repository.save(data)
'''
    workers = [subprocess.Popen([sys.executable, "-c", worker]) for _ in range(2)]
    assert [process.wait(timeout=15) for process in workers] == [0, 0]
    with otp_repository.transaction():
        assert otp_repository.load()["c1"]["failedAttempts"] == 10


def test_sql_otp_send_confirm_and_failed_attempts_are_persisted(sql_runtime, monkeypatch):
    from bot import otp_verification as otp, otp_repository
    from bot.order_store import update_customer_profile
    monkeypatch.setenv("POMICH_OTP_SECRET", "test-shared-otp-secret")
    monkeypatch.setattr(otp, "_run_in_background", lambda fn: None)
    update_customer_profile("tg-123", {"name": "Test", "phone": "+380991111234"})
    monkeypatch.setattr(otp, "_generate_otp_code", lambda: "123456")
    assert otp.send_customer_verification_code("tg-123", "telegram")["sent"]
    with pytest.raises(otp.OtpVerificationError, match="verification code is invalid"):
        otp.confirm_customer_verification_code("tg-123", "999999")
    with otp_repository.transaction():
        assert otp_repository.load()["tg-123"]["failedAttempts"] == 1
    assert otp.confirm_customer_verification_code("tg-123", "123456")["verificationStatus"] == "verified"
    with otp_repository.transaction():
        assert "tg-123" not in otp_repository.load()


def test_realtime_delivers_events_from_an_independent_process(sql_runtime):
    import asyncio
    import subprocess
    import sys
    from bot import realtime
    runtime_store.get_engine()
    async def run():
        queue = realtime.subscribe("order:cross-process")
        try:
            worker = await asyncio.create_subprocess_exec(sys.executable, "-c", '''
from bot import realtime
realtime.publish("order:cross-process", "order.updated", {"id": "cross-process"})
''')
            assert await worker.wait() == 0
            message = await asyncio.wait_for(queue.get(), timeout=5)
            assert message["payload"]["id"] == "cross-process"
        finally:
            realtime.unsubscribe("order:cross-process", queue)
            await asyncio.sleep(0)
    asyncio.run(run())


def test_rate_limit_counters_are_shared_across_processes(sql_runtime):
    import subprocess
    import sys
    import time
    from bot.rate_limits import _take
    runtime_store.get_engine()
    expires = int(time.time()) + 60
    assert _take("shared-rate-test", expires) == 1
    process = subprocess.run([sys.executable, "-c", f'''from bot.rate_limits import _take
assert _take("shared-rate-test", {expires}) == 2
'''], check=True, timeout=10)
    assert _take("shared-rate-test", expires) == 3


def test_existing_orders_gain_version_without_losing_payload(sql_runtime):
    from sqlalchemy import text
    engine = runtime_store.get_engine()
    order = save_order({'service': 'tow', 'customerLocation': 'Kyiv'})
    with engine.begin() as connection:
        connection.execute(text('DELETE FROM pomich_schema_migrations WHERE version = :version'), {'version': '2026100701'})
        connection.execute(text('ALTER TABLE orders DROP COLUMN version'))
    runtime_store._run_schema_migrations(engine)
    migrated = runtime_store.sql_get_order(order['id'])
    assert migrated['version'] == 1
    assert migrated['customerLocation'] == 'Kyiv'
    assert runtime_store.sql_upsert_order({**migrated, 'status': 'cancelled'})['version'] == 2


def test_expiring_multiple_offers_keeps_every_order_event(sql_runtime):
    save_providers([_provider('p1', 50.4501, 30.5234), _provider('p2', 50.4503, 30.5236)])
    order = save_order({'service': 'tow', 'customerCoordinates': {'lat': 50.4502, 'lng': 30.5235}})
    dispatch_order(order['id'])
    pending = [offer for offer in load_offers() if offer['status'] == 'pending']
    assert len(pending) == 2
    changed = runtime_store.sql_expire_pending_offers(order_id=order['id'], now=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(hours=1))
    assert len(changed) == 2
    payload = runtime_store.sql_get_order(order['id'])
    expired_ids = {event['offerId'] for event in payload['dispatchEvents'] if event['type'] == 'OFFER_EXPIRED'}
    assert expired_ids == {offer['id'] for offer in pending}
