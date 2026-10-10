"""F04–F06: session family revoke, realtime tickets, stream expiry."""

from __future__ import annotations

import time

from fastapi.testclient import TestClient

from bot.auth_sessions import (
    issue_realtime_ticket,
    reset_auth_sessions_for_tests,
    revoke_session_family,
    verify_realtime_ticket,
)
from bot.fastapi_app import app
from bot import realtime
from tests.helpers import use_temp_store, valid_customer_order_payload

CUSTOMER_SECRET = "customer-session-secret-for-tests"


def _guest_session(client: TestClient) -> dict:
    response = client.post("/api/auth/customer/guest/session", json={})
    assert response.status_code == 200, response.text
    return response.json()


def test_logout_revokes_bearer_session_family(monkeypatch, tmp_path) -> None:
    reset_auth_sessions_for_tests()
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", CUSTOMER_SECRET)
    monkeypatch.setenv("POMICH_AUTH_REVOCATION_PATH", str(tmp_path / "revocations.json"))
    client = TestClient(app)
    session = _guest_session(client)
    token = session["accessToken"]
    headers = {"Authorization": f"Bearer {token}"}

    me = client.get(f"/api/customers/{session['customerId']}/profile", headers=headers)
    assert me.status_code == 200

    logout = client.post("/api/auth/browser/logout", headers=headers)
    assert logout.status_code == 204

    denied = client.get(f"/api/customers/{session['customerId']}/profile", headers=headers)
    assert denied.status_code == 401
    assert denied.json()["detail"] == "session_revoked"


def test_realtime_ticket_mint_and_order_ws(monkeypatch, tmp_path) -> None:
    reset_auth_sessions_for_tests()
    use_temp_store(monkeypatch, tmp_path)
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", CUSTOMER_SECRET)
    monkeypatch.setenv("POMICH_AUTH_REVOCATION_PATH", str(tmp_path / "revocations.json"))
    monkeypatch.setenv("POMICH_REALTIME_TICKET_SECRET", "test-realtime-ticket-secret-xxxx")
    realtime.reset_realtime_for_tests()
    client = TestClient(app)
    session = _guest_session(client)
    headers = {"Authorization": f"Bearer {session['accessToken']}"}
    created = client.post("/api/orders", headers=headers, json=valid_customer_order_payload())
    assert created.status_code in {200, 201}, created.text
    order_id = created.json()["id"]

    ticket_response = client.post(
        "/api/auth/realtime/ticket",
        headers=headers,
        json={"scope": f"order:{order_id}"},
    )
    assert ticket_response.status_code == 200, ticket_response.text
    ticket_payload = ticket_response.json()
    ticket = ticket_payload["ticket"]
    assert ticket.startswith("pomich_rt_v1.")
    assert int(ticket_payload["expiresAt"]) > int(time.time())

    try:
        with client.websocket_connect(f"/api/ws/orders/{order_id}?ticket={ticket}") as websocket:
            connected = websocket.receive_json()
            assert connected["type"] == "connected"
            assert connected["channel"] == f"order:{order_id}"
            realtime.publish_order_event({"id": order_id, "status": "accepted"}, "order.accepted")
            message = websocket.receive_json()
            assert message["type"] == "order.accepted"
    finally:
        realtime.reset_realtime_for_tests()


def test_realtime_ticket_rejected_after_logout(monkeypatch, tmp_path) -> None:
    reset_auth_sessions_for_tests()
    use_temp_store(monkeypatch, tmp_path)
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", CUSTOMER_SECRET)
    monkeypatch.setenv("POMICH_AUTH_REVOCATION_PATH", str(tmp_path / "revocations.json"))
    monkeypatch.setenv("POMICH_REALTIME_TICKET_SECRET", "test-realtime-ticket-secret-xxxx")
    client = TestClient(app)
    session = _guest_session(client)
    headers = {"Authorization": f"Bearer {session['accessToken']}"}
    created = client.post("/api/orders", headers=headers, json=valid_customer_order_payload())
    assert created.status_code in {200, 201}, created.text
    order_id = created.json()["id"]
    ticket = client.post(
        "/api/auth/realtime/ticket",
        headers=headers,
        json={"scope": f"order:{order_id}"},
    ).json()["ticket"]

    assert client.post("/api/auth/browser/logout", headers=headers).status_code == 204
    denied = client.get(f"/api/events/orders/{order_id}?ticket={ticket}")
    assert denied.status_code == 401
    assert denied.json()["detail"] == "session_revoked"


def test_realtime_ticket_scope_mismatch() -> None:
    reset_auth_sessions_for_tests()
    issued = issue_realtime_ticket(role="customer", subject_id="c1", scope="order:o1", session_id="sid1")
    try:
        verify_realtime_ticket(issued["ticket"], "order:o2")
        assert False, "expected scope mismatch"
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 403


def test_stream_auth_check_fails_after_revoke() -> None:
    reset_auth_sessions_for_tests()
    from bot.api_deps import AuthPrincipal
    from bot.routers.events import _auth_check

    principal = AuthPrincipal(
        role="customer",
        subject_id="c1",
        auth_type="realtime_ticket",
        session_id="family-1",
        expires_at=int(time.time()) + 3600,
    )
    check = _auth_check(principal, int(time.time()) + 3600)
    assert check() is True
    revoke_session_family("family-1")
    assert check() is False


def test_stream_auth_check_fails_after_deadline() -> None:
    from bot.api_deps import AuthPrincipal
    from bot.routers.events import _auth_check

    principal = AuthPrincipal(
        role="customer",
        subject_id="c1",
        auth_type="realtime_ticket",
        session_id="",
        expires_at=1,
    )
    check = _auth_check(principal, int(time.time()) - 5)
    assert check() is False
