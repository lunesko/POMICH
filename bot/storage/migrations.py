from datetime import datetime, timezone
from sqlalchemy import insert, inspect, select, text, update
from sqlalchemy.engine import Engine
from bot.storage.schema import _METADATA, customers, providers, provider_presence, orders, dispatch_offers, sessions, order_events, schema_migrations, runtime_collections
from bot.storage.sql_values import _json_safe_copy, _point, _capability_index, _json_object

def _run_schema_migrations(engine: Engine) -> None:
    migrations = (
        ("2026081101", "runtime schema baseline", _migration_runtime_schema_baseline),
        ("2026081102", "provider capabilities backfill", _migration_provider_capabilities),
        ("2026081103", "dispatch core indexes", _migration_dispatch_core_indexes),
        ("2026081104", "postgis dispatch geo indexes", _migration_postgis_dispatch_geo_indexes),
        ("2026081201", "widen customer encrypted columns", _migration_customer_encrypted_columns),
        ("2026082001", "phone lookup indexes for OTP/login", _migration_phone_lookup_indexes),
        ("2026092701", "provider kind and public map indexes", _migration_provider_map_indexes),
        ("2026092702", "active dispatch offer uniqueness", _migration_active_offer_uniqueness),
        ("2026100701", "order versions and shared OTP", _migration_order_versions),
    )

    with engine.begin() as connection:
        if engine.dialect.name == "postgresql":
            connection.execute(text("SELECT pg_advisory_xact_lock(1347374411)"))
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


def _migration_order_versions(connection, engine: Engine) -> None:
    columns = {column["name"] for column in inspect(connection).get_columns("orders")}
    if "version" not in columns:
        connection.execute(text("ALTER TABLE orders ADD COLUMN version INTEGER NOT NULL DEFAULT 1"))
    for row in connection.execute(select(orders.c.id, orders.c.version, orders.c.payload)).mappings():
        payload = _json_object(row["payload"])
        payload["version"] = int(row["version"])
        connection.execute(update(orders).where(orders.c.id == row["id"]).values(payload=payload))


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


def _migration_phone_lookup_indexes(connection, engine: Engine) -> None:
    from bot.phone_lookup import phone_lookup_key_from_payload

    customer_columns = {column["name"] for column in inspect(connection).get_columns("customers")}
    provider_columns = {column["name"] for column in inspect(connection).get_columns("providers")}
    if "phone_lookup" not in customer_columns:
        connection.execute(text("ALTER TABLE customers ADD COLUMN phone_lookup VARCHAR(64)"))
    if "phone_lookup" not in provider_columns:
        connection.execute(text("ALTER TABLE providers ADD COLUMN phone_lookup VARCHAR(64)"))

    connection.execute(text("CREATE INDEX IF NOT EXISTS idx_customers_phone_lookup ON customers (phone_lookup)"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS idx_providers_phone_lookup ON providers (phone_lookup)"))
    connection.execute(text("CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders (customer_id)"))

    for row in connection.execute(select(customers.c.id, customers.c.payload)).mappings().all():
        lookup = phone_lookup_key_from_payload(_json_object(row["payload"]))
        connection.execute(
            update(customers).where(customers.c.id == str(row["id"])).values(phone_lookup=lookup)
        )

    for row in connection.execute(select(providers.c.id, providers.c.payload)).mappings().all():
        lookup = phone_lookup_key_from_payload(_json_object(row["payload"]))
        connection.execute(
            update(providers).where(providers.c.id == str(row["id"])).values(phone_lookup=lookup)
        )


def _migration_provider_map_indexes(connection, engine: Engine) -> None:
    existing_columns = {column["name"] for column in inspect(connection).get_columns("providers")}
    if "provider_kind" not in existing_columns:
        connection.execute(text("ALTER TABLE providers ADD COLUMN provider_kind VARCHAR(40)"))

    for row in connection.execute(select(providers.c.id, providers.c.payload)).mappings().all():
        payload = _json_object(row["payload"])
        provider_kind = str(payload.get("providerKind") or "dispatch").strip().lower() or "dispatch"
        connection.execute(
            update(providers).where(providers.c.id == str(row["id"])).values(provider_kind=provider_kind)
        )

    connection.execute(text("CREATE INDEX IF NOT EXISTS idx_providers_kind ON providers (provider_kind)"))
    if "verification_status" in existing_columns:
        connection.execute(
            text("CREATE INDEX IF NOT EXISTS idx_providers_kind_verification ON providers (provider_kind, verification_status)")
        )
    if engine.dialect.name == "postgresql":
        connection.execute(text("""
            CREATE INDEX IF NOT EXISTS idx_provider_presence_location_geometry_gist
            ON provider_presence
            USING GIST (ST_SetSRID(ST_MakePoint(lng, lat), 4326))
            WHERE lat IS NOT NULL AND lng IS NOT NULL
        """))


def _migration_active_offer_uniqueness(connection, engine: Engine) -> None:
    # Preserve the newest non-expired offer if legacy/concurrent workers created duplicates.
    rows = connection.execute(
        select(
            dispatch_offers.c.id,
            dispatch_offers.c.order_id,
            dispatch_offers.c.provider_id,
            dispatch_offers.c.status,
            dispatch_offers.c.created_at,
            dispatch_offers.c.payload,
        )
        .where(dispatch_offers.c.status != "expired")
        .order_by(dispatch_offers.c.created_at.desc(), dispatch_offers.c.id.desc())
    ).mappings().all()
    seen: set[tuple[str, str]] = set()
    now_iso = datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds") + "Z"
    for row in rows:
        key = (str(row["order_id"]), str(row["provider_id"]))
        if key not in seen:
            seen.add(key)
            continue
        payload = _json_object(row["payload"])
        payload["status"] = "expired"
        payload["respondedAt"] = payload.get("respondedAt") or now_iso
        connection.execute(
            update(dispatch_offers)
            .where(dispatch_offers.c.id == str(row["id"]))
            .values(status="expired", responded_at=payload["respondedAt"], payload=payload)
        )

    connection.execute(text("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_dispatch_offers_order_provider_active
        ON dispatch_offers (order_id, provider_id)
        WHERE status <> 'expired'
    """))
