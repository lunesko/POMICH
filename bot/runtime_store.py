from bot.storage.migrations import _run_schema_migrations, _migration_order_versions, _migration_runtime_schema_baseline, _migration_provider_capabilities, _migration_dispatch_core_indexes, _migration_postgis_dispatch_geo_indexes, _migration_customer_encrypted_columns, _migration_phone_lookup_indexes, _migration_provider_map_indexes, _migration_active_offer_uniqueness
from bot.storage.sql_values import _json_safe_copy, _point, _capability_index, _json_object
import json
import math
import os
import threading
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import Integer, JSON, Column, DateTime, Float, Index, MetaData, String, Table, bindparam, create_engine, delete, insert, inspect, select, text, update
from sqlalchemy.engine import Engine

_STORE_LOCK = threading.RLock()
_ENGINE: Engine | None = None
_ENGINE_URL: str | None = None

class SqlDispatchConflict(ValueError):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message
        super().__init__(message)

from bot.storage.schema import _METADATA, customers, providers, provider_presence, orders, dispatch_offers, sessions, order_events, schema_migrations, runtime_collections

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
            try:
                _install_schema(_ENGINE)
            except Exception:
                _ENGINE.dispose()
                _ENGINE = None
                _ENGINE_URL = None
                raise
        return _ENGINE

def reset_runtime_store_for_tests() -> None:
    global _ENGINE, _ENGINE_URL
    with _STORE_LOCK:
        if _ENGINE is not None:
            _ENGINE.dispose()
        _ENGINE = None
        _ENGINE_URL = None

def _install_schema(engine: Engine) -> None:
    from bot import otp_repository  # register shared OTP table before create_all
    from bot.storage import realtime_events
    from bot import rate_limits
    with engine.begin() as connection:
        if engine.dialect.name == "postgresql":
            connection.execute(text("SELECT pg_advisory_xact_lock(1347374411)"))
            connection.execute(text("CREATE EXTENSION IF NOT EXISTS postgis"))
        _METADATA.create_all(connection)
    _run_schema_migrations(engine)

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

def sql_get_customer(customer_id: str) -> dict[str, Any] | None:
    wanted = str(customer_id or "").strip()
    if not wanted:
        return None
    engine = get_engine()
    with engine.begin() as connection:
        row = connection.execute(
            select(customers.c.payload).where(customers.c.id == wanted)
        ).first()
    if row is None:
        return None
    return _json_safe_copy(row[0])

