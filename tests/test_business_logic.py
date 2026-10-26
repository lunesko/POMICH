"""Business invariants across JSON, SQLite and the dedicated PostgreSQL CI database."""
import os
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Barrier

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from bot import order_store as store, runtime_store as sql
from bot.api_deps import issue_role_session
from bot.fastapi_app import app
from tests.helpers import use_temp_store, verified_customer
from tests.test_runtime_store import _provider


@pytest.fixture(params=["json", "sql"])
def business_store(request, monkeypatch, tmp_path):
    use_temp_store(monkeypatch, tmp_path)
    monkeypatch.setenv("POMICH_STORAGE_BACKEND", request.param)
    database_url = os.getenv("POMICH_BUSINESS_TEST_DATABASE_URL")
    if database_url:
        assert database_url.rsplit("/", 1)[-1] == "pomich_business_test"
    monkeypatch.setenv("DATABASE_URL", database_url or f"sqlite:///{tmp_path / 'business.db'}")
    monkeypatch.setenv("POMICH_PROVIDER_TOKEN", "synthetic-business-provider-secret")
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", "synthetic-business-customer-secret")
    sql.reset_runtime_store_for_tests()
    if request.param == "sql" and database_url:
        with sql.get_engine().begin() as connection:
            for table in reversed(sql._METADATA.sorted_tables):
                connection.execute(delete(table))
    yield request.param
    sql.reset_runtime_store_for_tests()


def session(role, subject):
    secret = os.environ["POMICH_PROVIDER_TOKEN" if role == "provider" else "POMICH_CUSTOMER_SESSION_SECRET"]
    token = issue_role_session(role, subject, secret)["accessToken"]
    return {"Authorization": "Bearer " + token}


def two_offered_orders():
    store.save_providers([_provider("p1", 48.62, 22.28)])
    orders = [store.save_order({"service": "tow", "customerId": "owner",
        "customerCoordinates": {"lat": 48.62, "lng": 22.28}}) for _ in range(2)]
    for order in orders:
        store.dispatch_order(order["id"])
    offers = [next(o for o in store.load_offers() if o["orderId"] == order["id"]) for order in orders]
    return orders, offers


def accept(offer):
    return store.accept_offer(offer["id"], "p1", proposed_price=1200)


def complete(order_id):
    store.confirm_order_price(order_id)
    for status in ["en_route", "arrived", "in_progress", "completed"]:
        store.update_provider_order_status("p1", order_id, status)


def test_partner_cannot_confirm_own_price(business_store):
    orders, offers = two_offered_orders()
    accept(offers[0])
    response = TestClient(app).patch(f"/api/providers/p1/orders/{orders[0]['id']}/status",
        headers=session("provider", "p1"), json={"status": "price_confirmed"})
    assert response.status_code == 409
    assert store.get_order(orders[0]["id"])["status"] == "accepted"
    confirmed = TestClient(app).post(f"/api/orders/{orders[0]['id']}/confirm-price", headers=session("customer", "owner"))
    assert confirmed.status_code == 200
    assert confirmed.json()["priceConfirmedAt"]


def test_partner_cannot_accept_second_active_order(business_store):
    orders, offers = two_offered_orders()
    accept(offers[0])
    with pytest.raises(store.DispatchConflict) as error:
        accept(offers[1])
    assert error.value.code == "PROVIDER_BUSY"
    assert store.get_order(orders[1]["id"])["status"] == "searching"
    assert store.get_provider_profile("p1")["assignedOrderId"] == orders[0]["id"]


@pytest.mark.parametrize("terminal", ["completed", "cancelled"])
def test_terminal_replay_preserves_new_assignment_and_counters(business_store, terminal):
    orders, offers = two_offered_orders()
    accept(offers[0])
    if terminal == "completed":
        complete(orders[0]["id"])
    else:
        store.update_provider_order_status("p1", orders[0]["id"], terminal)
    accept(offers[1])
    before = store.get_provider_profile("p1")
    store.update_provider_order_status("p1", orders[0]["id"], terminal)
    store.update_order_status(orders[0]["id"], terminal)
    after = store.get_provider_profile("p1")
    assert after["assignedOrderId"] == orders[1]["id"]
    assert after["status"] == "busy"
    assert after.get("ordersCompleted", 0) == before.get("ordersCompleted", 0)


