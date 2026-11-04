"""Plan the actual production query on a disposable, realistic-sized PostGIS dataset."""
import json
from datetime import datetime, timezone
from pathlib import Path
import pytest
from sqlalchemy import event, text
from bot import runtime_store
from tests.test_audit_regressions import clients


def test_candidate_query_uses_spatial_index(clients):
    engine = runtime_store.get_engine()
    if engine.dialect.name != "postgresql":
        pytest.skip("EXPLAIN ANALYZE requires PostGIS CI service")
    now = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    with engine.begin() as connection:
        connection.execute(text("""
            INSERT INTO providers (id, verification_status, capabilities, service_radius_km, payload)
            SELECT 'plan-' || i, 'verified', '|tow|', 100,
                json_build_object('id', 'plan-' || i, 'verificationStatus', 'verified')
            FROM generate_series(1, 20000) AS s(i)
        """))
        connection.execute(text("""
            INSERT INTO provider_presence (provider_id, status, lat, lng, last_seen_at, last_location_at, payload)
            SELECT 'plan-' || i, 'online', 44 + (i % 800) / 100.0,
                22 + ((i * 37) % 1800) / 100.0, :now, :now,
                json_build_object('status', 'online')
            FROM generate_series(1, 20000) AS s(i)
        """), {"now": now})
        connection.exec_driver_sql("ANALYZE providers")
        connection.exec_driver_sql("ANALYZE provider_presence")
    runtime_store.sql_upsert_order({"id": "geo-plan", "status": "searching", "service": "tow",
        "customerCoordinates": {"lat": 48.62, "lng": 22.28}})
    captured = []
    def capture(connection, cursor, statement, parameters, context, executemany):
        if "FROM providers p" in statement and "ST_DWithin" in statement:
            captured.append((statement, parameters))
    event.listen(engine, "before_cursor_execute", capture)
    try:
        result = runtime_store.sql_candidate_providers_for_order("geo-plan", "tow", set(), 30, 60)
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert len(result) <= 32
    statement, parameters = captured[0]
    with engine.connect() as connection:
        plan = connection.exec_driver_sql("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + statement, parameters).scalar()
    target = Path("test-results/postgis-candidate-plan.json")
    target.parent.mkdir(exist_ok=True)
    target.write_text(json.dumps(plan, indent=2) + "\n")
    assert "idx_provider_presence_location_gist" in json.dumps(plan), plan
