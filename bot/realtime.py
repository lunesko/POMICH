"""In-process realtime fan-out for order/partner updates (SSE + WebSocket).

JSON file store remains the local/dev fallback; production uses PostGIS via runtime_store.
This bus is intentionally process-local — sufficient for single-app deploy; multi-worker
would need Redis/Postgres LISTEN later.
"""

from __future__ import annotations

import asyncio
import json
import threading
import time
from collections import defaultdict
from typing import Any, AsyncIterator, Protocol

_LOCK = threading.Lock()
_SEQ = 0
_CHANNELS: dict[str, list[asyncio.Queue]] = defaultdict(list)


def _next_seq() -> int:
    global _SEQ
    with _LOCK:
        _SEQ += 1
        return _SEQ


def channel_for_order(order_id: str) -> str:
    return f"order:{order_id}"


def channel_for_provider(provider_id: str) -> str:
    return f"provider:{provider_id}"


def channel_for_customer(customer_id: str) -> str:
    return f"customer:{customer_id}"


def publish(channel: str, event_type: str, payload: dict[str, Any] | None = None) -> None:
    """Publish to all local subscribers. Safe to call from sync request handlers."""
    message = {
        "seq": _next_seq(),
        "type": event_type,
        "channel": channel,
        "ts": int(time.time()),
        "payload": payload or {},
    }
    with _LOCK:
        queues = list(_CHANNELS.get(channel, []))
    for queue in queues:
        try:
            queue.put_nowait(message)
        except asyncio.QueueFull:
            try:
                queue.get_nowait()
            except asyncio.QueueEmpty:
                pass
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                pass


def publish_order_event(order: dict[str, Any] | None, event_type: str = "order.updated") -> None:
    if not isinstance(order, dict):
        return
    order_id = str(order.get("id") or "").strip()
    if not order_id:
        return
    slim = {
        "id": order_id,
        "status": order.get("status"),
        "providerId": order.get("providerId") or order.get("assignedProviderId"),
        "customerId": order.get("customerId"),
        "partnerProposedPrice": order.get("partnerProposedPrice"),
        "etaMinutes": order.get("etaMinutes"),
        "updatedAt": order.get("updatedAt"),
    }
    publish(channel_for_order(order_id), event_type, slim)
    customer_id = str(order.get("customerId") or "").strip()
    if customer_id:
        publish(channel_for_customer(customer_id), event_type, slim)
    provider_id = str(order.get("providerId") or order.get("assignedProviderId") or "").strip()
    if provider_id:
        publish(channel_for_provider(provider_id), event_type, slim)


def publish_provider_event(provider_id: str, event_type: str, payload: dict[str, Any] | None = None) -> None:
    normalized = str(provider_id or "").strip()
    if not normalized:
        return
    publish(channel_for_provider(normalized), event_type, payload or {})


def subscribe(channel: str, *, maxsize: int = 32) -> asyncio.Queue:
    queue: asyncio.Queue = asyncio.Queue(maxsize=maxsize)
    with _LOCK:
        _CHANNELS[channel].append(queue)
    return queue


def unsubscribe(channel: str, queue: asyncio.Queue) -> None:
    with _LOCK:
        listeners = _CHANNELS.get(channel) or []
        if queue in listeners:
            listeners.remove(queue)
        if not listeners and channel in _CHANNELS:
            del _CHANNELS[channel]


class JsonWebSocket(Protocol):
    async def send_json(self, data: dict[str, Any]) -> None: ...


async def pump_websocket(
    websocket: JsonWebSocket,
    channel: str,
    *,
    heartbeat_seconds: float = 15.0,
) -> None:
    """Stream channel events to a WebSocket until disconnect."""
    from starlette.websockets import WebSocketDisconnect

    queue = subscribe(channel)
    try:
        await websocket.send_json({"type": "connected", "channel": channel, "ts": int(time.time())})
        while True:
            try:
                message = await asyncio.wait_for(queue.get(), timeout=heartbeat_seconds)
                await websocket.send_json(message)
            except asyncio.TimeoutError:
                await websocket.send_json({"type": "heartbeat", "ts": int(time.time())})
    except WebSocketDisconnect:
        pass
    finally:
        unsubscribe(channel, queue)


async def event_stream(channel: str, *, heartbeat_seconds: float = 15.0) -> AsyncIterator[str]:
    queue = subscribe(channel)
    try:
        yield _sse({"type": "connected", "channel": channel, "ts": int(time.time())})
        while True:
            try:
                message = await asyncio.wait_for(queue.get(), timeout=heartbeat_seconds)
                yield _sse(message)
            except asyncio.TimeoutError:
                yield ": heartbeat\n\n"
    finally:
        unsubscribe(channel, queue)


def _sse(data: dict[str, Any]) -> str:
    event_type = str(data.get("type") or "message")
    body = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event_type}\ndata: {body}\n\n"


def reset_realtime_for_tests() -> None:
    with _LOCK:
        _CHANNELS.clear()