@pytest.mark.parametrize("role,review_key", [("customer", "customerReview"), ("provider", "partnerReview")])
def test_review_replay_requires_order_ownership(business_store, role, review_key):
    store.save_providers([_provider("stranger", 48.62, 22.28)])
    order = store.save_order({"customerId": "owner", "assignedProviderId": "assigned", "service": "tow",
        "status": "completed", "customerLocation": "PRIVATE ADDRESS", review_key: {"rating": 5}})
    response = TestClient(app).post(f"/api/orders/{order['id']}/reviews", headers=session(role, "stranger"),
        json={"role": "customer" if role == "customer" else "partner", "authorId": "stranger", "rating": 1})
    assert response.status_code == 403
    assert "PRIVATE ADDRESS" not in response.text


@pytest.mark.parametrize("account_status,verification_status,phone,eligible", [
    ("active", "verified", False, True),
    ("active", "pending", True, True),
    ("active", "unverified", False, False),
    ("disabled", "verified", True, False),
    ("active", "rejected", True, False),
])
def test_dispatch_and_accept_use_same_trust_policy(business_store, account_status, verification_status, phone, eligible):
    provider = _provider("p1", 48.62, 22.28, verification_status=verification_status)
    provider["accountStatus"] = account_status
    provider["verification"]["phone"] = phone
    store.save_providers([provider])
    order = store.save_order({"service": "tow", "customerCoordinates": {"lat": 48.62, "lng": 22.28}})
    store.dispatch_order(order["id"])
    offers = store.load_offers()
    assert bool(offers) == eligible
    if eligible:
        assert accept(offers[0])["order"]["status"] == "accepted"


def test_accept_rechecks_trust_after_offer_created(business_store):
    _, offers = two_offered_orders()
    providers = store.load_providers()
    providers[0]["accountStatus"] = "disabled"
    store.save_providers(providers)
    with pytest.raises(store.DispatchConflict) as error:
        accept(offers[0])
    assert error.value.code == "PROVIDER_NOT_VERIFIED"


def test_release_does_not_fake_heartbeat_or_online_state(business_store):
    orders, offers = two_offered_orders()
    accept(offers[0])
    store.update_provider_presence("p1", {"status": "offline"})
    before = store.get_provider_profile("p1")
    store.update_order_status(orders[0]["id"], "cancelled")
    after = store.get_provider_profile("p1")
    assert after["status"] == "offline"
    assert after["lastSeenAt"] == before["lastSeenAt"]
    assert not after.get("assignedOrderId")


def test_heartbeat_keeps_assignment_when_acceptance_wins_first(business_store, monkeypatch):
    if business_store != "sql":
        pytest.skip("SQL transaction interleaving")
    orders, offers = two_offered_orders()
    original = store.sql_update_provider_presence
    def interleaved(provider_id, patch):
        accept(offers[0])
        return original(provider_id, patch)
    monkeypatch.setattr(store, "sql_update_provider_presence", interleaved)
    store.update_provider_presence("p1", {"status": "online", "location": {"lat": 48.621, "lng": 22.28}})
    provider = store.get_provider_profile("p1")
    assert provider["assignedOrderId"] == orders[0]["id"]
    assert provider["status"] == "busy"


def test_stale_profile_save_does_not_clear_assignment(business_store):
    if business_store != "sql":
        pytest.skip("SQL profile transaction")
    orders, offers = two_offered_orders()
    stale = store.get_provider_profile("p1")
    accept(offers[0])
    stale["name"] = "Updated Name"
    sql.sql_upsert_provider(stale)
    provider = store.get_provider_profile("p1")
    assert provider["assignedOrderId"] == orders[0]["id"]
    assert provider["status"] == "busy"


def test_stale_transition_cannot_resurrect_cancelled_order(business_store, monkeypatch):
    if business_store != "sql":
        pytest.skip("SQL snapshot interleaving")
    orders, offers = two_offered_orders()
    accept(offers[0])
    store.confirm_order_price(orders[0]["id"])
    original = store.sql_commit_order_snapshot
    def interleaved(before, after, *args):
        cancelled = deepcopy(before)
        cancelled["status"] = "cancelled"
        assert original(before, cancelled)
        return original(before, after, *args)
    monkeypatch.setattr(store, "sql_commit_order_snapshot", interleaved)
    with pytest.raises(store.DispatchConflict) as error:
        store.update_order_status(orders[0]["id"], "en_route")
    assert error.value.code == "ORDER_CHANGED"
    assert store.get_order(orders[0]["id"])["status"] == "cancelled"


