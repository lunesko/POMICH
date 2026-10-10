"""Adversarial regressions for the 2026-10-09 audit (synthetic data only)."""
import pytest
import os
from fastapi.testclient import TestClient

from bot.fastapi_app import app
from bot import field_encryption, order_store, runtime_store
from tests.helpers import use_temp_store


@pytest.fixture
def clients(monkeypatch, tmp_path):
    use_temp_store(monkeypatch, tmp_path)
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", "synthetic-audit-session-secret")
    test_url = os.getenv("POMICH_AUDIT_TEST_DATABASE_URL")
    if test_url:
        assert test_url.rsplit("/", 1)[-1] == "pomich_audit_test", "Use only the dedicated disposable test database"
    monkeypatch.setenv("DATABASE_URL", test_url or "sqlite:///" + (tmp_path / "audit.db").as_posix())
    monkeypatch.setenv("POMICH_STORAGE_BACKEND", "sql")
    runtime_store.reset_runtime_store_for_tests()
    if test_url:
        # The fixture only accepts the dedicated disposable CI database above.
        from sqlalchemy import delete
        with runtime_store.get_engine().begin() as connection:
            for table in reversed(runtime_store._METADATA.sorted_tables):
                connection.execute(delete(table))
    a, b = TestClient(app), TestClient(app)
    sa = a.post("/api/auth/customer/guest/session", json={}).json()
    sb = b.post("/api/auth/customer/guest/session", json={}).json()
    yield a, b, sa, sb
    runtime_store.reset_runtime_store_for_tests()


def valid_order():
    return {"source": "web", "service": "battery", "customerCoordinates": {"lat": 48.62, "lng": 22.28},
            "serviceDetails": {"version": 1, "service": "battery", "answers": {"symptom": "unknown", "help": "unknown"}}}


def test_refresh_rotation_overlap_and_reuse_revocation(clients, monkeypatch):
    import time
    from bot import session_registry
    a, _, sa, _ = clients
    original = a.cookies.get("pomich_customer_session")
    first = a.post("/api/auth/browser/restore", json={"role": "customer"})
    assert first.status_code == 200
    assert a.cookies.get("pomich_customer_session") != original
    parallel = TestClient(app)
    parallel.cookies.set("pomich_customer_session", original)
    assert parallel.post("/api/auth/browser/restore", json={"role": "customer"}).status_code == 200
    now = int(time.time())
    monkeypatch.setattr(session_registry.time, "time", lambda: now + 11)
    replay = TestClient(app)
    replay.cookies.set("pomich_customer_session", original)
    assert replay.post("/api/auth/browser/restore", json={"role": "customer"}).status_code == 401
    assert a.get("/api/customers/" + sa["customerId"] + "/profile",
        headers={"Authorization": "Bearer " + first.json()["accessToken"]}).status_code == 401


def test_disabled_customer_session_stays_revoked_after_reactivation(clients):
    from tests.helpers import verified_customer
    a, _, sa, _ = clients
    verified_customer(sa["customerId"])
    order_store.admin_update_customer_profile(sa["customerId"], {"accountStatus": "disabled"})
    order_store.admin_update_customer_profile(sa["customerId"], {"accountStatus": "active"})
    assert a.post("/api/auth/browser/restore", json={"role": "customer"}).status_code == 401


def test_realtime_limit_spans_sessions_and_recovers_leases(clients, monkeypatch):
    import time
    from fastapi import HTTPException
    from bot import realtime_limits
    from bot.api_deps import AuthPrincipal
    principal = AuthPrincipal(role="customer", subject_id="limited", auth_type="session", expires_at=int(time.time()) + 900)
    monkeypatch.setenv("POMICH_REALTIME_CONNECTION_LIMIT", "2")
    first, second = realtime_limits.acquire(principal), realtime_limits.acquire(principal)
    with pytest.raises(HTTPException) as error:
        realtime_limits.acquire(principal)
    assert error.value.status_code == 429
    realtime_limits.release(first)
    third = realtime_limits.acquire(principal)
    now = int(time.time())
    monkeypatch.setattr(realtime_limits.time, "time", lambda: now + 46)
    assert realtime_limits.acquire(principal) not in {second, third}


