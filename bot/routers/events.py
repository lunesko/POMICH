from fastapi import APIRouter, Header, Query
from fastapi.responses import StreamingResponse
from bot.realtime import event_stream
from bot.realtime_auth import channel_name, consume_ticket, issue_ticket, principal_active
from bot import realtime_limits
import asyncio

router = APIRouter(tags=["events"])


@router.post("/realtime/tickets/{kind}/{subject}")
def create_ticket(kind: str, subject: str, authorization: str | None = Header(default=None)) -> dict:
    return issue_ticket(kind, subject, authorization)


@router.get("/events/{kind}/{subject}")
async def events(kind: str, subject: str, ticket: str | None = Query(default=None)) -> StreamingResponse:
    channel = channel_name(kind, subject)
    principal = await asyncio.to_thread(consume_ticket, ticket, channel)
    lease = await asyncio.to_thread(realtime_limits.acquire, principal)
    async def stream():
        try:
            async for message in event_stream(channel, authorized=realtime_limits.guard(principal, lease)):
                yield message
        finally:
            await asyncio.to_thread(realtime_limits.release, lease)
    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )
