"""PostGIS candidate selection, independent of dispatch waves and transport."""
import os
from typing import Any
from sqlalchemy import text, bindparam
from bot import runtime_store as db

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
          AND LOWER(COALESCE(p.payload->>'accountStatus', 'active')) <> 'disabled'
          AND LOWER(COALESCE(p.verification_status, 'unverified')) <> 'rejected'
          AND p.capabilities LIKE :capability
          AND pp.status = 'online'
          AND pp.assigned_order_id IS NULL
          AND pp.last_seen_at >= :threshold_iso
          AND pp.last_location_at >= :threshold_iso
          {exclusion}
          AND ST_DWithin(
              ST_SetSRID(ST_MakePoint(pp.lng, pp.lat), 4326)::geography,
              ST_SetSRID(ST_MakePoint(o.customer_lng, o.customer_lat), 4326)::geography,
              :max_radius_km * 1000
          )
          AND ST_DWithin(
              ST_SetSRID(ST_MakePoint(pp.lng, pp.lat), 4326)::geography,
              ST_SetSRID(ST_MakePoint(o.customer_lng, o.customer_lat), 4326)::geography,
              LEAST(COALESCE(p.service_radius_km, 15), :max_radius_km) * 1000
          )
        ORDER BY distance_km ASC, p.id ASC
        LIMIT :candidate_limit
    """)
    if offered_ids:
        query = query.bindparams(bindparam("offered_ids", expanding=True))

    params = {
        "order_id": str(order_id),
        "capability": f"%|{service}|%",
        "threshold_iso": threshold_iso,
        "max_radius_km": max_radius_km,
        "candidate_limit": max(8, min(100, int(os.getenv("POMICH_MATCH_CANDIDATE_LIMIT", "32")))),
    }
    if offered_ids:
        params["offered_ids"] = sorted(offered_ids)

    with db.get_engine().begin() as connection:
        rows = connection.execute(query, params).mappings().all()

    return [
        db._merge_provider_payload(row["provider_payload"], row["presence_payload"], float(row["distance_km"]))
        for row in rows
    ]

