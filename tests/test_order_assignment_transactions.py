"""Assignment/terminal regressions; CI repeats these against disposable PostGIS."""
import copy
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import delete, select

from bot import order_store, runtime_store
from tests.helpers import use_temp_store


@pytest.fixture
def assignment_db(monkeypatch, tmp_path):
    use_temp_store(monkeypatch, tmp_path)
    url = os.getenv("POMICH_AUDIT_TEST_DATABASE_URL")
    if url:
        assert url.rsplit("/", 1)[-1] == "pomich_audit_test", "Only disposable audit database is allowed"
    monkeypatch.setenv("DATABASE_URL", url or f"sqlite:///{tmp_path / 'assignment.db'}")
    monkeypatch.setenv("POMICH_STORAGE_BACKEND", "sql")
    runtime_store.reset_runtime_store_for_tests()
    engine = runtime_store.get_engine()
    if url:
        with engine.begin() as connection:
            for table in reversed(runtime_store._METADATA.sorted_tables):
                connection.execute(delete(table))
    yield engine
    runtime_store.reset_runtime_store_for_tests()


def seed_orders(*, status="searching", count=2):
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    runtime_store.sql_upsert_provider({"id": "partner", "status": "online",
        "verificationStatus": "verified", "ordersCompleted": 0, "name": "Test partner",
        "lastSeenAt": now.isoformat() + "Z",
        **({"assignedOrderId": "order-0", "status": "busy"} if status != "searching" else {})})
    runtime_store.sql_upsert_customer({"id": "customer", "ordersCompleted": 0})
    for index in range(count):
        order = {"id": f"order-{index}", "customerId": "customer", "service": "tow", "status": status,
                 "createdAt": now.isoformat() + "Z", "updatedAt": now.isoformat() + "Z",
                 "statusHistory": [{"status": status, "at": now.isoformat() + "Z"}]}
        if status != "searching":
            order.update(assignedProviderId="partner", partnerId="partner")
        runtime_store.sql_upsert_order(order)
        runtime_store.sql_upsert_offer({"id": f"offer-{index}", "orderId": order["id"],
            "providerId": "partner", "status": "pending", "distanceKm": 1,
            "expiresAt": (now + timedelta(minutes=5)).isoformat() + "Z"})


def test_one_partner_cannot_accept_two_outstanding_offers(assignment_db):
    seed_orders()
    runtime_store.sql_accept_offer("offer-0", "partner", proposed_price=500)
    with pytest.raises(runtime_store.SqlDispatchConflict, match="active order") as error:
        runtime_store.sql_accept_offer("offer-1", "partner", proposed_price=600)
    assert error.value.code == "PROVIDER_BUSY"
    assert runtime_store.sql_get_order("order-0")["status"] == "accepted"
    assert runtime_store.sql_get_order("order-1")["status"] == "searching"
    assert runtime_store.sql_get_provider("partner")["assignedOrderId"] == "order-0"
    assert runtime_store.sql_offers_for_order("order-1")[0]["status"] == "pending"


def test_partner_assignment_check_uses_active_orders_even_if_presence_is_stale(assignment_db):
    seed_orders()
    runtime_store.sql_accept_offer("offer-0", "partner", proposed_price=500)
    runtime_store.sql_upsert_provider({"id": "partner", "status": "online", "verificationStatus": "verified"})
    with pytest.raises(runtime_store.SqlDispatchConflict) as error:
        runtime_store.sql_accept_offer("offer-1", "partner", proposed_price=600)
    assert error.value.code == "PROVIDER_BUSY"


def test_two_connections_accepting_different_orders_have_one_winner(assignment_db):
    if assignment_db.dialect.name != "postgresql":
        pytest.skip("Row-lock concurrency requires PostgreSQL, exercised by PostGIS CI")
    seed_orders()
    barrier = threading.Barrier(2)

    def accept(index):
        barrier.wait(timeout=10)
        try:
            runtime_store.sql_accept_offer(f"offer-{index}", "partner", proposed_price=500)
            return "accepted"
        except runtime_store.SqlDispatchConflict as exc:
            return exc.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(accept, range(2))) == ["PROVIDER_BUSY", "accepted"]
    assert len(runtime_store.sql_orders_by_status({"accepted"})) == 1


@pytest.mark.parametrize("initial,target", [("en_route", "arrived"), ("in_progress", "completed")])
def test_status_update_cannot_restore_concurrently_cancelled_order(assignment_db, monkeypatch, initial, target):
    seed_orders(status=initial, count=1)
    commit = order_store.sql_commit_order_snapshot

    def cancel_before_commit(original, proposed):
        monkeypatch.setattr(order_store, "sql_commit_order_snapshot", commit)
        order_store.update_order_status("order-0", "cancelled")
        return commit(original, proposed)

    monkeypatch.setattr(order_store, "sql_commit_order_snapshot", cancel_before_commit)
    with pytest.raises(order_store.DispatchConflict) as error:
        order_store.update_order_status("order-0", target)
    assert error.value.code == "ORDER_CHANGED"
    stored = runtime_store.sql_get_order("order-0")
    assert stored["status"] == "cancelled"
    assert stored["statusHistory"][-1]["status"] == "cancelled"
    assert runtime_store.sql_get_provider("partner").get("ordersCompleted", 0) == 0
    assert runtime_store.sql_get_customer("customer")["ordersCompleted"] == 0


