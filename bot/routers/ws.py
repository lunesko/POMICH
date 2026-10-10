from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketException
from bot.realtime import pump_websocket
from bot.realtime_auth import channel_name, consume_ticket, principal_active
from bot import realtime_limits
import asyncio

router = APIRouter(tags=["realtime"])


@router.websocket("/ws/{kind}/{subject}")
async def websocket_events(websocket: WebSocket, kind: str, subject: str, ticket: str | None = Query(default=None)) -> None:
    try:
        channel = channel_name(kind, subject)
        principal = await asyncio.to_thread(consume_ticket, ticket, channel)
        lease = await asyncio.to_thread(realtime_limits.acquire, principal)
    except HTTPException as exc:
        raise WebSocketException(code=1008, reason="unauthorized") from exc
    try:
        await websocket.accept()
        await pump_websocket(websocket, channel, authorized=realtime_limits.guard(principal, lease))
    finally:
        await asyncio.to_thread(realtime_limits.release, lease)
