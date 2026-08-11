import json
import os
import threading
from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Column, DateTime, Float, Index, MetaData, String, Table, create_engine, delete, insert, select, text
from sqlalchemy.engine import Engine

_STORE_LOCK = threading.RLock()
_ENGINE: Engine | None = None
_ENGINE_URL: str | None = None
_METADATA = MetaData()

customers = Table(
    "customers",
    _METADATA,
    Column("id", String(120), primary_key=True),
    Column("name", String(180)),
    Column("phone", String(80)),
    Column("email", String(180)),
    Column("telegram", String(180)),
    Column("city", String(120)),
    Column("verification_status", String(40)),
    Column("created_at", String(40)),
    Column("updated_at", String(40)),
    Column("payload", JSON, nullable=False),
)

providers = Table(
    "providers",
    _METADATA,
    Column("id", String(120), primary_key=True),
    Column("name", String(180)),
    Column("phone", String(80)),
    Column("telegram", String(180)),
    Column("vehicle", String(180)),
    Column("plate", String(80)),
    Column("rating", Float),
    Column("verification_status", String(40)),
    Column("service_radius_km", Float),
    Column("registered_at", String(40)),
    Column("updated_at", String(40)),
    Column("payload", JSON, nullable=False),
)

provider_presence = Table(
    "provider_presence",
    _METADATA,
    Column("provider_id", String(120), primary_key=True),
    Column("status", String(40), nullable=False),
    Column("lat", Float),
    Column("lng", Float),
    Column("eta_minutes", Float),
    Column("assigned_order_id", String(120)),
    Column("last_seen_at", String(40)),
    Column("last_location_at", String(40)),
    Column("updated_at", String(40)),
    Column("payload", JSON, nullable=False),
)

orders = Table(
    "orders",
    _METADATA,
    Column("id", String(120), primary_key=True),
    Column("status", String(40), nullable=False),
    Column("service", String(60)),
    Column("source", String(80)),
    Column("customer_id", String(120)),
    Column("chat_id", String(120)),
    Column("assigned_provider_id", String(120)),
    Column("customer_lat", Float),
    Column("customer_lng", Float),
    Column("destination_lat", Float),
    Column("destination_lng", Float),
    Column("created_at", String(40)),
    Column("updated_at", String(40)),
    Column("payload", JSON, nullable=False),
)

dispatch_offers = Table(
    "dispatch_offers",
    _METADATA,
    Column("id", String(120), primary_key=True),
    Column("order_id", String(120), nullable=False),
    Column("provider_id", String(120), nullable=False),
    Column("status", String(40), nullable=False),
    Column("distance_km", Float),
    Column("created_at", String(40)),
    Column("expires_at", String(40)),
    Column("responded_at", String(40)),
    Column("payload", JSON, nullable=False),
)

sessions = Table(
    "sessions",
    _METADATA,
    Column("chat_id", String(120), primary_key=True),
    Column("updated_at", String(40)),
    Column("payload", JSON, nullable=False),
)

order_events = Table(
    "order_events",
    _METADATA,
    Column("id", String(240), primary_key=True),
    Column("order_id", String(120), nullable=False),
    Column("event_type", String(80)),
    Column("event_at", String(40)),
    Column("provider_id", String(120)),
    Column("offer_id", String(120)),
    Column("payload", JSON, nullable=False),
)

# Legacy fallback from the first SQL storage pass. New writes go to the normalized tables above.
runtime_collections = Table(
    "pomich_runtime_collections",
    _METADATA,
    Column("name", String(80), primary_key=True),
    Column("payload", JSON, nullable=False),
    Column("updated_at", DateTime, nullable=False),
)

Index("idx_orders_status", orders.c.status)
Index("idx_orders_service", orders.c.service)
Index("idx_orders_assigned_provider", orders.c.assigned_provider_id)
Index("idx_orders_customer_location", orders.c.customer_lat, orders.c.customer_lng)
Index("idx_provider_presence_status", provider_presence.c.status)
Index("idx_provider_presence_location", provider_presence.c.lat, provider_presence.c.lng)
Index("idx_dispatch_offers_order", dispatch_offers.c.order_id)
Index("idx_dispatch_offers_provider", dispatch_offers.c.provider_id)
Index("idx_dispatch_offers_status", dispatch_offers.c.status)
Index("idx_order_events_order", order_events.c.order_id)


def _database_url() -> str:
    url = (os.getenv("DATABASE_URL") or "").strip()
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url.removeprefix("postgres://")
    if url.startswith("postgresql://"):
        return "postgresql+psycopg://" + url.removeprefix("postgresql://")
    return url


def sql_storage_enabled() -> bool:
    backend = (os.getenv("POMICH_STORAGE_BACKEND") or "").strip().lower()
    if backend in {"json", "file", "files"}:
        return False
    if backend in {"sql", "database", "postgres", "postgresql"}:
        return bool(_database_url())
    return bool(_database_url())


