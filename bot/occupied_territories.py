"""Occupied territory checks per de-facto UA government control lines (2022+).

Used to block orders/geocoding and hide directory POIs in temporarily occupied areas.
See docs/OCCUPIED_TERRITORIES.md for the zone list and rationale.

Zones are simplified axis-aligned bounding boxes — conservative enough for product
guardrails; refine polygons when higher precision is needed.
"""

from __future__ import annotations

from typing import Any

# Each zone: (south, west, north, east) in WGS84 degrees.
OCCUPIED_BBOXES: tuple[tuple[str, tuple[float, float, float, float]], ...] = (
    ("crimea", (44.30, 32.50, 46.20, 36.80)),
    ("donetsk-occupied", (47.00, 37.50, 49.80, 40.20)),
    ("luhansk-occupied", (48.00, 38.80, 50.10, 40.50)),
    ("zaporizhzhia-occupied-south", (46.00, 34.80, 47.40, 36.80)),
    ("kherson-occupied-east-bank", (46.00, 32.50, 47.15, 35.00)),
)


def _in_bbox(lat: float, lng: float, bbox: tuple[float, float, float, float]) -> bool:
    south, west, north, east = bbox
    return south <= lat <= north and west <= lng <= east


def is_occupied_coordinates(lat: float | None, lng: float | None) -> bool:
    """True when point lies inside any occupied zone."""
    if lat is None or lng is None:
        return False
    try:
        lat_f = float(lat)
        lng_f = float(lng)
    except (TypeError, ValueError):
        return False
    if not (-90 <= lat_f <= 90 and -180 <= lng_f <= 180):
        return False
    return any(_in_bbox(lat_f, lng_f, bbox) for _, bbox in OCCUPIED_BBOXES)


def occupied_zone_name(lat: float | None, lng: float | None) -> str | None:
    if lat is None or lng is None:
        return None
    try:
        lat_f = float(lat)
        lng_f = float(lng)
    except (TypeError, ValueError):
        return None
    for name, bbox in OCCUPIED_BBOXES:
        if _in_bbox(lat_f, lng_f, bbox):
            return name
    return None


def filter_non_occupied_providers(providers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Drop directory/dispatch providers whose map pin is in occupied territory."""
    kept: list[dict[str, Any]] = []
    for provider in providers:
        location = provider.get("location") if isinstance(provider.get("location"), dict) else {}
        lat = location.get("lat")
        lng = location.get("lng")
        if is_occupied_coordinates(lat, lng):
            continue
        kept.append(provider)
    return kept