def test_retention_deletes_only_old_terminal_orders_and_related_rows(clients):
    from bot.data_lifecycle import purge_expired_orders
    from datetime import datetime, timedelta
    from bot.delivery_store import outbox
    from sqlalchemy import select
    now = datetime(2026, 10, 10)
    for name, status, days in [("old-terminal", "completed", 181), ("recent", "completed", 179), ("active-old", "searching", 200)]:
        runtime_store.sql_upsert_order({"id": name, "status": status, "notify": True, "chatId": "synthetic",
            "updatedAt": (now - timedelta(days=days)).isoformat()})
    assert purge_expired_orders(now=now)["matched"] == 1
    assert order_store.get_order("old-terminal") is not None
    assert purge_expired_orders(now=now, dry_run=False)["deleted"] == 1
    assert order_store.get_order("old-terminal") is None
    assert order_store.get_order("active-old") is not None
    assert order_store.get_order("recent") is not None
    with runtime_store.get_engine().connect() as connection:
        assert connection.execute(select(outbox).where(outbox.c.order_id == "old-terminal")).first() is None


def test_personal_data_export_is_scoped_and_erasure_revokes_session(clients, monkeypatch, tmp_path):
    from tests.helpers import verified_customer
    monkeypatch.setenv("POMICH_OTP_STORE_PATH", str(tmp_path / "otp.json"))
    a, b, sa, sb = clients
    verified_customer(sa["customerId"])
    runtime_store.sql_upsert_order({"id": "my-terminal", "customerId": sa["customerId"], "status": "completed"})
    runtime_store.sql_upsert_order({"id": "other-terminal", "customerId": sb["customerId"], "status": "completed"})
    headers = {"Authorization": "Bearer " + sa["accessToken"]}
    exported = a.get("/api/customers/" + sa["customerId"] + "/data-export", headers=headers)
    assert exported.status_code == 200 and exported.headers["cache-control"] == "no-store"
    assert [row["id"] for row in exported.json()["orders"]] == ["my-terminal"]
    assert b.delete("/api/customers/" + sa["customerId"] + "/data",
        headers={"Authorization": "Bearer " + sb["accessToken"]}).status_code == 403
    assert a.delete("/api/customers/" + sa["customerId"] + "/data", headers=headers).status_code == 200
    assert order_store.get_order("my-terminal") is None
    assert order_store.get_order("other-terminal") is not None
    assert a.get("/api/customers/" + sa["customerId"] + "/profile", headers=headers).status_code == 401


def test_erasure_refuses_active_orders(clients):
    a, _, sa, _ = clients
    runtime_store.sql_upsert_order({"id": "active-erasure", "customerId": sa["customerId"], "status": "searching"})
    response = a.delete("/api/customers/" + sa["customerId"] + "/data",
        headers={"Authorization": "Bearer " + sa["accessToken"]})
    assert response.status_code == 409
    assert order_store.get_order("active-erasure") is not None


@pytest.mark.parametrize("token", ["invalid", "pomich_auth_v1.W10.fake"])
def test_bad_bearer_cannot_probe_order_existence(clients, token):
    a, _, _, _ = clients
    headers = {"Authorization": "Bearer " + token}
    assert a.get("/api/orders/nonexistent", headers=headers).status_code == 401
    assert a.post("/api/realtime/tickets/orders/nonexistent", headers=headers).status_code == 401


def test_postgres_realtime_cross_process(clients):
    import asyncio
    import subprocess
    import sys
    from bot import realtime, realtime_broker
    if runtime_store.get_engine().dialect.name != "postgresql":
        pytest.skip("PostgreSQL cross-process transport runs in the dedicated CI database")
    async def run():
        queue = realtime.subscribe("customer:broker-test")
        realtime_broker.start()
        try:
            assert await asyncio.to_thread(realtime_broker._READY.wait, 10)
            # Ignore reconnect invalidation, then send from an independent interpreter.
            while not queue.empty():
                queue.get_nowait()
            result = await asyncio.to_thread(subprocess.run, [sys.executable, "-c",
                "from bot.realtime import publish; publish('customer:broker-test', 'order.created')"],
                capture_output=True, timeout=15)
            assert result.returncode == 0
            while True:
                message = await asyncio.wait_for(queue.get(), timeout=5)
                if message["type"] == "order.created":
                    break
            assert message["channel"] == "customer:broker-test"
        finally:
            await asyncio.to_thread(realtime_broker.stop)
            realtime.unsubscribe("customer:broker-test", queue)
    asyncio.run(run())