def get_engine() -> Engine:
    global _ENGINE, _ENGINE_URL
    url = _database_url()
    if not url:
        raise RuntimeError("DATABASE_URL is required for SQL runtime storage")

    with _STORE_LOCK:
        if _ENGINE is None or _ENGINE_URL != url:
            connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
            _ENGINE = create_engine(url, future=True, pool_pre_ping=True, connect_args=connect_args)
            _ENGINE_URL = url
            _install_schema(_ENGINE)
        return _ENGINE


def reset_runtime_store_for_tests() -> None:
    global _ENGINE, _ENGINE_URL
    with _STORE_LOCK:
        if _ENGINE is not None:
            _ENGINE.dispose()
        _ENGINE = None
        _ENGINE_URL = None


def _install_schema(engine: Engine) -> None:
    if engine.dialect.name == "postgresql":
        with engine.begin() as connection:
            connection.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))

    _METADATA.create_all(engine)

    if engine.dialect.name == "postgresql":
        with engine.begin() as connection:
            connection.execute(text("""
                CREATE INDEX IF NOT EXISTS idx_provider_presence_location_gist
                ON provider_presence
                USING GIST ((ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography))
                WHERE lat IS NOT NULL AND lng IS NOT NULL
            """))
            connection.execute(text("""
                CREATE INDEX IF NOT EXISTS idx_orders_customer_location_gist
                ON orders
                USING GIST ((ST_SetSRID(ST_MakePoint(customer_lng, customer_lat), 4326)::geography))
                WHERE customer_lat IS NOT NULL AND customer_lng IS NOT NULL
            """))


def _json_safe_copy(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False))


def _point(value: Any) -> tuple[float | None, float | None]:
    if not isinstance(value, dict):
        return None, None
    try:
        return float(value.get("lat")), float(value.get("lng"))
    except (TypeError, ValueError):
        return None, None


def _load_payload_list(table: Table, order_by: Any) -> tuple[bool, list[dict[str, Any]]]:
    engine = get_engine()
    with engine.begin() as connection:
        rows = connection.execute(select(table.c.payload).order_by(order_by)).all()
    return bool(rows), [_json_safe_copy(row[0]) for row in rows]


def _load_legacy_collection(name: str) -> tuple[bool, Any]:
    engine = get_engine()
    with engine.begin() as connection:
        row = connection.execute(
            select(runtime_collections.c.payload).where(runtime_collections.c.name == name)
        ).first()

    if row is None:
        return False, None
    return True, _json_safe_copy(row[0])


def load_collection(name: str) -> tuple[bool, Any]:
    if name == "orders":
        found, payload = _load_payload_list(orders, orders.c.created_at)
    elif name == "offers":
        found, payload = _load_payload_list(dispatch_offers, dispatch_offers.c.created_at)
    elif name == "providers":
        found, payload = _load_payload_list(providers, providers.c.id)
    elif name == "customers":
        found, payload = _load_payload_list(customers, customers.c.id)
    elif name == "telegram_sessions":
        engine = get_engine()
        with engine.begin() as connection:
            rows = connection.execute(select(sessions.c.chat_id, sessions.c.payload)).all()
        found = bool(rows)
        payload = {str(row.chat_id): _json_safe_copy(row.payload) for row in rows}
    else:
        return _load_legacy_collection(name)

    if found:
        return True, payload
    return _load_legacy_collection(name)


def save_collection(name: str, payload: Any) -> Any:
    stored_payload = _json_safe_copy(payload)
    engine = get_engine()

    with engine.begin() as connection:
        if name == "orders":
            _save_orders(connection, stored_payload if isinstance(stored_payload, list) else [])
        elif name == "offers":
            _save_offers(connection, stored_payload if isinstance(stored_payload, list) else [])
        elif name == "providers":
            _save_providers(connection, stored_payload if isinstance(stored_payload, list) else [])
        elif name == "customers":
            _save_customers(connection, stored_payload if isinstance(stored_payload, list) else [])
        elif name == "telegram_sessions":
            _save_sessions(connection, stored_payload if isinstance(stored_payload, dict) else {})
        else:
            _save_collection_marker(connection, name, stored_payload)
            return _json_safe_copy(stored_payload)

        _save_collection_marker(connection, name, stored_payload)
    return _json_safe_copy(stored_payload)


def _save_collection_marker(connection, name: str, payload: Any) -> None:
    connection.execute(delete(runtime_collections).where(runtime_collections.c.name == name))
    connection.execute(
        insert(runtime_collections).values(
            name=name,
            payload=payload,
            updated_at=datetime.utcnow(),
        )
    )