def sql_upsert_customer(customer: dict[str, Any]) -> dict[str, Any]:
    """Insert or update one customer row without rewriting the whole table."""
    payload = _json_safe_copy(customer)
    customer_id = str(payload.get("id") or "").strip()
    if not customer_id:
        raise ValueError("customer id is required")
    now_iso = str(payload.get("updatedAt") or datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds") + "Z")
    payload["updatedAt"] = now_iso
    from bot.phone_lookup import phone_lookup_key_from_payload
    values = {
        "id": customer_id,
        "name": _customer_column_value(payload.get("name"), 180),
        "phone": _customer_column_value(payload.get("phone"), 80),
        "phone_lookup": phone_lookup_key_from_payload(payload),
        "email": _customer_column_value(payload.get("email"), 180),
        "telegram": _customer_column_value(payload.get("telegram"), 180),
        "city": _customer_column_value(payload.get("city"), 120),
        "verification_status": str(payload.get("verificationStatus") or "unverified"),
        "created_at": str(payload.get("createdAt") or ""),
        "updated_at": now_iso,
        "payload": payload,
    }
    with get_engine().begin() as connection:
        existing = connection.execute(select(customers.c.id).where(customers.c.id == customer_id)).first()
        if existing:
            connection.execute(
                update(customers)
                .where(customers.c.id == customer_id)
                .values(**{key: value for key, value in values.items() if key != "id"})
            )
        else:
            connection.execute(insert(customers).values(**values))
    return payload

def sql_get_order(order_id: str) -> dict[str, Any] | None:
    wanted = str(order_id or "").strip()
    if not wanted:
        return None
    engine = get_engine()
    with engine.begin() as connection:
        row = connection.execute(
            select(orders.c.payload).where(orders.c.id == wanted)
        ).first()
    if row is None:
        return None
    return _json_safe_copy(row[0])

def _order_row_values(payload: dict[str, Any]) -> dict[str, Any]:
    customer_lat, customer_lng = _point(payload.get("customerCoordinates"))
    destination_lat, destination_lng = _point(payload.get("destinationCoordinates"))
    return {
        "id": str(payload["id"]), "version": int(payload["version"]),
        "status": str(payload.get("status") or "searching"),
        "service": str(payload.get("service") or "") or None,
        "source": str(payload.get("source") or "") or None,
        "customer_id": str(payload.get("customerId") or payload.get("customer_id") or "") or None,
        "chat_id": str(payload.get("chatId") or "") or None,
        "assigned_provider_id": str(payload.get("assignedProviderId") or payload.get("partnerId") or "") or None,
        "customer_lat": customer_lat, "customer_lng": customer_lng,
        "destination_lat": destination_lat, "destination_lng": destination_lng,
        "created_at": str(payload.get("createdAt") or ""),
        "updated_at": str(payload.get("updatedAt") or ""), "payload": payload,
    }

def _persist_order(connection, payload: dict[str, Any], *, expected_version: int | None = None,
                   expected_status: str | None = None) -> bool:
    order_id = str(payload.get("id") or "").strip()
    if not order_id:
        raise ValueError("order id is required")
    current = connection.execute(select(orders.c.version, orders.c.status)
        .where(orders.c.id == order_id).with_for_update()).first()
    if current is None:
        if expected_version is not None or expected_status is not None:
            return False
        payload["version"] = 1
        connection.execute(insert(orders).values(**_order_row_values(payload)))
    else:
        if expected_version is not None and current.version != expected_version:
            return False
        if expected_status is not None and current.status != expected_status:
            return False
        payload["version"] = int(current.version) + 1
        values = _order_row_values(payload)
        values.pop("id")
        result = connection.execute(update(orders)
            .where(orders.c.id == order_id, orders.c.version == current.version).values(**values))
        if result.rowcount != 1:
            return False
    _insert_order_events(connection, payload)
    return True

def sql_upsert_order(order: dict[str, Any]) -> dict[str, Any]:
    payload = _json_safe_copy(order)
    with get_engine().begin() as connection:
        if not _persist_order(connection, payload, expected_version=payload.get("version")):
            raise SqlDispatchConflict("ORDER_VERSION_CONFLICT", "Order changed; reload before saving.")
    return payload

def sql_offers_for_order(order_id: str) -> list[dict[str, Any]]:
    wanted = str(order_id or "").strip()
    if not wanted:
        return []
    engine = get_engine()
    with engine.begin() as connection:
        rows = connection.execute(
            select(dispatch_offers.c.payload)
            .where(dispatch_offers.c.order_id == wanted)
            .order_by(dispatch_offers.c.created_at)
        ).all()
    return [_json_safe_copy(row[0]) for row in rows]

def sql_commit_order_snapshot(original: dict[str, Any], proposed: dict[str, Any],
                              original_offers: list[dict[str, Any]] | None = None,
                              proposed_offers: list[dict[str, Any]] | None = None) -> bool:
    """Commit changed dispatch rows only if their locked snapshots are still current."""
    engine = get_engine()
    order_id = str(original["id"])
    with engine.begin() as connection:
        row = connection.execute(_for_update(
            select(orders.c.version).where(orders.c.id == order_id), engine,
        )).first()
        if row is None or row[0] != original.get("version"):
            return False
        if original_offers is not None:
            rows = connection.execute(_for_update(
                select(dispatch_offers.c.payload)
                .where(dispatch_offers.c.order_id == order_id)
                .order_by(dispatch_offers.c.id), engine,
            )).all()
            current = {str(item[0]["id"]): _json_object(item[0]) for item in rows}
            expected = {str(item["id"]): item for item in original_offers}
            if current != expected:
                return False
        if proposed != original and not _persist_order(connection, proposed, expected_version=original["version"]):
            return False
        if original_offers is not None:
            for offer in proposed_offers or []:
                if offer != expected.get(str(offer["id"])):
                    connection.execute(update(dispatch_offers)
                        .where(dispatch_offers.c.id == str(offer["id"]))
                        .values(status=offer["status"], responded_at=offer.get("respondedAt"), payload=offer))
    return True

def sql_orders_by_status(statuses: set[str], *, limit: int | None = 1000) -> list[dict[str, Any]]:
    wanted = {str(status).strip().lower() for status in statuses if str(status).strip()}
    if not wanted:
        return []
    capped = max(1, min(int(limit or 1000), 5000)) if limit is not None else None
    with get_engine().begin() as connection:
        query = select(orders.c.payload).where(orders.c.status.in_(sorted(wanted)))
        if capped is not None:
            rows = connection.execute(query.order_by(orders.c.updated_at).limit(capped)).all()
        else:
            rows = []
            last_id = ""
            while True:
                page = connection.execute(select(orders.c.id, orders.c.payload)
                    .where(orders.c.status.in_(sorted(wanted)), orders.c.id > last_id)
                    .order_by(orders.c.id).limit(1000)).all()
                if not page:
                    break
                rows.extend((row.payload,) for row in page)
                last_id = page[-1].id
    return [_json_safe_copy(row[0]) for row in rows]

def sql_searching_orders_near_provider(
    *,
    lat: float,
    lng: float,
    services: set[str],
    radius_km: float,
    limit: int = 200,
) -> list[dict[str, Any]]:
    """Candidate searching orders for one provider, filtered before leaving SQL."""
    normalized_services = {str(service).strip().lower() for service in services if str(service).strip()}
    if not normalized_services:
        return []
    capped = max(1, min(int(limit or 200), 500))
    radius = max(1.0, min(float(radius_km or 15.0), 100.0))
    lat_delta = radius / 110.574
    lng_divisor = max(0.2, math.cos(math.radians(float(lat))))
    lng_delta = radius / (111.320 * lng_divisor)
    engine = get_engine()
    with engine.begin() as connection:
        query = (
            select(orders.c.payload)
            .where(orders.c.status == "searching")
            .where((orders.c.assigned_provider_id.is_(None)) | (orders.c.assigned_provider_id == ""))
            .where(orders.c.service.in_(sorted(normalized_services)))
            .where(orders.c.customer_lat.is_not(None), orders.c.customer_lng.is_not(None))
        )
        if engine.dialect.name == "postgresql":
            query = query.where(text("""
                ST_DWithin(
                    ST_SetSRID(ST_MakePoint(orders.customer_lng, orders.customer_lat), 4326)::geography,
                    ST_SetSRID(ST_MakePoint(:provider_lng, :provider_lat), 4326)::geography,
                    :provider_radius_m
                )
            """)).params(
                provider_lng=float(lng),
                provider_lat=float(lat),
                provider_radius_m=radius * 1000,
            )
        else:
            query = query.where(
                orders.c.customer_lat.between(float(lat) - lat_delta, float(lat) + lat_delta),
                orders.c.customer_lng.between(float(lng) - lng_delta, float(lng) + lng_delta),
            )
        rows = connection.execute(query.order_by(orders.c.updated_at).limit(capped)).all()
    return [_json_safe_copy(row[0]) for row in rows]

def sql_offers_for_orders(order_ids: set[str]) -> list[dict[str, Any]]:
    wanted = {str(order_id).strip() for order_id in order_ids if str(order_id).strip()}
    if not wanted:
        return []
    with get_engine().begin() as connection:
        rows = connection.execute(
            select(dispatch_offers.c.payload)
            .where(dispatch_offers.c.order_id.in_(sorted(wanted)))
            .order_by(dispatch_offers.c.created_at)
        ).all()
    return [_json_safe_copy(row[0]) for row in rows]

def sql_invalidate_order_offers(order_id: str, status: str, *, now: datetime | None = None) -> list[dict[str, Any]]:
    wanted = str(order_id or "").strip()
    if not wanted:
        return []
    target_status = "cancelled" if status == "cancelled" else "lost"
    checked_at = now or datetime.now(timezone.utc).replace(tzinfo=None)
    now_iso = f"{checked_at.isoformat(timespec='seconds')}Z"
    with get_engine().begin() as connection:
        rows = connection.execute(
            select(dispatch_offers.c.id, dispatch_offers.c.payload)
            .where(dispatch_offers.c.order_id == wanted)
            .where(dispatch_offers.c.status == "pending")
        ).mappings().all()
        for row in rows:
            payload = _json_object(row["payload"])
            payload["status"] = target_status
            payload["respondedAt"] = now_iso
            connection.execute(
                update(dispatch_offers)
                .where(dispatch_offers.c.id == str(row["id"]))
                .values(status=target_status, responded_at=now_iso, payload=payload)
            )
        all_rows = connection.execute(
            select(dispatch_offers.c.payload)
            .where(dispatch_offers.c.order_id == wanted)
            .order_by(dispatch_offers.c.created_at)
        ).all()
    return [_json_safe_copy(row[0]) for row in all_rows]

def sql_commit_dispatch_wave(
    proposed_order: dict[str, Any],
    proposed_offers: list[dict[str, Any]],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Atomically lock an order, add non-duplicate offers, and persist dispatch state."""
    order_id = str(proposed_order.get("id") or "").strip()
    if not order_id:
        raise ValueError("order id is required")
    with get_engine().begin() as connection:
        locked = connection.execute(
            select(orders.c.payload).where(orders.c.id == order_id).with_for_update()
        ).first()
        if locked is None:
            raise ValueError("order was not found")
        current_order = _json_object(locked[0])
        if str(current_order.get("status") or "").strip().lower() != "searching":
            all_rows = connection.execute(
                select(dispatch_offers.c.payload)
                .where(dispatch_offers.c.order_id == order_id)
                .order_by(dispatch_offers.c.created_at)
            ).all()
            return current_order, [_json_safe_copy(row[0]) for row in all_rows]
        existing_rows = connection.execute(
            select(dispatch_offers.c.provider_id, dispatch_offers.c.payload)
            .where(dispatch_offers.c.order_id == order_id)
            .where(dispatch_offers.c.status != "expired")
        ).mappings().all()
        blocked_provider_ids = {str(row["provider_id"]) for row in existing_rows}
        inserted = [
            _json_safe_copy(offer)
            for offer in proposed_offers
            if str(offer.get("providerId") or "") not in blocked_provider_ids
        ]
        if not inserted:
            all_rows = connection.execute(
                select(dispatch_offers.c.payload)
                .where(dispatch_offers.c.order_id == order_id)
                .order_by(dispatch_offers.c.created_at)
            ).all()
            return current_order, [_json_safe_copy(row[0]) for row in all_rows]

        inserted_ids = {str(offer.get("id")) for offer in inserted}
        existing_offer_ids = {
            str(row["payload"].get("id") or "")
            for row in existing_rows
            if isinstance(row["payload"], dict)
        }
        persisted_order = {**current_order, **_json_safe_copy(proposed_order)}
        current_events = current_order.get("dispatchEvents") if isinstance(current_order.get("dispatchEvents"), list) else []
        proposed_events = proposed_order.get("dispatchEvents") if isinstance(proposed_order.get("dispatchEvents"), list) else []
        merged_events: list[dict[str, Any]] = []
        seen_events: set[tuple[str, str, str, str]] = set()
        for event in [*current_events, *proposed_events]:
            if not isinstance(event, dict):
                continue
            if event.get("type") == "OFFER_CREATED" and str(event.get("offerId") or "") not in inserted_ids:
                # Keep events already committed by another worker; drop only this
                # worker's offer events that did not win the uniqueness check.
                if str(event.get("offerId") or "") not in existing_offer_ids:
                    continue
            key = (
                str(event.get("type") or ""),
                str(event.get("at") or ""),
                str(event.get("offerId") or ""),
                str(event.get("providerId") or ""),
            )
            if key in seen_events:
                continue
            seen_events.add(key)
            merged_events.append(_json_safe_copy(event))
        persisted_order["dispatchEvents"] = merged_events
        current_info = current_order.get("dispatchInfo") if isinstance(current_order.get("dispatchInfo"), dict) else {}
        proposed_info = proposed_order.get("dispatchInfo") if isinstance(proposed_order.get("dispatchInfo"), dict) else {}
        if current_info or proposed_info:
            dispatch_info = {**current_info, **_json_safe_copy(proposed_info)}
            dispatch_info["offersSentThisWave"] = len(inserted)
            dispatch_info["offersSent"] = len(existing_rows) + len(inserted)
            dispatch_info["wave"] = max(int(current_info.get("wave") or 0), int(dispatch_info.get("wave") or 0))
            persisted_order["dispatchInfo"] = dispatch_info

        for offer in inserted:
            connection.execute(insert(dispatch_offers).values(**_offer_row_values(offer)))

        _persist_order(connection, persisted_order)
        all_rows = connection.execute(
            select(dispatch_offers.c.payload)
            .where(dispatch_offers.c.order_id == order_id)
            .order_by(dispatch_offers.c.created_at)
        ).all()
    return persisted_order, [_json_safe_copy(row[0]) for row in all_rows]

def _offer_row_values(offer: dict[str, Any]) -> dict[str, Any]:
    payload = _json_safe_copy(offer)
    return {
        "id": str(payload.get("id") or "").strip(),
        "order_id": str(payload.get("orderId") or "").strip(),
        "provider_id": str(payload.get("providerId") or "").strip(),
        "status": str(payload.get("status") or "pending"),
        "distance_km": float(payload.get("distanceKm")) if payload.get("distanceKm") is not None else None,
        "created_at": str(payload.get("createdAt") or ""),
        "expires_at": str(payload.get("expiresAt") or ""),
        "responded_at": str(payload.get("respondedAt") or ""),
        "payload": payload,
    }

def sql_upsert_offer(offer: dict[str, Any]) -> dict[str, Any]:
    """Insert or update a single dispatch offer without rewriting the offers table."""
    values = _offer_row_values(offer)
    offer_id = values["id"]
    if not offer_id or not values["order_id"] or not values["provider_id"]:
        raise ValueError("offer id, orderId and providerId are required")
    with get_engine().begin() as connection:
        existing = connection.execute(select(dispatch_offers.c.id).where(dispatch_offers.c.id == offer_id)).first()
        if existing:
            connection.execute(
                update(dispatch_offers)
                .where(dispatch_offers.c.id == offer_id)
                .values(**{key: value for key, value in values.items() if key != "id"})
            )
        else:
            connection.execute(insert(dispatch_offers).values(**values))
    return values["payload"]

def sql_insert_offers(offers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Insert new offer rows only (used by wave dispatch)."""
    if not offers:
        return []
    persisted: list[dict[str, Any]] = []
    with get_engine().begin() as connection:
        for offer in offers:
            values = _offer_row_values(offer)
            if not values["id"] or not values["order_id"] or not values["provider_id"]:
                raise ValueError("offer id, orderId and providerId are required")
            connection.execute(insert(dispatch_offers).values(**values))
            persisted.append(values["payload"])
    return persisted

def sql_expire_pending_offers(
    *,
    order_id: str | None = None,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """Expire timed-out pending offers (optionally scoped to one order). Returns updated offers."""
    now_dt = now or datetime.now(timezone.utc).replace(tzinfo=None)
    now_iso = f"{now_dt.isoformat(timespec='seconds')}Z"
    changed: list[dict[str, Any]] = []
    with get_engine().begin() as connection:
        # Lock in the same order as acceptance: order first, then its offers.
        candidates = connection.execute(select(dispatch_offers.c.id, dispatch_offers.c.order_id)
            .where(dispatch_offers.c.status == "pending")
            .where(dispatch_offers.c.order_id == str(order_id) if order_id else True)
            .order_by(dispatch_offers.c.order_id, dispatch_offers.c.id)).all()
        for candidate in candidates:
            order_row = connection.execute(select(orders.c.status, orders.c.payload)
                .where(orders.c.id == candidate.order_id).with_for_update()).first()
            offer_row = connection.execute(select(dispatch_offers)
                .where(dispatch_offers.c.id == candidate.id).with_for_update()).mappings().first()
            if offer_row is None or offer_row["status"] != "pending":
                continue
            row = {**offer_row, "order_status": order_row.status if order_row else None,
                   "order_payload": order_row.payload if order_row else None}
            expires_at = None
            raw_expires = row["expires_at"]
            if raw_expires:
                try:
                    expires_at = datetime.fromisoformat(str(raw_expires).replace("Z", "+00:00")).replace(tzinfo=None)
                except ValueError:
                    expires_at = None
            order_status = str(row["order_status"] or "").strip().lower()
            new_status = None
            if order_status in {"", "cancelled"} or order_status in {"completed", "cancelled"}:
                new_status = "cancelled" if order_status != "completed" else "lost"
            elif order_status and order_status != "searching":
                new_status = "lost"
            elif expires_at and now_dt >= expires_at:
                new_status = "expired"
            if not new_status:
                continue
            offer_payload = _json_safe_copy(row["payload"] if isinstance(row["payload"], dict) else {})
            offer_payload["status"] = new_status
            offer_payload["respondedAt"] = now_iso
            connection.execute(
                update(dispatch_offers)
                .where(dispatch_offers.c.id == str(row["id"]))
                .values(status=new_status, responded_at=now_iso, payload=offer_payload)
            )
            if new_status == "expired" and isinstance(row["order_payload"], dict):
                order_payload = _json_safe_copy(row["order_payload"])
                _append_event(
                    order_payload,
                    "OFFER_EXPIRED",
                    now_iso,
                    {"offerId": row["id"], "providerId": row["provider_id"]},
                )
                _persist_order(connection, order_payload)
            changed.append(offer_payload)
    return changed

def sql_decline_offer(offer_id: str, provider_id: str, now: datetime | None = None) -> dict[str, Any]:
    """Mark one pending offer declined and append an order event — no full-table rewrite."""
    now_dt = now or datetime.now(timezone.utc).replace(tzinfo=None)
    now_iso = f"{now_dt.isoformat(timespec='seconds')}Z"
    with get_engine().begin() as connection:
        lookup = connection.execute(select(dispatch_offers.c.order_id, dispatch_offers.c.provider_id)
            .where(dispatch_offers.c.id == str(offer_id))).first()
        if lookup is None or str(lookup.provider_id) != str(provider_id):
            raise SqlDispatchConflict("OFFER_NOT_FOUND", "Offer was not found.")
        order_row = connection.execute(select(orders.c.payload)
            .where(orders.c.id == lookup.order_id).with_for_update()).first()
        offer_row = connection.execute(
            _for_update(
                select(
                    dispatch_offers.c.id,
                    dispatch_offers.c.order_id,
                    dispatch_offers.c.provider_id,
                    dispatch_offers.c.status,
                    dispatch_offers.c.payload,
                ).where(dispatch_offers.c.id == str(offer_id)),
                get_engine(),
            )
        ).mappings().first()
        if offer_row is None or str(offer_row["provider_id"]) != str(provider_id):
            raise SqlDispatchConflict("OFFER_NOT_FOUND", "Offer was not found.")
        if str(offer_row["status"]) != "pending":
            raise SqlDispatchConflict(str(offer_row["status"]), f"Offer status is {offer_row['status']}.")

        offer_payload = _json_safe_copy(offer_row["payload"] if isinstance(offer_row["payload"], dict) else {})
        offer_payload["status"] = "declined"
        offer_payload["respondedAt"] = now_iso
        connection.execute(
            update(dispatch_offers)
            .where(dispatch_offers.c.id == str(offer_id))
            .values(status="declined", responded_at=now_iso, payload=offer_payload)
        )

        if order_row is not None and isinstance(order_row[0], dict):
            order_payload = _json_safe_copy(order_row[0])
            _append_event(
                order_payload,
                "OFFER_DECLINED",
                now_iso,
                {"offerId": offer_id, "providerId": provider_id},
            )
            _persist_order(connection, order_payload)

    return offer_payload

def sql_map_providers(
    *,
    bbox: tuple[float, float, float, float] | None = None,
    kind: str | None = None,
    status_keys: set[str] | None = None,
    verification_status: str | None = None,
    service: str | None = None,
    limit: int = 500,
) -> list[dict[str, Any]]:
    """Filtered provider rows for the public map — SQL/PostGIS where possible."""
    capped = max(1, min(int(limit or 500), 2000))
    engine = get_engine()
    with engine.begin() as connection:
        query = (
            select(
                providers.c.id,
                providers.c.name,
                providers.c.rating,
                providers.c.capabilities,
                providers.c.verification_status,
                providers.c.service_radius_km,
                providers.c.payload.label("provider_payload"),
                provider_presence.c.status,
                provider_presence.c.lat,
                provider_presence.c.lng,
                provider_presence.c.eta_minutes,
                provider_presence.c.payload.label("presence_payload"),
            )
            .select_from(providers.outerjoin(provider_presence, providers.c.id == provider_presence.c.provider_id))
        )
        if kind:
            query = query.where(providers.c.provider_kind == str(kind).strip().lower())
        if service:
            query = query.where(providers.c.capabilities.like(f"%|{str(service).strip().lower()}|%"))
        if status_keys:
            query = query.where(provider_presence.c.status.in_(sorted(status_keys)))
        if verification_status:
            query = query.where(providers.c.verification_status == verification_status)
        if bbox is not None:
            min_lng, min_lat, max_lng, max_lat = bbox
            if engine.dialect.name == "postgresql":
                query = query.where(text("""
                    ST_Intersects(
                        ST_SetSRID(ST_MakePoint(provider_presence.lng, provider_presence.lat), 4326),
                        ST_MakeEnvelope(:map_min_lng, :map_min_lat, :map_max_lng, :map_max_lat, 4326)
                    )
                """)).params(
                    map_min_lng=min_lng,
                    map_min_lat=min_lat,
                    map_max_lng=max_lng,
                    map_max_lat=max_lat,
                )
            else:
                query = query.where(
                    provider_presence.c.lat.is_not(None),
                    provider_presence.c.lng.is_not(None),
                    provider_presence.c.lat >= min_lat,
                    provider_presence.c.lat <= max_lat,
                    provider_presence.c.lng >= min_lng,
                    provider_presence.c.lng <= max_lng,
                )
        query = query.order_by(providers.c.id).limit(capped)
        rows = connection.execute(query).mappings().all()

    results: list[dict[str, Any]] = []
    for row in rows:
        merged = _merge_provider_payload(row["provider_payload"], row["presence_payload"])
        if row["lat"] is not None and row["lng"] is not None:
            merged["location"] = {"lat": float(row["lat"]), "lng": float(row["lng"])}
        if row["status"]:
            merged["status"] = row["status"]
        if row["eta_minutes"] is not None:
            merged["etaMinutes"] = row["eta_minutes"]
        if row["rating"] is not None:
            merged["rating"] = row["rating"]
        if row["verification_status"]:
            merged["verificationStatus"] = row["verification_status"]
        if row["service_radius_km"] is not None:
            merged["serviceRadiusKm"] = row["service_radius_km"]
        results.append(merged)
        if len(results) >= capped:
            break
    return results

def sql_customers_by_phone_lookup(lookup: str) -> list[dict[str, Any]]:
    key = str(lookup or "").strip()
    if not key:
        return []
    engine = get_engine()
    with engine.begin() as connection:
        rows = connection.execute(
            select(customers.c.payload).where(customers.c.phone_lookup == key)
        ).all()
    return [_json_safe_copy(row[0]) for row in rows]

def sql_providers_by_phone_lookup(lookup: str) -> list[dict[str, Any]]:
    key = str(lookup or "").strip()
    if not key:
        return []
    engine = get_engine()
    with engine.begin() as connection:
        rows = connection.execute(
            select(
                providers.c.payload.label("provider_payload"),
                provider_presence.c.payload.label("presence_payload"),
            )
            .select_from(providers.outerjoin(provider_presence, providers.c.id == provider_presence.c.provider_id))
            .where(providers.c.phone_lookup == key)
        ).mappings().all()
    return [
        _merge_provider_payload(row["provider_payload"], row["presence_payload"])
        for row in rows
    ]

def sql_orders_for_provider(provider_id: str, *, limit: int = 50) -> list[dict[str, Any]]:
    wanted = str(provider_id or "").strip()
    if not wanted:
        return []
    capped = max(1, min(int(limit or 50), 200))
    engine = get_engine()
    with engine.begin() as connection:
        rows = connection.execute(
            select(orders.c.payload)
            .where(orders.c.assigned_provider_id == wanted)
            .order_by(orders.c.updated_at.desc())
            .limit(capped)
        ).all()
    return [_json_safe_copy(row[0]) for row in rows]

def sql_pending_offers_for_provider(provider_id: str) -> list[dict[str, Any]]:
    """Pending offers for a provider whose order is still searching and unassigned."""
    wanted = str(provider_id or "").strip()
    if not wanted:
        return []
    engine = get_engine()
    with engine.begin() as connection:
        rows = connection.execute(
            select(
                dispatch_offers.c.payload.label("offer_payload"),
                orders.c.payload.label("order_payload"),
            )
            .select_from(
                dispatch_offers.join(orders, dispatch_offers.c.order_id == orders.c.id)
            )
            .where(dispatch_offers.c.provider_id == wanted)
            .where(dispatch_offers.c.status == "pending")
            .where(orders.c.status == "searching")
            .where((orders.c.assigned_provider_id.is_(None)) | (orders.c.assigned_provider_id == ""))
            .order_by(dispatch_offers.c.created_at.desc())
        ).mappings().all()
    results: list[dict[str, Any]] = []
    for row in rows:
        offer = _json_safe_copy(row["offer_payload"] if isinstance(row["offer_payload"], dict) else {})
        order = _json_safe_copy(row["order_payload"] if isinstance(row["order_payload"], dict) else {})
        offer["order"] = order
        results.append(offer)
    return results

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

        order_update = _persist_order(connection, order, expected_status="searching")
        if not order_update:
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
    retained = {str(order["id"]) for order in order_payloads}
    for order in order_payloads:
        if not _persist_order(connection, order, expected_version=order.get("version")):
            raise SqlDispatchConflict("ORDER_VERSION_CONFLICT", "Order changed during collection save.")
    connection.execute(delete(order_events).where(order_events.c.order_id.not_in(retained)))
    connection.execute(delete(orders).where(orders.c.id.not_in(retained)))

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
        from bot.phone_lookup import phone_lookup_key_from_payload

        provider_values = {
            "id": provider_id,
            "name": str(payload.get("name") or "") or None,
            "phone": str(payload.get("phone") or "") or None,
            "phone_lookup": phone_lookup_key_from_payload(payload),
            "telegram": str(payload.get("telegram") or "") or None,
            "vehicle": str(payload.get("vehicle") or "") or None,
            "plate": str(payload.get("plate") or "") or None,
            "provider_kind": str(payload.get("providerKind") or "dispatch").strip().lower() or "dispatch",
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
    from bot.phone_lookup import phone_lookup_key_from_payload

    connection.execute(delete(provider_presence))
    connection.execute(delete(providers))
    for provider in provider_payloads:
        location_lat, location_lng = _point(provider.get("location"))
        connection.execute(
            insert(providers).values(
                id=str(provider.get("id")),
                name=str(provider.get("name") or "") or None,
                phone=str(provider.get("phone") or "") or None,
                phone_lookup=phone_lookup_key_from_payload(provider),
                telegram=str(provider.get("telegram") or "") or None,
                vehicle=str(provider.get("vehicle") or "") or None,
                plate=str(provider.get("plate") or "") or None,
                provider_kind=str(provider.get("providerKind") or "dispatch").strip().lower() or "dispatch",
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
    from bot.phone_lookup import phone_lookup_key_from_payload

    connection.execute(delete(customers))
    for customer in customer_payloads:
        connection.execute(
            insert(customers).values(
                id=str(customer.get("id")),
                name=_customer_column_value(customer.get("name"), 180),
                phone=_customer_column_value(customer.get("phone"), 80),
                phone_lookup=phone_lookup_key_from_payload(customer),
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