def test_creation_retry_returns_same_order_and_conflicts_on_changed_payload(clients):
    from tests.helpers import verified_customer
    a, b, sa, sb = clients
    verified_customer(sa["customerId"])
    verified_customer(sb["customerId"])
    headers = {"Authorization": "Bearer " + sa["accessToken"], "Idempotency-Key": "repeat-key-123"}
    first = a.post("/api/orders", json=valid_order(), headers=headers)
    retry = a.post("/api/orders", json=valid_order(), headers=headers)
    assert first.status_code == retry.status_code == 201
    assert first.json()["id"] == retry.json()["id"]
    changed = a.post("/api/orders", json=valid_order() | {"customerComment": "changed request"}, headers=headers)
    assert changed.status_code == 409
    other = b.post("/api/orders", json=valid_order(), headers=headers | {"Authorization": "Bearer " + sb["accessToken"]})
    assert other.status_code == 201 and other.json()["id"] != first.json()["id"]


def test_outbox_and_request_key_rollback_with_order(clients, monkeypatch):
    from bot import delivery_store, order_idempotency
    from sqlalchemy import select, func
    original = delivery_store.schedule_order_notifications
    def fail_after_schedule(connection, order):
        original(connection, order)
        raise RuntimeError("simulated transaction failure")
    monkeypatch.setattr(delivery_store, "schedule_order_notifications", fail_after_schedule)
    with pytest.raises(RuntimeError, match="simulated"):
        runtime_store.sql_upsert_order({"id": "atomic", "customerId": "a", "notify": True, "chatId": "fake"},
            insert_only=True, idempotency_key="atomic-key", request_hash="hash")
    with runtime_store.get_engine().connect() as connection:
        for table in (delivery_store.outbox, order_idempotency.keys):
            assert connection.scalar(select(func.count()).select_from(table)) == 0
    assert order_store.get_order("atomic") is None


def test_outbox_deduplicates_recovers_lease_and_retries(clients):
    from bot import delivery_store
    import time
    order = {"id": "outbox-order", "notify": True, "chatId": "synthetic"}
    runtime_store.sql_upsert_order(order)
    runtime_store.sql_upsert_order(order)
    now = int(time.time()) + 1
    first = delivery_store.claim_job(now)
    assert first and first["attempts"] == 1
    assert delivery_store.claim_job(now) is None
    recovered = delivery_store.claim_job(now + 301)
    assert recovered["id"] == first["id"] and recovered["lease"] != first["lease"]
    delivery_store.finish_job(first, failed=False, now=now + 301)
    assert delivery_store.outbox_stats()["processing"] == 1
    delivery_store.finish_job(recovered, failed=True, now=now + 301)
    retry = delivery_store.claim_job(now + 310)
    assert retry["attempts"] == 3
    delivery_store.finish_job(retry, failed=False, now=now + 310)
    assert delivery_store.outbox_stats()["done"] == 1


def test_concurrent_create_keys_commit_only_one_order(clients):
    from concurrent.futures import ThreadPoolExecutor
    def create(_):
        import uuid
        return runtime_store.sql_upsert_order({"id": uuid.uuid4().hex, "customerId": "concurrent"},
            insert_only=True, idempotency_key="same-concurrent-key", request_hash="same-payload")["id"]
    with ThreadPoolExecutor(max_workers=4) as pool:
        ids = list(pool.map(create, range(4)))
    assert len(set(ids)) == 1


def test_outbox_failures_become_visible_dead_letters(clients, monkeypatch):
    from bot import delivery_store
    from sqlalchemy import update
    runtime_store.sql_upsert_order({"id": "failing-job", "notify": True, "chatId": "synthetic"})
    def unavailable(_):
        raise RuntimeError("synthetic Telegram outage")
    monkeypatch.setattr(delivery_store, "deliver_job", unavailable)
    for _ in range(8):
        with runtime_store.get_engine().begin() as connection:
            connection.execute(update(delivery_store.outbox).values(available_at=0))
        assert delivery_store.process_one()
    stats = delivery_store.outbox_stats()
    assert stats["dead"] == 1
    assert stats["oldestPendingSeconds"] == 0
    assert delivery_store.process_one() is False


