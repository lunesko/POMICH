from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import StreamingResponse

from bot.api_deps import require_customer_auth, require_order_participant_auth, require_provider_auth
from bot.order_store import get_order
from bot.realtime import channel_for_customer, channel_for_order, channel_for_provider, event_stream

router = APIRouter(tags=["events"])


def _sse_response(channel: str) -> StreamingResponse:
    return StreamingResponse(
        event_stream(channel),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def _bearer_from_query(access_token: str | None, authorization: str | None) -> str | None:
    """EventSource cannot set Authorization headers; allow ?access_token= as fallback."""
    if authorization:
        return authorization
    token = (access_token or "").strip()
    if not token:
        return None
    return f"Bearer {token}"


@router.get("/events/orders/{order_id}")
async def order_events(
    order_id: str,
    access_token: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
    x_pomich_admin_token: str | None = Header(default=None),
) -> StreamingResponse:
    """SSE stream for a single order (client price/status/ETA updates)."""
    order = get_order(order_id)
    if order is None:
        raise HTTPException(status_code=404, detail="order not found")
    require_order_participant_auth(
        order,
        authorization,
        access_token=access_token,
        x_pomich_admin_token=x_pomich_admin_token,
    )
    return _sse_response(channel_for_order(order_id))


@router.get("/events/customers/{customer_id}")
async def customer_events(
    customer_id: str,
    access_token: str | None = Query(default=None),
    authorization: str | None = Header(default=None),
) -> StreamingResponse:
    """SSE stream for a customer's order updates."""
    require_customer_auth(customer_id, _bearer_from_query(access_token, authorization))
    return _sse_response(channel_for_customer(customer_id))


@router.get("/events/providers/{provider_id}")
async def provider_events(
    provider_id: str,
    access_token: str | None = Query(default=None),
    x_pomich_provider_token: str | None = Header(default=None),
    authorization: str | None = Header(default=None),
) -> StreamingResponse:
    """SSE stream for partner offer / assigned-order updates."""
    require_provider_auth(
        provider_id,
        x_pomich_provider_token,
        _bearer_from_query(access_token, authorization),
    )
    return _sse_response(channel_for_provider(provider_id))
