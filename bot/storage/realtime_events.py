"""Bounded SQL event log for realtime delivery between API processes."""
from datetime import datetime, timedelta, timezone
from typing import Any
from sqlalchemy import Column, DateTime, Integer, JSON, String, Table, Index, delete, func, insert, select, text
from bot.storage.schema import _METADATA

realtime_events = Table(
    "realtime_events", _METADATA,
    Column("id", Integer, primary_key=True, autoincrement=True),
    Column("channel", String(180), nullable=False),
    Column("created_at", DateTime, nullable=False),
    Column("payload", JSON, nullable=False),
)
Index("idx_realtime_channel_seq", realtime_events.c.channel, realtime_events.c.id)
Index("idx_realtime_created", realtime_events.c.created_at)


def cursor() -> int:
    from bot.runtime_store import get_engine
    with get_engine().connect() as connection:
        return int(connection.execute(select(func.max(realtime_events.c.id))).scalar() or 0)


def publish(channel: str, message: dict[str, Any]) -> None:
    from bot.runtime_store import get_engine
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    with get_engine().begin() as connection:
        if connection.dialect.name == "postgresql":
            # Sequence allocation must follow commit order so poll cursors cannot skip
            # an earlier ID whose transaction is still pending in another worker.
            connection.execute(text("SELECT pg_advisory_xact_lock(1347374410)"))
        connection.execute(insert(realtime_events).values(channel=channel, created_at=now, payload=message))
        # Keep enough history for live consumers; clients hydrate current state on reconnect.
        connection.execute(delete(realtime_events).where(realtime_events.c.created_at < now - timedelta(minutes=10)))


def since(channel: str, after: int) -> list[tuple[int, dict[str, Any]]]:
    from bot.runtime_store import get_engine
    with get_engine().connect() as connection:
        rows = connection.execute(select(realtime_events.c.id, realtime_events.c.payload)
            .where(realtime_events.c.channel == channel, realtime_events.c.id > after)
            .order_by(realtime_events.c.id).limit(256)).all()
        return [(row.id, {**row.payload, "seq": row.id}) for row in rows]