def _save_orders(connection, order_payloads: list[dict[str, Any]]) -> None:
    connection.execute(delete(order_events))
    connection.execute(delete(orders))
    for order in order_payloads:
        customer_lat, customer_lng = _point(order.get("customerCoordinates"))
        destination_lat, destination_lng = _point(order.get("destinationCoordinates"))
        connection.execute(
            insert(orders).values(
                id=str(order.get("id")),
                status=str(order.get("status") or "searching"),
                service=str(order.get("service") or "") or None,
                source=str(order.get("source") or "") or None,
                customer_id=str(order.get("customerId") or order.get("customer_id") or "") or None,
                chat_id=str(order.get("chatId") or "") or None,
                assigned_provider_id=str(order.get("assignedProviderId") or "") or None,
                customer_lat=customer_lat,
                customer_lng=customer_lng,
                destination_lat=destination_lat,
                destination_lng=destination_lng,
                created_at=str(order.get("createdAt") or ""),
                updated_at=str(order.get("updatedAt") or ""),
                payload=order,
            )
        )
        for index, event in enumerate(order.get("dispatchEvents") if isinstance(order.get("dispatchEvents"), list) else []):
            event_id = f"{order.get('id')}:{index}:{event.get('type')}:{event.get('at')}"
            connection.execute(
                insert(order_events).values(
                    id=event_id[:240],
                    order_id=str(order.get("id")),
                    event_type=str(event.get("type") or "") or None,
                    event_at=str(event.get("at") or "") or None,
                    provider_id=str(event.get("providerId") or "") or None,
                    offer_id=str(event.get("offerId") or "") or None,
                    payload=event,
                )
            )


def _save_offers(connection, offer_payloads: list[dict[str, Any]]) -> None:
    connection.execute(delete(dispatch_offers))
    for offer in offer_payloads:
        connection.execute(
            insert(dispatch_offers).values(
                id=str(offer.get("id")),
                order_id=str(offer.get("orderId")),
                provider_id=str(offer.get("providerId")),
                status=str(offer.get("status") or "pending"),
                distance_km=float(offer.get("distanceKm")) if offer.get("distanceKm") is not None else None,
                created_at=str(offer.get("createdAt") or ""),
                expires_at=str(offer.get("expiresAt") or ""),
                responded_at=str(offer.get("respondedAt") or ""),
                payload=offer,
            )
        )


def _save_providers(connection, provider_payloads: list[dict[str, Any]]) -> None:
    connection.execute(delete(provider_presence))
    connection.execute(delete(providers))
    for provider in provider_payloads:
        location_lat, location_lng = _point(provider.get("location"))
        connection.execute(
            insert(providers).values(
                id=str(provider.get("id")),
                name=str(provider.get("name") or "") or None,
                phone=str(provider.get("phone") or "") or None,
                telegram=str(provider.get("telegram") or "") or None,
                vehicle=str(provider.get("vehicle") or "") or None,
                plate=str(provider.get("plate") or "") or None,
                rating=float(provider.get("rating")) if provider.get("rating") is not None else None,
                verification_status=str(provider.get("verificationStatus") or "unverified"),
                service_radius_km=float(provider.get("serviceRadiusKm")) if provider.get("serviceRadiusKm") is not None else None,
                registered_at=str(provider.get("registeredAt") or ""),
                updated_at=str(provider.get("updatedAt") or provider.get("profileUpdatedAt") or ""),
                payload=provider,
            )
        )
        connection.execute(
            insert(provider_presence).values(
                provider_id=str(provider.get("id")),
                status=str(provider.get("status") or "offline"),
                lat=location_lat,
                lng=location_lng,
                eta_minutes=float(provider.get("etaMinutes")) if provider.get("etaMinutes") is not None else None,
                assigned_order_id=str(provider.get("assignedOrderId") or "") or None,
                last_seen_at=str(provider.get("lastSeenAt") or ""),
                last_location_at=str(provider.get("lastLocationAt") or ""),
                updated_at=str(provider.get("updatedAt") or ""),
                payload={
                    "status": provider.get("status") or "offline",
                    "location": provider.get("location"),
                    "etaMinutes": provider.get("etaMinutes"),
                    "assignedOrderId": provider.get("assignedOrderId"),
                    "lastSeenAt": provider.get("lastSeenAt"),
                    "lastLocationAt": provider.get("lastLocationAt"),
                    "updatedAt": provider.get("updatedAt"),
                },
            )
        )


def _save_customers(connection, customer_payloads: list[dict[str, Any]]) -> None:
    connection.execute(delete(customers))
    for customer in customer_payloads:
        connection.execute(
            insert(customers).values(
                id=str(customer.get("id")),
                name=str(customer.get("name") or "") or None,
                phone=str(customer.get("phone") or "") or None,
                email=str(customer.get("email") or "") or None,
                telegram=str(customer.get("telegram") or "") or None,
                city=str(customer.get("city") or "") or None,
                verification_status=str(customer.get("verificationStatus") or "unverified"),
                created_at=str(customer.get("createdAt") or ""),
                updated_at=str(customer.get("updatedAt") or ""),
                payload=customer,
            )
        )


def _save_sessions(connection, session_payloads: dict[str, dict[str, Any]]) -> None:
    connection.execute(delete(sessions))
    for chat_id, session in session_payloads.items():
        connection.execute(
            insert(sessions).values(
                chat_id=str(chat_id),
                updated_at=str(session.get("updatedAt") or ""),
                payload=session,
            )
        )