def test_completion_and_release_roll_back_together(business_store, monkeypatch):
    if business_store != "sql":
        pytest.skip("SQL rollback")
    orders, offers = two_offered_orders()
    accept(offers[0])
    store.confirm_order_price(orders[0]["id"])
    for status in ["en_route", "arrived", "in_progress"]:
        store.update_provider_order_status("p1", orders[0]["id"], status)
    original = sql._apply_terminal_transition
    def fail_after_release(connection, before, after):
        original(connection, before, after)
        raise RuntimeError("synthetic failure after side effects")
    monkeypatch.setattr(sql, "_apply_terminal_transition", fail_after_release)
    with pytest.raises(RuntimeError):
        store.update_order_status(orders[0]["id"], "completed")
    assert store.get_order(orders[0]["id"])["status"] == "in_progress"
    provider = store.get_provider_profile("p1")
    assert provider["assignedOrderId"] == orders[0]["id"]
    assert provider.get("ordersCompleted", 0) == 0


def test_concurrent_offers_for_same_partner_have_one_winner(business_store):
    if business_store != "sql":
        pytest.skip("SQL competing transactions")
    orders, offers = two_offered_orders()
    barrier = Barrier(2)
    def compete(offer):
        barrier.wait(timeout=10)
        try:
            return accept(offer)["order"]["id"]
        except store.DispatchConflict as error:
            assert error.code == "PROVIDER_BUSY"
            return None
    with ThreadPoolExecutor(max_workers=2) as executor:
        winners = [result for result in executor.map(compete, offers) if result]
    assert len(winners) == 1
    assert store.get_provider_profile("p1")["assignedOrderId"] == winners[0]
    assert sum(store.get_order(order["id"])["status"] == "accepted" for order in orders) == 1


def test_duplicate_active_submission_reuses_order_across_keys(business_store):
    verified_customer("owner")
    client = TestClient(app)
    headers = session("customer", "owner")
    payload = {"service": "battery", "customerCoordinates": {"lat": 48.62, "lng": 22.28},
        "serviceDetails": {"version": 1, "service": "battery", "answers": {"symptom": "unknown", "help": "unknown"}}}
    first = client.post("/api/orders", headers={**headers, "Idempotency-Key": "business-create-1"}, json=payload)
    second = client.post("/api/orders", headers={**headers, "Idempotency-Key": "business-create-2"}, json=payload)
    assert first.status_code == second.status_code == 201
    assert first.json()["id"] == second.json()["id"]
    assert len(store.load_orders()) == 1
    assert store.get_order(first.json()["id"])["dispatchEvents"] == first.json()["dispatchEvents"]
    store.update_order_status(first.json()["id"], "cancelled")
    replay = client.post("/api/orders", headers={**headers, "Idempotency-Key": "business-create-2"}, json=payload)
    assert replay.json()["id"] == first.json()["id"]
    assert replay.json()["status"] == "cancelled"
    third = client.post("/api/orders", headers={**headers, "Idempotency-Key": "business-create-3"}, json=payload)
    assert third.status_code == 201
    assert third.json()["id"] != first.json()["id"]


def test_simultaneous_heartbeat_and_accept_preserve_assignment(business_store):
    if business_store != "sql":
        pytest.skip("SQL competing transactions")
    orders, offers = two_offered_orders()
    barrier = Barrier(2)
    def heartbeat():
        barrier.wait(timeout=10)
        return sql.sql_update_provider_presence("p1", {"status": "online", "location": {"lat": 48.62, "lng": 22.28}})
    def acceptance():
        barrier.wait(timeout=10)
        return accept(offers[0])
    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(heartbeat), executor.submit(acceptance)]
        for future in futures:
            future.result(timeout=15)
    provider = store.get_provider_profile("p1")
    assert provider["assignedOrderId"] == orders[0]["id"]
    assert provider["status"] == "busy"


def test_simultaneous_duplicate_creates_have_one_order(business_store):
    if business_store != "sql":
        pytest.skip("SQL competing transactions")
    verified_customer("owner")
    barrier = Barrier(2)
    def create(index):
        barrier.wait(timeout=10)
        return sql.sql_upsert_order({"id": f"duplicate-{index}", "customerId": "owner", "service": "battery",
            "customerCoordinates": {"lat": 48.62, "lng": 22.28}}, insert_only=True, require_profile=True,
            idempotency_key=f"different-key-{index}", request_hash="same-intent")["id"]
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(create, range(2)))
    assert results[0] == results[1]
    assert len(store.load_orders()) == 1
