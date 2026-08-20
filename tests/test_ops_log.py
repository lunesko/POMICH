from bot.ops_log import build_admin_ops_log, classify_ops_severity, record_ops_event


def test_classify_ops_severity_for_known_stages() -> None:
    assert classify_ops_severity("NO_PROVIDERS_AVAILABLE") == "error"
    assert classify_ops_severity("STATUS_UPDATE_FAILED") == "error"
    assert classify_ops_severity("OFFER_EXPIRED") == "warn"
    assert classify_ops_severity("ORDER_CREATED") == "info"


def test_record_and_build_admin_ops_log_includes_api_and_order_events(tmp_path, monkeypatch) -> None:
    from bot import order_store

    order_path = tmp_path / "orders.json"
    monkeypatch.setenv("POMICH_ORDER_STORE_PATH", str(order_path))
    monkeypatch.setattr(order_store, "_default_store_path", lambda: order_path)

    order = order_store.save_order(
        {
            "service": "tow",
            "status": "searching",
            "customerLocation": "Test",
            "customerCoordinates": {"lat": 48.62, "lng": 22.28},
        },
        store_path=order_path,
    )
    order_store._append_order_event(order, "NO_PROVIDERS_AVAILABLE", extra={"message": "Немає партнерів поруч"})
    order_store._write_json_atomic(order_path, [order])

    record_ops_event(
        event_type="STATUS_UPDATE_FAILED",
        message="invalid order status transition: en_route -> completed",
        order_id=order["id"],
        provider_id="p1",
        code="invalid_transition",
        source="test",
    )

    payload = build_admin_ops_log(limit=50, order_store_path=order_path)
    assert payload["counts"]["total"] >= 2
    types = {event["type"] for event in payload["events"]}
    assert "STATUS_UPDATE_FAILED" in types
    assert "NO_PROVIDERS_AVAILABLE" in types

    errors_only = build_admin_ops_log(limit=50, severity="error", order_store_path=order_path)
    assert errors_only["events"]
    assert all(event["severity"] == "error" for event in errors_only["events"])
