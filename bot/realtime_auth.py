"""Single-use, channel-scoped realtime tickets. Never put API bearers in URLs."""
import hashlib
import secrets
import time
from dataclasses import asdict

from fastapi import HTTPException
from sqlalchemy import JSON, Column, Integer, String, Table, delete, insert

from bot.api_deps import AuthPrincipal, require_customer_auth, require_order_participant_auth, require_provider_auth, require_authenticated_session
from bot.order_store import get_order
from bot import runtime_store, session_registry
from bot import realtime_limits  # register connection lease tables before startup

tickets = Table("realtime_tickets", runtime_store._METADATA,
    Column("digest", String(64), primary_key=True),
    Column("channel", String(240), nullable=False),
    Column("expires", Integer, nullable=False),
    Column("principal", JSON, nullable=False))


def authorize_channel(kind: str, subject: str, authorization: str | None) -> AuthPrincipal:
    if kind == "customers":
        return require_customer_auth(subject, authorization)
    if kind == "providers":
        return require_provider_auth(subject, None, authorization)
    if kind == "orders":
        require_authenticated_session(authorization)
        order = get_order(subject)
        if order is None:
            raise HTTPException(status_code=404, detail="order not found")
        return require_order_participant_auth(order, authorization)
    raise HTTPException(status_code=404, detail="channel_not_found")


def channel_name(kind: str, subject: str) -> str:
    if kind not in {"customers", "providers", "orders"} or not subject or len(subject) > 120:
        raise HTTPException(status_code=422, detail="invalid_channel")
    return kind[:-1] + ":" + subject


def issue_ticket(kind: str, subject: str, authorization: str | None) -> dict:
    channel = channel_name(kind, subject)
    principal = authorize_channel(kind, subject, authorization)
    token = secrets.token_urlsafe(32)
    deadline = min(int(time.time()) + 30, principal.expires_at)
    with session_registry._engine().begin() as connection:
        connection.execute(delete(tickets).where(tickets.c.expires <= int(time.time())))
        connection.execute(insert(tickets).values(digest=hashlib.sha256(token.encode()).hexdigest(),
            channel=channel, expires=deadline, principal=asdict(principal)))
    return {"ticket": token, "expiresAt": deadline}


def consume_ticket(token: str | None, channel: str) -> AuthPrincipal:
    if not token or len(token) > 128:
        raise HTTPException(status_code=401, detail="realtime_ticket_required")
    with session_registry._engine().begin() as connection:
        row = connection.execute(delete(tickets).where(
            tickets.c.digest == hashlib.sha256(token.encode()).hexdigest(),
            tickets.c.channel == channel, tickets.c.expires > int(time.time()),
        ).returning(tickets.c.principal)).first()
    if row is None:
        raise HTTPException(status_code=401, detail="realtime_ticket_invalid")
    principal = AuthPrincipal(**row[0])
    if not principal_active(principal):
        raise HTTPException(status_code=401, detail="session_expired_or_revoked")
    return principal


def principal_active(principal: AuthPrincipal) -> bool:
    now = int(time.time())
    return principal.expires_at > now and session_registry.family_active(
        principal.session_id, principal.role, principal.subject_id, now)
