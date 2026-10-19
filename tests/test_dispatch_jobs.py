"""Recovery and timing regressions, without a browser or Telegram network."""
import time
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, update
from bot import dispatch_jobs, runtime_store, order_store
from tests.test_runtime_store import sql_runtime, _provider
from tests.test_audit_regressions import clients


def _order():
    return order_store.save_order({"service": "tow", "customerCoordinates": {"lat": 48.62, "lng": 22.28}})


def test_creation_and_dispatch_timer_are_atomic(sql_runtime, monkeypatch):
    monkeypatch.setenv("POMICH_DISPATCH_ASYNC", "1")
    runtime_store.get_engine()
    original = dispatch_jobs.schedule_order_jobs
    def fail(connection, order):
        original(connection, order)
        raise RuntimeError("crash before commit")
    monkeypatch.setattr(dispatch_jobs, "schedule_order_jobs", fail)
    with pytest.raises(RuntimeError):
        _order()
    with runtime_store.get_engine().connect() as connection:
        assert connection.execute(select(runtime_store.orders)).first() is None
        assert connection.execute(select(dispatch_jobs.jobs)).first() is None


def test_first_wave_runs_after_restart_without_http(sql_runtime, monkeypatch):
    monkeypatch.setenv("POMICH_DISPATCH_ASYNC", "1")
    order_store.save_providers([_provider("near", 48.621, 22.281)])
    order = _order()
    assert runtime_store.sql_offers_for_order(order["id"]) == []
    runtime_store.reset_runtime_store_for_tests()
    assert dispatch_jobs.process_one()
    offers = runtime_store.sql_offers_for_order(order["id"])
    assert len(offers) == 1 and offers[0]["providerId"] == "near"
    assert not dispatch_jobs.process_one()  # All subsequent jobs are in the future.


def test_expired_lease_recovers_and_old_owner_cannot_finish(sql_runtime):
    _order()
    first = dispatch_jobs.claim()
    assert first is not None
    second = dispatch_jobs.claim(now=first["available_at"] + 1)
    assert second["id"] == first["id"] and second["lease"] != first["lease"]
    dispatch_jobs.finish(first, False)
    with runtime_store.get_engine().connect() as connection:
        assert connection.execute(select(dispatch_jobs.jobs.c.state)).scalar() == "processing"
    dispatch_jobs.finish(second, False)
    assert dispatch_jobs.stats()["done"] == 1


def test_next_wave_runs_without_client_reads(sql_runtime, monkeypatch):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    providers = [_provider(str(i), 48.62 + i * .001, 22.28) for i in range(8)]
    order_store.save_providers(providers)
    order = _order()
    dispatch_jobs.process_one()
    assert len(runtime_store.sql_offers_for_order(order["id"])) == 3
    later = now + timedelta(seconds=16)
    monkeypatch.setattr(dispatch_jobs.time, "time", lambda: later.replace(tzinfo=timezone.utc).timestamp())
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return later.replace(tzinfo=timezone.utc) if tz else later
    monkeypatch.setattr(order_store, "datetime", Clock)
    while dispatch_jobs.process_one():
        pass
    offers = runtime_store.sql_offers_for_order(order["id"])
    assert len(offers) == 8
    assert len({offer["providerId"] for offer in offers}) == 8


def test_reconcile_restores_legacy_order_timers(sql_runtime):
    order = _order()
    with runtime_store.get_engine().begin() as connection:
        connection.execute(dispatch_jobs.jobs.delete())
    dispatch_jobs.reconcile()
    dispatch_jobs.reconcile()
    with runtime_store.get_engine().connect() as connection:
        assert len(connection.execute(select(dispatch_jobs.jobs)).all()) == 1
    assert dispatch_jobs.process_one()


def test_dispatch_failure_is_visible_and_retryable(sql_runtime, monkeypatch):
    _order()
    def fail(*args, **kwargs):
        raise RuntimeError("temporary routing or DB failure")
    monkeypatch.setattr(order_store, "dispatch_order", fail)
    assert dispatch_jobs.process_one()
    assert dispatch_jobs.stats()["pending"] == 1
    with runtime_store.get_engine().begin() as connection:
        connection.execute(update(dispatch_jobs.jobs).values(attempts=7, available_at=0))
    assert dispatch_jobs.process_one()
    assert dispatch_jobs.stats()["dead"] == 1


def test_terminal_order_timer_is_safe_noop(sql_runtime):
    order = _order()
    runtime_store.sql_upsert_order({**order, "status": "cancelled"})
    assert dispatch_jobs.process_one()
    assert runtime_store.sql_offers_for_order(order["id"]) == []


def test_worker_heartbeat_expires(sql_runtime, monkeypatch):
    now = int(time.time())
    assert not dispatch_jobs.stats()["workerHealthy"]
    dispatch_jobs.heartbeat("test-worker")
    assert dispatch_jobs.stats()["workerHealthy"]
    monkeypatch.setattr(dispatch_jobs.time, "time", lambda: now + 31)
    assert not dispatch_jobs.stats()["workerHealthy"]


def test_http_creation_queues_without_running_matching(clients, monkeypatch):
    from tests.helpers import verified_customer
    from tests.test_audit_regressions import valid_order
    a, _, session, _ = clients
    verified_customer(session["customerId"])
    monkeypatch.setenv("POMICH_DISPATCH_ASYNC", "1")
    def forbidden(*args, **kwargs):
        raise AssertionError("matching must run in the worker")
    monkeypatch.setattr(order_store, "dispatch_order", forbidden)
    response = a.post("/api/orders", json=valid_order(), headers={"Authorization": "Bearer " + session["accessToken"]})
    assert response.status_code == 201
    assert response.json()["status"] == "searching"
    assert dispatch_jobs.stats()["pending"] == 1


