import json
import math
import os
import threading
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import JSON, Column, DateTime, Float, Index, MetaData, String, Table, bindparam, create_engine, delete, insert, inspect, select, text, update
from sqlalchemy.engine import Engine

_STORE_LOCK = threading.RLock()
_ENGINE: Engine | None = None
_ENGINE_URL: str | None = None
_METADATA = MetaData()


class SqlDispatchConflict(ValueError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)

customers = Table(
    "customers",
    _METADATA,
    Column("id", String(120), primary_key=True),
    Column("name", String(512)),
    Column("phone", String(512)),
    Column("email", String(512)),
    Column("telegram", String(180)),
    Column("city", String(512)),
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
    Column("capabilities", String(320)),
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

schema_migrations = Table(
    "pomich_schema_migrations",
    _METADATA,
    Column("version", String(80), primary_key=True),
    Column("name", String(180), nullable=False),
    Column("applied_at", DateTime, nullable=False),
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
Index("idx_providers_capabilities", providers.c.capabilities)
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
    """True when runtime should use PostgreSQL/PostGIS (or sqlite in tests).

    Selection rules:
    - POMICH_STORAGE_BACKEND=json|file → always JSON files (local/dev only)
    - POMICH_STORAGE_BACKEND=sql|postgres → SQL when DATABASE_URL is set
    - unset backend → SQL whenever DATABASE_URL is set (production default)

    Production compose sets DATABASE_URL + POMICH_STORAGE_BACKEND=sql.
    """
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
    _run_schema_migrations(engine)


def _run_schema_migrations(engine: Engine) -> None:
    migrations = (
        ("2026081101", "runtime schema baseline", _migration_runtime_schema_baseline),
        ("2026081102", "provider capabilities backfill", _migration_provider_capabilities),
        ("2026081103", "dispatch core indexes", _migration_dispatch_core_indexes),
        ("2026081104", "postgis dispatch geo indexes", _migration_postgis_dispatch_geo_indexes),
        ("2026081201", "widen customer encrypted columns", _migration_customer_encrypted_columns),
    )

    with engine.begin() as connection:
        applied = {
            str(row.version)
            for row in connection.execute(select(schema_migrations.c.version))
        }
        for version, name, migrate in migrations:
            if version in applied:
                continue
            migrate(connection, engine)
            connection.execute(
                insert(schema_migrations).values(
                    version=version,
                    name=name,
                    applied_at=datetime.now(timezone.utc).replace(tzinfo=None),
                )
            )


def _migration_runtime_schema_baseline(connection, engine: Engine) -> None:
    existing_tables = set(inspect(connection).get_table_names())
    required_tables = {
        "customers",
        "providers",
        "provider_presence",
        "orders",
        "dispatch_offers",
        "sessions",
        "order_events",
        "pomich_schema_migrations",
        "pomich_runtime_collections",
    }
    missing_tables = sorted(required_tables - existing_tables)
    if missing_tables:
        raise RuntimeError(f"SQL runtime schema is missing required tables: {', '.join(missing_tables)}")


def _migration_provider_capabilities(connection, engine: Engine) -> None:
    existing_columns = {column["name"] for column in inspect(connection).get_columns("providers")}
    if "capabilities" not in existing_columns:
        connection.execute(text("ALTER TABLE providers ADD COLUMN capabilities VARCHAR(320)"))

    connection.execute(text("CREATE INDEX IF NOT EXISTS idx_providers_capabilities ON providers (capabilities)"))

    rows = connection.execute(
        select(providers.c.id, providers.c.payload)
        .where((providers.c.capabilities.is_(None)) | (providers.c.capabilities == ""))
    ).mappings().all()
    for row in rows:
        payload = _json_object(row["payload"])
        connection.execute(
            update(providers)
            .where(providers.c.id == str(row["id"]))
            .values(capabilities=_capability_index(payload.get("specialties")))
        )


def _migration_dispatch_core_indexes(connection, engine: Engine) -> None:
    index_statements = [
        "CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status)",
        "CREATE INDEX IF NOT EXISTS idx_orders_service ON orders (service)",
        "CREATE INDEX IF NOT EXISTS idx_orders_assigned_provider ON orders (assigned_provider_id)",
        "CREATE INDEX IF NOT EXISTS idx_orders_customer_location ON orders (customer_lat, customer_lng)",
        "CREATE INDEX IF NOT EXISTS idx_provider_presence_status ON provider_presence (status)",
        "CREATE INDEX IF NOT EXISTS idx_provider_presence_location ON provider_presence (lat, lng)",
        "CREATE INDEX IF NOT EXISTS idx_dispatch_offers_order ON dispatch_offers (order_id)",
        "CREATE INDEX IF NOT EXISTS idx_dispatch_offers_provider ON dispatch_offers (provider_id)",
        "CREATE INDEX IF NOT EXISTS idx_dispatch_offers_status ON dispatch_offers (status)",
        "CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events (order_id)",
    ]
    for statement in index_statements:
        connection.execute(text(statement))


def _migration_postgis_dispatch_geo_indexes(connection, engine: Engine) -> None:
    if engine.dialect.name != "postgresql":
        return

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


def _migration_customer_encrypted_columns(connection, engine: Engine) -> None:
    if engine.dialect.name != "postgresql":
        return
    alters = (
        "ALTER TABLE customers ALTER COLUMN name TYPE VARCHAR(512)",
        "ALTER TABLE customers ALTER COLUMN phone TYPE VARCHAR(512)",
        "ALTER TABLE customers ALTER COLUMN email TYPE VARCHAR(512)",
        "ALTER TABLE customers ALTER COLUMN city TYPE VARCHAR(512)",
    )
    for statement in alters:
        connection.execute(text(statement))


def applied_schema_migrations() -> list[dict[str, Any]]:
    engine = get_engine()
    with engine.begin() as connection:
        rows = connection.execute(
            select(schema_migrations.c.version, schema_migrations.c.name, schema_migrations.c.applied_at)
            .order_by(schema_migrations.c.version)
        ).mappings().all()
    return [
        {"version": str(row["version"]), "name": str(row["name"]), "appliedAt": row["applied_at"].isoformat()}
        for row in rows
    ]


def _json_safe_copy(value: Any) -> Any:
    return json.loads(json.dumps(value, ensure_ascii=False))


def _point(value: Any) -> tuple[float | None, float | None]:
    if not isinstance(value, dict):
        return None, None
    try:
        return float(value.get("lat")), float(value.get("lng"))
    except (TypeError, ValueError):
        return None, None


def _capability_index(value: Any) -> str:
    if not isinstance(value, list):
        return "|"
    cleaned = [str(item).strip().lower() for item in value if str(item).strip()]
    return "|" + "|".join(dict.fromkeys(cleaned)) + "|" if cleaned else "|"


def _parse_iso(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)
    except ValueError:
        return None


def _haversine_distance_km(left: dict[str, float], right: dict[str, float]) -> float:
    earth_radius_km = 6371.0
    lat1 = math.radians(left["lat"])
    lat2 = math.radians(right["lat"])
    delta_lat = math.radians(right["lat"] - left["lat"])
    delta_lng = math.radians(right["lng"] - left["lng"])
    value = math.sin(delta_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lng / 2) ** 2
    return 2 * earth_radius_km * math.atan2(math.sqrt(value), math.sqrt(1 - value))


def _merge_provider_payload(provider_payload: Any, presence_payload: Any, distance_km: float | None = None) -> dict[str, Any]:
    provider = _json_safe_copy(provider_payload if isinstance(provider_payload, dict) else {})
    presence = presence_payload if isinstance(presence_payload, dict) else {}
    for field in ["status", "etaMinutes", "assignedOrderId", "lastSeenAt", "lastLocationAt", "updatedAt"]:
        if presence.get(field) is not None:
            provider[field] = presence.get(field)
    if isinstance(presence.get("location"), dict):
        provider["location"] = presence["location"]
    if distance_km is not None:
        provider["distanceKm"] = round(distance_km, 2)
    return provider


def _offer_error_for_status(status: str) -> SqlDispatchConflict:
    if status == "expired":
        return SqlDispatchConflict("OFFER_EXPIRED", "Offer has expired.")
    if status == "declined":
        return SqlDispatchConflict("OFFER_DECLINED", "Offer has already been declined.")
    return SqlDispatchConflict("ORDER_ALREADY_ACCEPTED", "Order has already been accepted by another provider.")


def _load_payload_list(table: Table, order_by: Any) -> tuple[bool, list[dict[str, Any]]]:
    engine = get_engine()
    with engine.begin() as connection:
        rows = connection.execute(select(table.c.payload).order_by(order_by)).all()
    return bool(rows), [_json_safe_copy(row[0]) for row in rows]


def _load_providers_with_presence() -> tuple[bool, list[dict[str, Any]]]:
    engine = get_engine()
    with engine.begin() as connection:
        rows = connection.execute(
            select(
                providers.c.payload.label("provider_payload"),
                provider_presence.c.payload.label("presence_payload"),
            )
            .select_from(providers.outerjoin(provider_presence, providers.c.id == provider_presence.c.provider_id))
            .order_by(providers.c.id)
        ).mappings().all()
    if not rows:
        return False, []
    return True, [
        _merge_provider_payload(row["provider_payload"], row["presence_payload"])
        for row in rows
    ]


def sql_get_provider(provider_id: str) -> dict[str, Any] | None:
    """Load a single provider by id without scanning the full directory."""
    wanted = str(provider_id or "").strip()
    if not wanted:
        return None
    engine = get_engine()
    with engine.begin() as connection:
        row = connection.execute(
            select(
                providers.c.payload.label("provider_payload"),
                provider_presence.c.payload.label("presence_payload"),
            )
            .select_from(providers.outerjoin(provider_presence, providers.c.id == provider_presence.c.provider_id))
            .where(providers.c.id == wanted)
        ).mappings().first()
    if row is None:
        return None
    return _merge_provider_payload(row["provider_payload"], row["presence_payload"])


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
        found, payload = _load_providers_with_presence()
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


def sql_candidate_providers_for_order(
    order_id: str,
    service: str,
    already_offered_provider_ids: set[str] | None,
    max_radius_km: float,
    ttl_seconds: int,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    engine = get_engine()
    checked_at = now or datetime.now(timezone.utc).replace(tzinfo=None)
    threshold_iso = f"{(checked_at - timedelta(seconds=ttl_seconds)).isoformat(timespec='seconds')}Z"
    offered_ids = {str(item) for item in (already_offered_provider_ids or set())}

    if engine.dialect.name == "postgresql":
        return _postgres_candidate_providers(order_id, service, offered_ids, max_radius_km, threshold_iso)
    return _portable_candidate_providers(order_id, service, offered_ids, max_radius_km, threshold_iso)


def sql_accept_offer(
    offer_id: str,
    provider_id: str,
    proposed_price: float | None = None,
    price_note: str | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    engine = get_engine()
    now_dt = now or datetime.now(timezone.utc).replace(tzinfo=None)
    now_iso = f"{now_dt.isoformat(timespec='seconds')}Z"

    with engine.begin() as connection:
        # Lock the shared order before offer rows so competing accept attempts use one lock order.
        offer_lookup = connection.execute(
            select(
                dispatch_offers.c.id,
                dispatch_offers.c.order_id,
                dispatch_offers.c.provider_id,
                dispatch_offers.c.status,
                dispatch_offers.c.payload,
            ).where(dispatch_offers.c.id == str(offer_id))
        ).mappings().first()

        if offer_lookup is None or str(offer_lookup["provider_id"]) != str(provider_id):
            raise SqlDispatchConflict("OFFER_NOT_FOUND", "Offer was not found.")

        order_row = connection.execute(
            _for_update(
                select(
                    orders.c.id,
                    orders.c.status,
                    orders.c.payload,
                ).where(orders.c.id == str(offer_lookup["order_id"])),
                engine,
            )
        ).mappings().first()
        if order_row is None:
            offer = _json_object(offer_lookup["payload"])
            offer["status"] = "lost"
            offer["respondedAt"] = now_iso
            connection.execute(
                update(dispatch_offers)
                .where(dispatch_offers.c.id == str(offer_id))
                .values(status="lost", responded_at=now_iso, payload=offer)
            )
            raise SqlDispatchConflict("ORDER_NOT_FOUND", "Order was not found.")

        if str(order_row["status"] or "") != "searching":
            offer = _json_object(offer_lookup["payload"])
            offer["status"] = "lost"
            offer["respondedAt"] = now_iso
            connection.execute(
                update(dispatch_offers)
                .where(dispatch_offers.c.id == str(offer_id))
                .values(status="lost", responded_at=now_iso, payload=offer)
            )
            raise SqlDispatchConflict("ORDER_ALREADY_ACCEPTED", "Order has already been accepted by another provider.")

        offer_row = connection.execute(
            _for_update(
                select(
                    dispatch_offers.c.id,
                    dispatch_offers.c.order_id,
                    dispatch_offers.c.provider_id,
                    dispatch_offers.c.status,
                    dispatch_offers.c.payload,
                ).where(dispatch_offers.c.id == str(offer_id)),
                engine,
            )
        ).mappings().first()

        if offer_row is None or str(offer_row["provider_id"]) != str(provider_id):
            raise SqlDispatchConflict("OFFER_NOT_FOUND", "Offer was not found.")

        offer = _json_object(offer_row["payload"])
        offer_status = str(offer_row["status"] or offer.get("status") or "")
        if offer_status != "pending":
            raise _offer_error_for_status(offer_status)

        expires_at = _parse_iso(offer.get("expiresAt"))
        if expires_at is not None and expires_at <= now_dt:
            offer["status"] = "expired"
            offer["respondedAt"] = now_iso
            connection.execute(
                update(dispatch_offers)
                .where(dispatch_offers.c.id == str(offer_id))
                .values(status="expired", responded_at=now_iso, payload=offer)
            )
            raise SqlDispatchConflict("OFFER_EXPIRED", "Offer has expired.")

        provider_row = connection.execute(
            _for_update(
                select(
                    providers.c.id,
                    providers.c.verification_status,
                    providers.c.payload.label("provider_payload"),
                    provider_presence.c.payload.label("presence_payload"),
                )
                .select_from(providers.join(provider_presence, providers.c.id == provider_presence.c.provider_id))
                .where(providers.c.id == str(provider_id)),
                engine,
            )
        ).mappings().first()
        if provider_row is None:
            raise SqlDispatchConflict("PROVIDER_NOT_FOUND", "Provider was not found.")
        if str(provider_row["verification_status"] or "") != "verified":
            raise SqlDispatchConflict("PROVIDER_NOT_VERIFIED", "Provider verification is not approved.")

        if proposed_price is None or proposed_price <= 0:
            raise SqlDispatchConflict("PRICE_REQUIRED", "Partner must specify proposed price when accepting.")

        order = _json_object(order_row["payload"])
        provider = _merge_provider_payload(provider_row["provider_payload"], provider_row["presence_payload"])
        accepted_offer = _json_object(offer)

        accepted_offer["status"] = "accepted"
        accepted_offer["respondedAt"] = now_iso
        accepted_offer["proposedPrice"] = proposed_price
        if price_note:
            accepted_offer["priceNote"] = price_note
        order["status"] = "accepted"
        order["assignedProviderId"] = str(provider_id)
        order["partnerId"] = str(provider_id)
        order["assignedOfferId"] = str(offer_id)
        order["partnerProposedPrice"] = proposed_price
        order["partnerPriceNote"] = price_note
        order["acceptedAt"] = now_iso
        order["assignedProvider"] = {
            "id": provider.get("id"),
            "name": provider.get("name"),
            "rating": provider.get("rating"),
            "vehicle": provider.get("vehicle"),
            "plate": provider.get("plate"),
            "phone": provider.get("phone"),
            "telegram": provider.get("telegram"),
            "location": provider.get("location"),
            "verificationStatus": provider.get("verificationStatus"),
            "trustedBadges": provider.get("trustedBadges"),
            "distanceKm": accepted_offer.get("distanceKm"),
            "etaMinutes": max(2, math.ceil(float(accepted_offer.get("distanceKm") or 0) * 4)),
        }
        if provider.get("name"):
            order["providerName"] = provider.get("name")
        order["dispatchState"] = "ACCEPTED"
        order["updatedAt"] = now_iso
        history = order.get("statusHistory") if isinstance(order.get("statusHistory"), list) else []
        history.append({"status": "accepted", "at": now_iso})
        order["statusHistory"] = history
        _append_event(order, "OFFER_ACCEPTED", now_iso, {"offerId": str(offer_id), "providerId": str(provider_id), "proposedPrice": proposed_price})
        _append_event(order, "PROVIDER_ASSIGNED", now_iso, {"providerId": str(provider_id)})

        order_update = connection.execute(
            update(orders)
            .where(orders.c.id == str(order.get("id")), orders.c.status == "searching")
            .values(
                status="accepted",
                assigned_provider_id=str(provider_id),
                updated_at=now_iso,
                payload=order,
            )
        )
        if order_update.rowcount != 1:
            raise SqlDispatchConflict("ORDER_ALREADY_ACCEPTED", "Order has already been accepted by another provider.")

        connection.execute(
            update(dispatch_offers)
            .where(dispatch_offers.c.id == str(offer_id), dispatch_offers.c.status == "pending")
            .values(status="accepted", responded_at=now_iso, payload=accepted_offer)
        )

        other_offer_rows = connection.execute(
            select(dispatch_offers.c.id, dispatch_offers.c.payload)
            .where(
                dispatch_offers.c.order_id == str(order.get("id")),
                dispatch_offers.c.id != str(offer_id),
                dispatch_offers.c.status == "pending",
            )
        ).mappings().all()
        for other_row in other_offer_rows:
            other_offer = _json_object(other_row["payload"])
            other_offer["status"] = "lost"
            other_offer["respondedAt"] = now_iso
            connection.execute(
                update(dispatch_offers)
                .where(dispatch_offers.c.id == str(other_row["id"]))
                .values(status="lost", responded_at=now_iso, payload=other_offer)
            )

        provider["status"] = "busy"
        provider["assignedOrderId"] = str(order.get("id"))
        provider["updatedAt"] = now_iso
        provider["lastSeenAt"] = now_iso
        provider_presence_payload = {
            "status": "busy",
            "location": provider.get("location"),
            "etaMinutes": provider.get("etaMinutes"),
            "assignedOrderId": str(order.get("id")),
            "lastSeenAt": now_iso,
            "lastLocationAt": provider.get("lastLocationAt"),
            "updatedAt": now_iso,
        }
        connection.execute(
            update(providers)
            .where(providers.c.id == str(provider_id))
            .values(updated_at=now_iso, payload=provider)
        )
        connection.execute(
            update(provider_presence)
            .where(provider_presence.c.provider_id == str(provider_id))
            .values(
                status="busy",
                assigned_order_id=str(order.get("id")),
                last_seen_at=now_iso,
                updated_at=now_iso,
                payload=provider_presence_payload,
            )
        )

        _insert_order_events(connection, order)
        order_offers = [
            _json_object(row.payload)
            for row in connection.execute(
                select(dispatch_offers.c.payload)
                .where(dispatch_offers.c.order_id == str(order.get("id")))
                .order_by(dispatch_offers.c.created_at)
            )
        ]

    order_with_offers = dict(order)
    order_with_offers["offers"] = order_offers
    return {"offer": accepted_offer, "order": order_with_offers, "provider": provider}


def _postgres_candidate_providers(
    order_id: str,
    service: str,
    offered_ids: set[str],
    max_radius_km: float,
    threshold_iso: str,
) -> list[dict[str, Any]]:
    exclusion = "AND p.id NOT IN :offered_ids" if offered_ids else ""
    query = text(f"""
        SELECT
            p.payload AS provider_payload,
            pp.payload AS presence_payload,
            ST_Distance(
                ST_SetSRID(ST_MakePoint(pp.lng, pp.lat), 4326)::geography,
                ST_SetSRID(ST_MakePoint(o.customer_lng, o.customer_lat), 4326)::geography
            ) / 1000 AS distance_km
        FROM providers p
        JOIN provider_presence pp ON pp.provider_id = p.id
        JOIN orders o ON o.id = :order_id
        WHERE o.customer_lat IS NOT NULL
          AND o.customer_lng IS NOT NULL
          AND pp.lat IS NOT NULL
          AND pp.lng IS NOT NULL
          AND (
              p.verification_status = 'verified'
              OR COALESCE((p.payload->'verification'->>'phone')::boolean, false)
          )
          AND p.capabilities LIKE :capability
          AND pp.status = 'online'
          AND pp.assigned_order_id IS NULL
          AND pp.last_seen_at >= :threshold_iso
          AND pp.last_location_at >= :threshold_iso
          {exclusion}
          AND ST_DWithin(
              ST_SetSRID(ST_MakePoint(pp.lng, pp.lat), 4326)::geography,
              ST_SetSRID(ST_MakePoint(o.customer_lng, o.customer_lat), 4326)::geography,
              LEAST(COALESCE(p.service_radius_km, 15), :max_radius_km) * 1000
          )
        ORDER BY distance_km ASC
    """)
    if offered_ids:
        query = query.bindparams(bindparam("offered_ids", expanding=True))

    params = {
        "order_id": str(order_id),
        "capability": f"%|{service}|%",
        "threshold_iso": threshold_iso,
        "max_radius_km": max_radius_km,
    }
    if offered_ids:
        params["offered_ids"] = sorted(offered_ids)

    with get_engine().begin() as connection:
        rows = connection.execute(query, params).mappings().all()

    return [
        _merge_provider_payload(row["provider_payload"], row["presence_payload"], float(row["distance_km"]))
        for row in rows
    ]


def _portable_candidate_providers(
    order_id: str,
    service: str,
    offered_ids: set[str],
    max_radius_km: float,
    threshold_iso: str,
) -> list[dict[str, Any]]:
    engine = get_engine()
    with engine.begin() as connection:
        order_row = connection.execute(
            select(orders.c.customer_lat, orders.c.customer_lng).where(orders.c.id == str(order_id))
        ).mappings().first()
        if order_row is None or order_row["customer_lat"] is None or order_row["customer_lng"] is None:
            return []

        query = (
            select(
                providers.c.payload.label("provider_payload"),
                providers.c.service_radius_km,
                provider_presence.c.payload.label("presence_payload"),
                provider_presence.c.lat,
                provider_presence.c.lng,
            )
            .select_from(providers.join(provider_presence, providers.c.id == provider_presence.c.provider_id))
            .where(
                providers.c.capabilities.like(f"%|{service}|%"),
                provider_presence.c.status == "online",
                provider_presence.c.assigned_order_id.is_(None),
                provider_presence.c.last_seen_at >= threshold_iso,
                provider_presence.c.last_location_at >= threshold_iso,
                provider_presence.c.lat.is_not(None),
                provider_presence.c.lng.is_not(None),
            )
        )
        if offered_ids:
            query = query.where(providers.c.id.not_in(sorted(offered_ids)))
        rows = connection.execute(query).mappings().all()

    pickup = {"lat": float(order_row["customer_lat"]), "lng": float(order_row["customer_lng"])}
    candidates: list[dict[str, Any]] = []
    for row in rows:
        provider_payload = _json_object(row["provider_payload"])
        verification = provider_payload.get("verification") if isinstance(provider_payload.get("verification"), dict) else {}
        phone_verified = bool(verification.get("phone"))
        if str(provider_payload.get("verificationStatus") or "") != "verified" and not phone_verified:
            continue
        provider_point = {"lat": float(row["lat"]), "lng": float(row["lng"])}
        distance_km = _haversine_distance_km(pickup, provider_point)
        provider_radius = float(row["service_radius_km"] or 15)
        if distance_km > min(provider_radius, max_radius_km):
            continue
        candidates.append(_merge_provider_payload(row["provider_payload"], row["presence_payload"], distance_km))

    return sorted(candidates, key=lambda provider: provider["distanceKm"])


def _for_update(statement, engine: Engine):
    return statement.with_for_update() if engine.dialect.name == "postgresql" else statement


def _json_object(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except json.JSONDecodeError:
            return {}
    return _json_safe_copy(value if isinstance(value, dict) else {})


def _append_event(order: dict[str, Any], event_type: str, at: str, extra: dict[str, Any] | None = None) -> None:
    events = order.get("dispatchEvents")
    if not isinstance(events, list):
        events = []
    event = {"type": event_type, "at": at}
    if extra:
        event.update(extra)
    events.append(event)
    order["dispatchEvents"] = events


def _insert_order_events(connection, order: dict[str, Any]) -> None:
    events = order.get("dispatchEvents") if isinstance(order.get("dispatchEvents"), list) else []
    for index, event in enumerate(events):
        event_id = f"{order.get('id')}:{index}:{event.get('type')}:{event.get('at')}"[:240]
        exists = connection.execute(select(order_events.c.id).where(order_events.c.id == event_id)).first()
        if exists:
            continue
        connection.execute(
            insert(order_events).values(
                id=event_id,
                order_id=str(order.get("id")),
                event_type=str(event.get("type") or "") or None,
                event_at=str(event.get("at") or "") or None,
                provider_id=str(event.get("providerId") or "") or None,
                offer_id=str(event.get("offerId") or "") or None,
                payload=event,
            )
        )


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
            updated_at=datetime.now(timezone.utc).replace(tzinfo=None),
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


def sql_upsert_provider(provider: dict[str, Any]) -> dict[str, Any]:
    payload = _json_safe_copy(provider)
    provider_id = str(payload.get("id") or "").strip()
    if not provider_id:
        raise ValueError("provider id is required")

    now_iso = str(payload.get("updatedAt") or payload.get("lastSeenAt") or datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds") + "Z")
    payload["updatedAt"] = now_iso
    has_location_update = isinstance(payload.get("location"), dict)
    location_lat, location_lng = _point(payload.get("location")) if has_location_update else (None, None)
    presence_payload = {
        "status": payload.get("status") or "offline",
        "location": payload.get("location"),
        "etaMinutes": payload.get("etaMinutes"),
        "assignedOrderId": payload.get("assignedOrderId"),
        "lastSeenAt": payload.get("lastSeenAt"),
        "lastLocationAt": payload.get("lastLocationAt"),
        "updatedAt": now_iso,
    }

    with get_engine().begin() as connection:
        existing = connection.execute(select(providers.c.id).where(providers.c.id == provider_id)).first()
        provider_values = {
            "id": provider_id,
            "name": str(payload.get("name") or "") or None,
            "phone": str(payload.get("phone") or "") or None,
            "telegram": str(payload.get("telegram") or "") or None,
            "vehicle": str(payload.get("vehicle") or "") or None,
            "plate": str(payload.get("plate") or "") or None,
            "capabilities": _capability_index(payload.get("specialties")),
            "rating": float(payload.get("rating")) if payload.get("rating") is not None else None,
            "verification_status": str(payload.get("verificationStatus") or "unverified"),
            "service_radius_km": float(payload.get("serviceRadiusKm")) if payload.get("serviceRadiusKm") is not None else None,
            "registered_at": str(payload.get("registeredAt") or ""),
            "updated_at": now_iso,
            "payload": payload,
        }
        if existing:
            connection.execute(
                update(providers)
                .where(providers.c.id == provider_id)
                .values(**{key: value for key, value in provider_values.items() if key != "id"})
            )
        else:
            connection.execute(insert(providers).values(**provider_values))

        presence_values = {
            "provider_id": provider_id,
            "status": str(payload.get("status") or "offline"),
            "eta_minutes": float(payload.get("etaMinutes")) if payload.get("etaMinutes") is not None else None,
            "assigned_order_id": str(payload.get("assignedOrderId") or "") or None,
            "last_seen_at": str(payload.get("lastSeenAt") or ""),
            "last_location_at": str(payload.get("lastLocationAt") or ""),
            "updated_at": now_iso,
            "payload": presence_payload,
        }
        if has_location_update and location_lat is not None and location_lng is not None:
            presence_values["lat"] = location_lat
            presence_values["lng"] = location_lng
        existing_presence = connection.execute(
            select(provider_presence.c.provider_id).where(provider_presence.c.provider_id == provider_id)
        ).first()
        if existing_presence:
            connection.execute(
                update(provider_presence)
                .where(provider_presence.c.provider_id == provider_id)
                .values(**{key: value for key, value in presence_values.items() if key != "provider_id"})
            )
        else:
            insert_values = dict(presence_values)
            insert_values.setdefault("lat", location_lat)
            insert_values.setdefault("lng", location_lng)
            connection.execute(insert(provider_presence).values(**insert_values))

    return payload


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
                capabilities=_capability_index(provider.get("specialties")),
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


def _customer_column_value(value: Any, max_len: int) -> str | None:
    normalized = str(value or "").strip()
    if not normalized:
        return None
    # Encrypted PII lives in payload JSON only; indexed columns stay plaintext-sized.
    if normalized.startswith("enc:v1:"):
        return None
    return normalized[:max_len]


def _save_customers(connection, customer_payloads: list[dict[str, Any]]) -> None:
    connection.execute(delete(customers))
    for customer in customer_payloads:
        connection.execute(
            insert(customers).values(
                id=str(customer.get("id")),
                name=_customer_column_value(customer.get("name"), 180),
                phone=_customer_column_value(customer.get("phone"), 80),
                email=_customer_column_value(customer.get("email"), 180),
                telegram=_customer_column_value(customer.get("telegram"), 180),
                city=_customer_column_value(customer.get("city"), 120),
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