def test_csp_matches_edge_policy_and_bootstrap_is_javascript():
    import re
    from pathlib import Path
    from bot.security_headers import _CSP
    nginx = Path("deploy/nginx/pomich.help.conf").read_text(encoding="utf-8")
    assert all(policy == _CSP for policy in re.findall(r'add_header Content-Security-Policy "([^"]+)"', nginx))
    assert "'unsafe-inline'" not in _CSP.split("script-src ")[1].split(";")[0]
    for filename in ("telegram-bootstrap.js", "boot-recovery.js"):
        response = TestClient(app).get("/" + filename)
        assert response.status_code == 200
        assert "javascript" in response.headers["content-type"]
        assert "no-store" in response.headers["cache-control"]


@pytest.mark.parametrize("field,value", [("id", "victim"), ("status", "completed"), ("source", "trusted"),
    ("assignedProviderId", "fake"), ("statusHistory", []), ("dispatchEvents", []), ("price", 1)])
def test_create_rejects_server_fields_without_mutating_victim(clients, field, value):
    a, b, sa, sb = clients
    victim = order_store.save_order({"id": "victim", "customerId": sa["customerId"], "status": "searching"})
    victim = order_store.get_order("victim")
    payload = valid_order() | {field: value}
    response = b.post("/api/orders", json=payload, headers={"Authorization": "Bearer " + sb["accessToken"]})
    assert response.status_code == 422
    assert order_store.get_order("victim") == victim


def test_create_requires_verified_profile(clients):
    a, _, sa, _ = clients
    response = a.post("/api/orders", json=valid_order(), headers={"Authorization": "Bearer " + sa["accessToken"]})
    assert response.status_code == 403
    assert response.json()["detail"] == "verified_customer_profile_required"


def test_insert_only_never_updates_existing_row(clients):
    original = runtime_store.sql_upsert_order({"id": "victim", "customerId": "a"})
    original = order_store.get_order("victim")
    with pytest.raises(ValueError, match="order_id_already_exists"):
        runtime_store.sql_upsert_order({"id": "victim", "customerId": "b"}, insert_only=True)
    assert order_store.get_order("victim") == original


def test_logout_revokes_copied_cookie_and_bearer(clients):
    a, _, sa, _ = clients
    copied = dict(a.cookies)
    assert a.post("/api/auth/browser/logout").status_code == 204
    assert a.get("/api/customers/" + sa["customerId"] + "/profile", headers={"Authorization": "Bearer " + sa["accessToken"]}).status_code == 401
    other = TestClient(app)
    other.cookies.update(copied)
    assert other.post("/api/auth/browser/restore", json={"role": "customer"}).status_code == 401


def test_restore_cookie_is_not_an_api_bearer(clients):
    a, _, sa, _ = clients
    token = a.cookies.get("pomich_customer_session")
    assert a.get("/api/customers/" + sa["customerId"] + "/profile", headers={"Authorization": "Bearer " + token}).status_code == 401


def test_invalid_encryption_key_fails_closed(monkeypatch):
    monkeypatch.setenv("POMICH_ENCRYPTION_KEY", "not-a-valid-fernet-key")
    with pytest.raises(RuntimeError, match="POMICH_ENCRYPTION_KEY"):
        field_encryption.encrypt_field("synthetic-private-value")
    monkeypatch.setenv("POMICH_RUNTIME", "production")
    from bot.api_deps import runtime_config_errors
    assert any("valid Fernet" in error for error in runtime_config_errors())


def test_missing_encryption_key_in_production_fails_closed(monkeypatch):
    monkeypatch.delenv("POMICH_ENCRYPTION_KEY", raising=False)
    monkeypatch.setenv("POMICH_RUNTIME", "production")
    with pytest.raises(RuntimeError, match="POMICH_ENCRYPTION_KEY"):
        field_encryption.encrypt_field("synthetic-private-value")


def test_valid_create_uses_server_id_and_initial_status(clients):
    from tests.helpers import verified_customer
    a, _, sa, _ = clients
    verified_customer(sa["customerId"])
    response = a.post("/api/orders", json=valid_order(), headers={"Authorization": "Bearer " + sa["accessToken"]})
    assert response.status_code == 201, response.text
    order = response.json()
    assert order["id"].startswith("PM-") and len(order["id"]) == 35
    assert order["status"] == "searching"
    assert order["customerId"] == sa["customerId"]


