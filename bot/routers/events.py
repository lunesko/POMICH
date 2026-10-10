from __future__ import annotations

import time
from typing import Callable

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import StreamingResponse

from bot.api_deps import (
    AuthPrincipal,
    require_customer_auth,
    require_order_participant_auth,
    require_provider_auth,
)
from bot.auth_sessions import is_session_revoked, verify_realtime_ticket
from bot.order_store import get_order
from bot.realtime import channel_for_customer, channel_for_order, channel_for_provider, event_stream

router = APIRouter(tags=["events"])


def _auth_check(principal: AuthPrincipal | None, stream_expires_at: int) -> Callable[[], bool]:
    session_id = principal.session_id if principal else ""
    deadline = int(stream_expires_at or 0)

    def check() -> bool:
        now = int(time.time())
        if deadline and now >= deadline:
            return False
        if session_id and is_session_revoked(session_id):
            return False
        return True

    return check


def _sse_response(channel: str, *, auth_check=None) -> StreamingResponse:
    return StreamingResponse(
        event_stream(channel, auth_check=auth_check),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def _bearer_from_query(access_token: str | None, authorization: str | None) -> str | None:
    """Legacy EventSource fallback. Prefer short-lived ?ticket= (F05)."""
    if authorization:
        return authorization
    token = (access_token or "").strip()
    if not token:
        return None
    return f"Bearer {token}"


def _authorize_order_stream(
    order_id: str,
    *,
    ticket: str | None,
    access_token: str | None,
    authorization: str | None,
    x_pomich_admin_token: str | None,
) -> tuple[AuthPrincipal, int]:
    order = get_order(order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="order not found")
    scope = f"order:{order_id}"
    if ticket:
        claims = verify_realtime_ticket(ticket, scope)
        return (
            AuthPrincipal(
                role=str(claims["role"]),
                subject_id=str(claims["subjectId"]),
                auth_type="realtime_ticket",
                session_id=str(claims.get("sessionId") or ""),
                expires_at=int(claims.get("streamExpiresAt") or 0),
            ),
            int(claims.get("streamExpiresAt") or 0),
        )
    principal = require_order_participant_auth(
        order,
        authorization,
        access_token=access_token,
        x_pomich_admin_token=x_pomich_admin_token,
    )
    return principal, int(principal.expires_at or principal.browser_expires_at or 0)


@router.get("/events/orders/{order_id}")
async def order_events(
    order_id: str,
    ticket: str | None = Query(default=None),
    access_token: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
    x_pomich_admin_token: str | None = Header(default=None),
) -> StreamingResponse:
    """SSE stream for a single order (client price/status/ETA updates)."""
    principal, stream_exp = _authorize_order_stream(
        order_id,
        ticket=ticket,
        access_token=access_token,
        authorization=authorization,
        x_pomich_admin_token=x_pomich_admin_token,
    )
    return _sse_response(channel_for_order(order_id), auth_check=_auth_check(principal, stream_exp))


@router.get("/events/customers/{customer_id}")
async def customer_events(
    customer_id: str,
    ticket: str | None = Query(default=None),
    access_token: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
) -> StreamingResponse:
    """SSE stream for a customer's order updates."""
    scope = f"customer:{customer_id}"
    if ticket:
        claims = verify_realtime_ticket(ticket, scope)
        principal = AuthPrincipal(
            role=str(claims["role"]),
            subject_id=str(claims["subjectId"]),
            auth_type="realtime_ticket",
            session_id=str(claims.get("sessionId") or ""),
            expires_at=int(claims.get("streamExpiresAt") or 0),
        )
        stream_exp = int(claims.get("streamExpiresAt") or 0)
    else:
        principal = require_customer_auth(customer_id, _bearer_from_query(access_token, authorization))
        stream_exp = int(principal.expires_at or principal.browser_expires_at or 0)
    return _sse_response(channel_for_customer(customer_id), auth_check=_auth_check(principal, stream_exp))


@router.get("/events/providers/{provider_id}")
async def provider_events(
    provider_id: str,
    ticket: str | None = Query(default=None),
    access_token: str | None = Query(default=None),
    x_pomich_provider_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> StreamingResponse:
    """SSE stream for partner offer / assigned-order updates."""
    scope = f"provider:{provider_id}"
    if ticket:
        claims = verify_realtime_ticket(ticket, scope)
        principal = AuthPrincipal(
            role=str(claims["role"]),
            subject_id=str(claims["subjectId"]),
            auth_type="realtime_ticket",
            session_id=str(claims.get("sessionId") or ""),
            expires_at=int(claims.get("streamExpiresAt") or 0),
        )
        stream_exp = int(claims.get("streamExpiresAt") or 0)
    else:
        principal = require_provider_auth(
            provider_id,
            x_pomich_provider_token,
            _bearer_from_query(access_token, authorization),
        )
        stream_exp = int(principal.expires_at or principal.browser_expires_at or 0)
    return _sse_response(channel_for_provider(provider_id), auth_check=_auth_check(principal, stream_exp))
