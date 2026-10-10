"""PostgreSQL LISTEN/NOTIFY fan-out between API workers.

Notifications are invalidation hints, not the source of order state. Reconnects
invalidate all local subscriptions so clients fetch current state after a gap.
"""
from __future__ import annotations

import json
import logging
import threading
import uuid

from sqlalchemy import text
from bot.runtime_store import get_engine, sql_storage_enabled

_ORIGIN = uuid.uuid4().hex
_LOCK = threading.Lock()
_STOP = threading.Event()
_READY = threading.Event()
_THREAD: threading.Thread | None = None
_LOG = logging.getLogger(__name__)


def enabled() -> bool:
    return sql_storage_enabled() and get_engine().dialect.name == "postgresql"


def broadcast(message: dict) -> None:
    if not enabled():
        return
    # Never duplicate contact details in a broker payload; listeners refetch state.
    envelope = json.dumps({"origin": _ORIGIN, "channel": message["channel"], "type": message["type"]})
    try:
        with get_engine().begin() as connection:
            connection.execute(text("SELECT pg_notify('pomich_realtime', :payload)"), {"payload": envelope})
    except Exception:
        # The order is already committed. A broker outage must not turn success
        # into an ambiguous HTTP failure; HTTP polling remains the fallback.
        _LOG.warning("Realtime broadcast unavailable; clients will refresh via HTTP")


def _receive(payload: str) -> None:
    from bot.realtime import _publish_local
    try:
        message = json.loads(payload)
        if message.get("origin") == _ORIGIN:
            return
        channel, kind = message.get("channel"), message.get("type")
        if not isinstance(channel, str) or not isinstance(kind, str):
            return
        if not channel.startswith(("order:", "customer:", "provider:")):
            return
        _publish_local(channel, kind)
    except (ValueError, TypeError, AttributeError):
        return


def _run() -> None:
    import psycopg
    from bot.realtime import _LOCK as subscriber_lock, _CHANNELS, _publish_local
    while not _STOP.is_set():
        try:
            engine = get_engine()
            args, kwargs = engine.dialect.create_connect_args(engine.url)
            with psycopg.connect(*args, **kwargs, autocommit=True) as connection:
                connection.execute("LISTEN pomich_realtime")
                _READY.set()
                with subscriber_lock:
                    channels = list(_CHANNELS)
                for channel in channels:
                    _publish_local(channel, "offers.changed" if channel.startswith("provider:") else "order.updated")
                while not _STOP.is_set():
                    for notification in connection.notifies(timeout=1, stop_after=100):
                        _receive(notification.payload)
        except Exception:
            _READY.clear()
            _LOG.warning("Realtime listener disconnected; reconnecting")
            _STOP.wait(2)


def start() -> None:
    global _THREAD
    if not enabled():
        return
    with _LOCK:
        if _THREAD and _THREAD.is_alive():
            return
        _STOP.clear()
        _THREAD = threading.Thread(target=_run, name="pomich-realtime-broker", daemon=True)
        _THREAD.start()


def stop() -> None:
    _STOP.set()
    if _THREAD:
        _THREAD.join(timeout=3)
    _READY.clear()


def health() -> dict[str, bool]:
    """Operational state without exposing connection details."""
    configured = enabled()
    return {
        "configured": configured,
        "threadAlive": bool(_THREAD and _THREAD.is_alive()),
        "ready": _READY.is_set() if configured else True,
    }
