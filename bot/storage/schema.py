from sqlalchemy import Column, DateTime, Float, Index, Integer, JSON, MetaData, String, Table

_METADATA = MetaData()

customers = Table(
    "customers",
    _METADATA,
    Column("id", String(120), primary_key=True),
    Column("name", String(512)),
    Column("phone", String(512)),
    Column("phone_lookup", String(64)),
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
    Column("phone_lookup", String(64)),
    Column("telegram", String(180)),
    Column("vehicle", String(180)),
    Column("plate", String(80)),
    Column("provider_kind", String(40)),
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
    Column("version", Integer, nullable=False, server_default="1"),
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
Index("idx_orders_customer_id", orders.c.customer_id)
Index("idx_orders_customer_location", orders.c.customer_lat, orders.c.customer_lng)
Index("idx_provider_presence_status", provider_presence.c.status)
Index("idx_provider_presence_location", provider_presence.c.lat, provider_presence.c.lng)
Index("idx_providers_capabilities", providers.c.capabilities)
Index("idx_providers_kind", providers.c.provider_kind)
Index("idx_providers_phone_lookup", providers.c.phone_lookup)
Index("idx_customers_phone_lookup", customers.c.phone_lookup)
Index("idx_dispatch_offers_order", dispatch_offers.c.order_id)
Index("idx_dispatch_offers_provider", dispatch_offers.c.provider_id)
Index("idx_dispatch_offers_status", dispatch_offers.c.status)
Index("idx_order_events_order", order_events.c.order_id)
