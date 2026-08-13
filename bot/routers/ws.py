from __future__ import annotations

from fastapi import APIRouter, Query, WebSocket, WebSocketException, status

from bot.api_deps import require_customer_auth, require_provider_auth
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


@router.websocket("/ws/orders/{order_id}")
async def ws_order_events(websocket: WebSocket, order_id: str) -> None:
    """WebSocket stream for a single order (mirrors SSE /events/orders/{id})."""
    order = get_order(order_id)
    if order is None:
        raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="order not found")
    await websocket.accept()
    await pump_websocket(websocket, channel_for_order(order_id))


@router.websocket("/ws/customers/{customer_id}")
async def ws_customer_events(
    websocket: WebSocket,
    customer_id: str,
    access_token: str | None = Query(default=None),
) -> None:
    """WebSocket stream for a customer's order updates."""
    authorization = websocket.headers.get("authorization")
    try:
        require_customer_auth(customer_id, _bearer_from_query(access_token, authorization))
    except Exception as exc:
        from fastapi import HTTPException

        if isinstance(exc, HTTPException) and exc.status_code == 401:
            raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="unauthorized") from exc
        raise
    await websocket.accept()
    await pump_websocket(websocket, channel_for_customer(customer_id))


@router.websocket("/ws/providers/{provider_id}")
async def ws_provider_events(
    websocket: WebSocket,
    provider_id: str,
    access_token: str | None = Query(default=None),
) -> None:
    """WebSocket stream for partner offer / assigned-order updates."""
    authorization = websocket.headers.get("authorization")
    provider_token = websocket.headers.get("x-pomich-provider-token")
    try:
        require_provider_auth(
            provider_id,
            provider_token,
            _bearer_from_query(access_token, authorization),
        )
    except Exception as exc:
        from fastapi import HTTPException

        if isinstance(exc, HTTPException) and exc.status_code in {401, 403}:
            raise WebSocketException(code=status.WS_1008_POLICY_VIOLATION, reason="unauthorized") from exc
        raise
    await websocket.accept()
    await pump_websocket(websocket, channel_for_provider(provider_id))