@pytest.mark.parametrize("coordinates", [{"lat": 90, "lng": 30}, {"lat": "NaN", "lng": 30},
    {"lat": 48, "lng": "Infinity"}, {"lat": 48}, None])
def test_invalid_coordinates_are_rejected(clients, coordinates):
    a, _, sa, _ = clients
    response = a.post("/api/orders", json=valid_order() | {"customerCoordinates": coordinates},
                      headers={"Authorization": "Bearer " + sa["accessToken"]})
    assert response.status_code == 422


def test_channel_ticket_is_scoped_single_use_and_revoked_with_session(clients):
    from bot.realtime_auth import channel_name, consume_ticket, principal_active
    from fastapi import HTTPException
    a, _, sa, _ = clients
    issued = a.post("/api/realtime/tickets/customers/" + sa["customerId"],
                    headers={"Authorization": "Bearer " + sa["accessToken"]})
    assert issued.status_code == 200
    ticket = issued.json()["ticket"]
    with pytest.raises(HTTPException):
        consume_ticket(ticket, "customer:someone-else")
    principal = consume_ticket(ticket, channel_name("customers", sa["customerId"]))
    with pytest.raises(HTTPException):
        consume_ticket(ticket, channel_name("customers", sa["customerId"]))
    assert principal_active(principal)
    a.post("/api/auth/browser/logout")
    assert not principal_active(principal)


def test_websocket_disconnects_after_logout(clients):
    from starlette.websockets import WebSocketDisconnect
    a, _, sa, _ = clients
    path = "customers/" + sa["customerId"]
    ticket = a.post("/api/realtime/tickets/" + path, headers={"Authorization": "Bearer " + sa["accessToken"]}).json()["ticket"]
    with a.websocket_connect("/api/ws/" + path + "?ticket=" + ticket) as ws:
        assert ws.receive_json()["type"] == "connected"
        a.post("/api/auth/browser/logout")
        with pytest.raises(WebSocketDisconnect) as error:
            while True:
                ws.receive_json()
        assert error.value.code == 1008


def test_phone_change_requires_new_verification(clients):
    from tests.helpers import verified_customer
    a, _, sa, _ = clients
    verified_customer(sa["customerId"])
    order_store.update_customer_profile(sa["customerId"], {"phone": "+380671234567"})
    profile = order_store.get_customer_profile(sa["customerId"])
    assert profile["verification"]["phone"] is False
    response = a.post("/api/orders", json=valid_order(), headers={"Authorization": "Bearer " + sa["accessToken"]})
    assert response.status_code == 403


def test_runtime_does_not_migrate_production_database(monkeypatch, tmp_path):
    from sqlalchemy import inspect
    from bot.migrate import main
    monkeypatch.setenv("DATABASE_URL", "sqlite:///" + (tmp_path / "migration.db").as_posix())
    monkeypatch.setenv("POMICH_RUNTIME", "production")
    monkeypatch.delenv("POMICH_AUTO_MIGRATE", raising=False)
    runtime_store.reset_runtime_store_for_tests()
    try:
        assert inspect(runtime_store.get_engine()).get_table_names() == []
        main()
        main()  # A repeated release migration must be safe.
        tables = inspect(runtime_store.get_engine()).get_table_names()
        assert "auth_session_families" in tables
        assert "realtime_tickets" in tables
        assert runtime_store.schema_migrations.name in tables
    finally:
        runtime_store.reset_runtime_store_for_tests()


def test_ticket_and_stream_principal_expire(clients, monkeypatch):
    from bot import realtime_auth
    from fastapi import HTTPException
    a, _, sa, _ = clients
    path = "customers/" + sa["customerId"]
    headers = {"Authorization": "Bearer " + sa["accessToken"]}
    first = a.post("/api/realtime/tickets/" + path, headers=headers).json()
    second = a.post("/api/realtime/tickets/" + path, headers=headers).json()
    channel = "customer:" + sa["customerId"]
    principal = realtime_auth.consume_ticket(first["ticket"], channel)
    monkeypatch.setattr(realtime_auth.time, "time", lambda: second["expiresAt"] + 1)
    with pytest.raises(HTTPException):
        realtime_auth.consume_ticket(second["ticket"], channel)
    monkeypatch.setattr(realtime_auth.time, "time", lambda: principal.expires_at + 1)
    assert not realtime_auth.principal_active(principal)