def test_wave_commit_caps_pending_offers_under_lock(sql_runtime):
    order = _order()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    offers = [{"id": "offer-" + str(i), "orderId": order["id"], "providerId": "p-" + str(i),
        "status": "pending", "createdAt": now.isoformat(), "expiresAt": (now + timedelta(seconds=90)).isoformat()} for i in range(12)]
    runtime_store.sql_commit_dispatch_wave(order, offers[:6])
    runtime_store.sql_commit_dispatch_wave(order, offers[6:])
    assert len(runtime_store.sql_offers_for_order(order["id"])) == order_store.MAX_PROVIDER_OFFERS


def test_postgres_workers_claim_each_job_once(clients):
    from concurrent.futures import ThreadPoolExecutor
    if runtime_store.get_engine().dialect.name != "postgresql":
        pytest.skip("requires PostGIS CI service")
    for i in range(10):
        runtime_store.sql_upsert_order({"id": "claim-" + str(i), "status": "searching"})
    with ThreadPoolExecutor(max_workers=4) as pool:
        claimed = list(pool.map(lambda _: dispatch_jobs.claim(), range(10)))
    assert all(claimed)
    assert len({job["id"] for job in claimed}) == 10


def test_postgres_commit_emits_realtime_hint(clients):
    import json
    import psycopg
    engine = runtime_store.get_engine()
    if engine.dialect.name != "postgresql":
        pytest.skip("requires PostgreSQL LISTEN/NOTIFY")
    args, kwargs = engine.dialect.create_connect_args(engine.url)
    with psycopg.connect(*args, **kwargs, autocommit=True) as listener:
        listener.execute("LISTEN pomich_realtime")
        runtime_store.sql_upsert_order({"id": "committed-without-api-publish", "status": "searching"})
        received = list(listener.notifies(timeout=2, stop_after=1))
    assert received
    assert json.loads(received[0].payload)["channel"] == "order:committed-without-api-publish"


def test_expiry_preserves_all_events_for_multiple_offers(sql_runtime):
    order_store.save_providers([_provider(str(i), 48.62 + i * .001, 22.28) for i in range(3)])
    order = _order()
    order_store.dispatch_order(order["id"])
    runtime_store.sql_expire_pending_offers(order_id=order["id"], now=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(seconds=100))
    saved = runtime_store.sql_get_order(order["id"])
    assert len([event for event in saved["dispatchEvents"] if event["type"] == "OFFER_EXPIRED"]) == 3


def test_postgres_expiry_cannot_overwrite_acceptance(clients):
    from concurrent.futures import ThreadPoolExecutor
    from sqlalchemy import select
    engine = runtime_store.get_engine()
    if engine.dialect.name != "postgresql":
        pytest.skip("requires PostgreSQL row locks")
    order_store.save_providers([_provider("accept-race", 48.62, 22.28)])
    order = _order()
    dispatched = order_store.dispatch_order(order["id"])
    offer = dispatched["offers"][0]
    def accept():
        try:
            runtime_store.sql_accept_offer(offer["id"], "accept-race", 700)
        except runtime_store.SqlDispatchConflict:
            pass
    def expire():
        runtime_store.sql_expire_pending_offers(order_id=order["id"], now=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(seconds=100))
    with ThreadPoolExecutor(max_workers=2) as pool:
        for result in [pool.submit(accept), pool.submit(expire)]:
            result.result(timeout=10)
    with engine.connect() as connection:
        row = connection.execute(select(runtime_store.orders.c.status, runtime_store.orders.c.payload)
            .where(runtime_store.orders.c.id == order["id"])).one()
    assert row.status == row.payload["status"]
    accepted = [offer for offer in runtime_store.sql_offers_for_order(order["id"]) if offer["status"] == "accepted"]
    assert bool(accepted) == (row.status == "accepted")


def test_empty_provider_registry_never_creates_demo_partners(sql_runtime):
    assert order_store.load_providers() == []


def test_provider_cannot_accept_two_different_orders(sql_runtime):
    order_store.save_providers([_provider("one-provider", 48.62, 22.28)])
    orders = [_order(), _order()]
    offers = [order_store.dispatch_order(order["id"])["offers"][0] for order in orders]
    runtime_store.sql_accept_offer(offers[0]["id"], "one-provider", 700)
    with pytest.raises(runtime_store.SqlDispatchConflict) as error:
        runtime_store.sql_accept_offer(offers[1]["id"], "one-provider", 700)
    assert error.value.code == "PROVIDER_BUSY"
    assert runtime_store.sql_get_order(orders[1]["id"])["status"] == "searching"


def test_postgres_one_provider_two_orders_race(clients):
    from concurrent.futures import ThreadPoolExecutor
    if runtime_store.get_engine().dialect.name != "postgresql":
        pytest.skip("requires PostgreSQL provider row locks")
    order_store.save_providers([_provider("one-provider", 48.62, 22.28)])
    orders = [_order(), _order()]
    offers = [order_store.dispatch_order(order["id"])["offers"][0] for order in orders]
    def accept(offer):
        try:
            runtime_store.sql_accept_offer(offer["id"], "one-provider", 700)
            return "accepted"
        except runtime_store.SqlDispatchConflict as error:
            return error.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(accept, offers))
    assert sorted(results) == ["PROVIDER_BUSY", "accepted"]