def test_completion_is_atomic_and_repeat_does_not_increment_counters(assignment_db):
    seed_orders(status="in_progress", count=1)
    order_store.update_provider_order_status("partner", "order-0", "completed")
    order_store.update_provider_order_status("partner", "order-0", "completed")
    provider = runtime_store.sql_get_provider("partner")
    assert provider["status"] == "online"
    assert not provider.get("assignedOrderId")
    assert provider["ordersCompleted"] == 1
    assert runtime_store.sql_get_customer("customer")["ordersCompleted"] == 1
    assert runtime_store.sql_offers_for_order("order-0")[0]["status"] == "lost"
    assert [entry["status"] for entry in runtime_store.sql_get_order("order-0")["statusHistory"]] == ["in_progress", "completed"]


def test_terminal_effects_rollback_when_event_write_fails(assignment_db, monkeypatch):
    seed_orders(status="in_progress", count=1)
    before = runtime_store.sql_get_provider("partner")

    def fail_events(*args):
        raise RuntimeError("synthetic event failure")

    monkeypatch.setattr(runtime_store, "_insert_order_events", fail_events)
    with pytest.raises(RuntimeError, match="synthetic event failure"):
        order_store.update_order_status("order-0", "completed")
    assert runtime_store.sql_get_order("order-0")["status"] == "in_progress"
    assert runtime_store.sql_get_provider("partner") == before
    assert runtime_store.sql_get_customer("customer")["ordersCompleted"] == 0
    assert runtime_store.sql_offers_for_order("order-0")[0]["status"] == "pending"


def test_repeated_cancellation_schedules_one_notification_and_event(assignment_db):
    from bot.delivery_store import outbox

    seed_orders(status="en_route", count=1)
    order_store.update_order_status("order-0", "cancelled")
    order_store.update_order_status("order-0", "cancelled")
    with assignment_db.begin() as connection:
        notifications = connection.execute(select(outbox.c.kind).where(outbox.c.order_id == "order-0")).all()
        events = connection.execute(select(runtime_store.order_events.c.event_type)
            .where(runtime_store.order_events.c.order_id == "order-0")).all()
    assert notifications == [("cancelled",)]
    assert events == [("ORDER_CANCELLED",)]
    assert runtime_store.sql_get_provider("partner")["ordersCompleted"] == 0


def test_json_partner_cannot_accept_two_outstanding_offers(temp_store, monkeypatch):
    monkeypatch.setenv("POMICH_STORAGE_BACKEND", "json")
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    order_store.save_providers([{"id": "partner", "status": "online", "verificationStatus": "verified",
        "lastSeenAt": now.isoformat() + "Z"}])
    for index in range(2):
        order_store.save_order({"id": f"order-{index}", "service": "tow"})
    order_store.save_offers([{"id": f"offer-{index}", "orderId": f"order-{index}",
        "providerId": "partner", "status": "pending", "distanceKm": 1,
        "expiresAt": (now + timedelta(minutes=5)).isoformat() + "Z"} for index in range(2)])
    order_store.accept_offer("offer-0", "partner", proposed_price=500)
    with pytest.raises(order_store.DispatchConflict) as error:
        order_store.accept_offer("offer-1", "partner", proposed_price=600)
    assert error.value.code == "PROVIDER_BUSY"
    assert order_store.get_order("order-0")["status"] == "accepted"
    assert order_store.get_order("order-1")["status"] == "searching"


def test_two_connections_competing_terminal_transitions_commit_one(assignment_db):
    if assignment_db.dialect.name != "postgresql":
        pytest.skip("Row-lock concurrency requires PostgreSQL, exercised by PostGIS CI")
    seed_orders(status="in_progress", count=1)
    original = runtime_store.sql_get_order("order-0")
    barrier = threading.Barrier(2)

    def transition(status):
        proposed = copy.deepcopy(original)
        proposed["status"] = status
        proposed["updatedAt"] = "2026-10-25T12:00:00Z"
        proposed["statusHistory"].append({"status": status, "at": proposed["updatedAt"]})
        barrier.wait(timeout=10)
        return runtime_store.sql_commit_order_snapshot(original, proposed)

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(transition, ["cancelled", "completed"])) == [False, True]
    completed = runtime_store.sql_get_order("order-0")["status"] == "completed"
    assert runtime_store.sql_get_provider("partner")["ordersCompleted"] == int(completed)
    assert runtime_store.sql_get_customer("customer")["ordersCompleted"] == int(completed)


def test_decline_and_cancellation_use_consistent_lock_order(assignment_db):
    if assignment_db.dialect.name != 'postgresql':
        pytest.skip('PostgreSQL row-lock concurrency')
    seed_orders(count=1)
    barrier = threading.Barrier(2)
    def cancel():
        barrier.wait(timeout=10)
        try:
            return order_store.update_order_status('order-0', 'cancelled')['status']
        except order_store.DispatchConflict as exc:
            assert exc.code == 'ORDER_CHANGED'
            return exc.code
    def decline():
        barrier.wait(timeout=10)
        try:
            return runtime_store.sql_decline_offer('offer-0', 'partner')['status']
        except runtime_store.SqlDispatchConflict as exc:
            return exc.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        cancelled = pool.submit(cancel)
        declined = pool.submit(decline)
        cancellation = cancelled.result(timeout=15)
        assert cancellation in {'cancelled', 'ORDER_CHANGED'}
        assert declined.result(timeout=15) in {'declined', 'cancelled'}
    if cancellation == 'ORDER_CHANGED':
        # Decline committed first: the explicit conflict preserves its history.
        assert runtime_store.sql_get_order('order-0')['status'] == 'searching'
        assert order_store.update_order_status('order-0', 'cancelled')['status'] == 'cancelled'
    assert runtime_store.sql_get_order('order-0')['status'] == 'cancelled'
    assert runtime_store.sql_offers_for_order('order-0')[0]['status'] in {'declined', 'cancelled'}
