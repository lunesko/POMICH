"""Tests for settlement registry and city-based provider filtering."""

from __future__ import annotations

from bot.settlements import (
    filter_providers_by_city,
    filter_providers_near,
    load_settlements,
    settlement_by_id,
    settlement_by_name,
)


def test_load_settlements_includes_regional_cities() -> None:
    settlements = load_settlements()
    assert len(settlements) >= 20
    assert settlement_by_id("uzhhorod") is not None
    assert settlement_by_name("Львів") is not None


def test_filter_providers_by_city_matches_name_and_bbox() -> None:
    providers = [
        {"id": "1", "city": "Львів", "location": {"lat": 49.84, "lng": 24.03}},
        {"id": "2", "city": "Київ", "location": {"lat": 50.45, "lng": 30.52}},
        {"id": "3", "city": "", "location": {"lat": 49.83, "lng": 24.02}},
    ]
    filtered = filter_providers_by_city(providers, "Львів")
    ids = {item["id"] for item in filtered}
    assert "1" in ids
    assert "3" in ids
    assert "2" not in ids


def test_filter_providers_near_radius() -> None:
    providers = [
        {"id": "near", "location": {"lat": 48.62, "lng": 22.29}},
        {"id": "far", "location": {"lat": 50.45, "lng": 30.52}},
    ]
    filtered = filter_providers_near(providers, 48.6208, 22.2879, radius_km=5)
    assert [item["id"] for item in filtered] == ["near"]


def test_nearest_settlement_prefers_closest_center() -> None:
    from bot.settlements import nearest_settlement, nearest_settlement_with_distance

    item = nearest_settlement(48.62, 22.29)
    assert item is not None
    assert item.get("id") == "uzhhorod"

    item2, km = nearest_settlement_with_distance(48.6208, 22.2879, max_km=80)
    assert item2 is not None
    assert item2.get("id") == "uzhhorod"
    assert km is not None and km < 5
