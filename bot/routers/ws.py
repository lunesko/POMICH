from __future__ import annotations

import time
from typing import Callable

from fastapi import APIRouter, Query, WebSocket, WebSocketException, status

from bot.api_deps import (
    AuthPrincipal,
    require_customer_auth,
    require_order_participant_auth,
    require_provider_auth,
)
from bot.auth_sessions import is_session_revoked, verify_realtime_ticket
from bot.order_store import get_order
from bot.realtime import channel_for_customer, channel_for_order, channel_for_provider, pump_websocket

router = APIRouter(tags=["realtime"])


def _bearer_from_query(access_token: str | None, authorization: str | None) -> str | None:
    if authorization:
        return authorization
    token = (access_token or "").strip()
    if not token:
        return None
    return f"Bearer {token}"


def _auth_check(principal: AuthPrincipal, stream_expires_at: int) -> Callable[[], bool]:
    session_id = principal.session_id
    deadline = int(stream_expires_at or 0)

    def check() -> bool:
        now = int(time.time())
        if deadline and now >= deadline:
            return False
        if session_id and is_session_revoked(session_id):
            return False
        return True

    return check


def _principal_from_ticket(ticket: str, scope: str) -> tuple[AuthPrincipal, int]:
    claims = verify_realtime_ticket(ticket, scope)
    principal = AuthPrincipal(
        role=str(claims["role"]),
        subject_id=str(claims["subjectId"]),
        auth_type="realtime_ticket",
        session_id=str(claims.get("sessionId") or ""),
        expires_at=int(claims.get("streamExpiresAt") or 0),
    )
    return principal, int(claims.get("streamExpiresAt") or 0)


@router.websocket("/ws/orders/{order_id}")
async def ws_order_events(
    websocket: WebSocket,
    order_id: str,
    ticket: str | None = Query(default=None),
    access_token: str | None = Query(default=None),
) -> None:
    """WebSocket stream for a single order (mirrors SSE /events/orders/{id})."""
    order = get_order(order_id)
    if order is None:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="order not found")
    authorization = websocket.headers.get("authorization")
    try:
        if ticket:
            principal, stream_exp = _principal_from_ticket(ticket, f"order:{order_id}")
        else:
            principal = require_order_participant_auth(order, authorization, access_token=access_token)
            stream_exp = int(principal.expires_at or principal.browser_expires_at or 0)
    except Exception as exc:
        from fastapi import HTTPException

        if isinstance(exc, HTTPException) and exc.status_code in {401, 403}:
            raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="unauthorized") from exc
        raise
    await websocket.accept()
    await pump_websocket(websocket, channel_for_order(order_id), auth_check=_auth_check(principal, stream_exp))


@router.websocket("/ws/customers/{customer_id}")
async def ws_customer_events(
    websocket: WebSocket,
    customer_id: str,
    ticket: str | None = Query(default=None),
    access_token: str | None = Query(default=None),
) -> None:
    """WebSocket stream for a customer's order updates."""
    authorization = websocket.headers.get("authorization")
    try:
        if ticket:
            principal, stream_exp = _principal_from_ticket(ticket, f"customer:{customer_id}")
        else:
            principal = require_customer_auth(customer_id, _bearer_from_query(access_token, authorization))
            stream_exp = int(principal.expires_at or principal.browser_expires_at or 0)
    except Exception as exc:
        from fastapi import HTTPException

        if isinstance(exc, HTTPException) and exc.status_code in {401, 403}:
            raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="unauthorized") from exc
        raise
    await websocket.accept()
    await pump_websocket(websocket, channel_for_customer(customer_id), auth_check=_auth_check(principal, stream_exp))


@router.websocket("/ws/providers/{provider_id}")
async def ws_provider_events(
    websocket: WebSocket,
    provider_id: str,
    ticket: str | None = Query(default=None),
    access_token: str | None = Query(default=None),
) -> None:
    """WebSocket stream for partner offer / assigned-order updates."""
    authorization = websocket.headers.get("authorization")
    provider_token = websocket.headers.get("x-pomich-provider-token")
    try:
        if ticket:
            principal, stream_exp = _principal_from_ticket(ticket, f"provider:{provider_id}")
        else:
            principal = require_provider_auth(
                provider_id,
                provider_token,
                _bearer_from_query(access_token, authorization),
            )
            stream_exp = int(principal.expires_at or principal.browser_expires_at or 0)
    except Exception as exc:
        from fastapi import HTTPException

        if isinstance(exc, HTTPException) and exc.status_code in {401, 403}:
            raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="unauthorized") from exc
        raise
    await websocket.accept()
    await pump_websocket(websocket, channel_for_provider(provider_id), auth_check=_auth_check(principal, stream_exp))
