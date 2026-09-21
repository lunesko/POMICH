"""Ukraine settlement registry for directory import and map filtering."""

from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path
from typing import Any

SETTLEMENTS_PATH = Path(__file__).resolve().parents[1] / "data" / "settlements.json"


@lru_cache(maxsize=1)
def load_settlements() -> list[dict[str, Any]]:
    if not SETTLEMENTS_PATH.exists():
        return []
    with SETTLEMENTS_PATH.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    items = payload.get("settlements") if isinstance(payload, dict) else payload
    if not isinstance(items, list):
        return []
    return [item for item in items if isinstance(item, dict) and item.get("id") and item.get("name")]


def settlement_by_id(settlement_id: str) -> dict[str, Any] | None:
    needle = str(settlement_id or "").strip().lower()
    for item in load_settlements():
        if str(item.get("id") or "").lower() == needle:
            return item
    return None


def settlement_by_name(name: str) -> dict[str, Any] | None:
    needle = str(name or "").strip().casefold()
    if not needle:
        return None
    for item in load_settlements():
        if str(item.get("name") or "").strip().casefold() == needle:
            return item
    return None


def settlement_center(item: dict[str, Any]) -> dict[str, float] | None:
    center = item.get("center")
    if isinstance(center, dict) and center.get("lat") is not None and center.get("lng") is not None:
        return {"lat": float(center["lat"]), "lng": float(center["lng"])}
    bbox = item.get("bbox")
    if isinstance(bbox, list) and len(bbox) == 4:
        south, west, north, east = (float(value) for value in bbox)
        return {"lat": (south + north) / 2, "lng": (west + east) / 2}
    return None


def settlement_bbox(item: dict[str, Any]) -> tuple[float, float, float, float] | None:
    bbox = item.get("bbox")
    if isinstance(bbox, list) and len(bbox) == 4:
        return tuple(float(value) for value in bbox)  # type: ignore[return-value]
    center = settlement_center(item)
    if center is None:
        return None
    # ~8 km default radius when bbox missing
    delta = 0.04
    return (
        center["lat"] - delta,
        center["lng"] - delta,
        center["lat"] + delta,
        center["lng"] + delta,
    )


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    a = math.sin(d_lat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(d_lng / 2) ** 2
    return radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# City queries must not pull neighboring towns (e.g. Чоп via oversized bbox).
# Exact city-name match always wins; geo fallback stays near the settlement center.
CITY_GEO_MATCH_RADIUS_KM = 12.0


def filter_providers_by_city(providers: list[dict[str, Any]], city: str) -> list[dict[str, Any]]:
    settlement = settlement_by_name(city)
    if settlement is None:
        needle = str(city or "").strip().casefold()
        return [item for item in providers if str(item.get("city") or "").strip().casefold() == needle]
    center = settlement_center(settlement)
    city_name = str(settlement.get("name") or "").strip().casefold()
    if center is None:
        return [item for item in providers if str(item.get("city") or "").strip().casefold() == city_name]
    filtered: list[dict[str, Any]] = []
    for provider in providers:
        provider_city = str(provider.get("city") or "").strip().casefold()
        if provider_city == city_name:
            filtered.append(provider)
            continue
        # Named other cities stay out — only blank/unknown city pins near the center.
        if provider_city and provider_city != city_name:
            continue
        location = provider.get("location") if isinstance(provider.get("location"), dict) else {}
        lat = location.get("lat")
        lng = location.get("lng")
        if lat is None or lng is None:
            continue
        if _haversine_km(float(lat), float(lng), center["lat"], center["lng"]) <= CITY_GEO_MATCH_RADIUS_KM:
            filtered.append(provider)
    return filtered


def nearest_settlement(lat: float, lng: float, *, max_km: float | None = None) -> dict[str, Any] | None:
    """Return the closest known settlement center to a WGS84 point."""
    best: dict[str, Any] | None = None
    best_km = float("inf")
    for item in load_settlements():
        center = settlement_center(item)
        if center is None:
            continue
        distance = _haversine_km(lat, lng, center["lat"], center["lng"])
        if distance < best_km:
            best_km = distance
            best = item
    if best is None:
        return None
    if max_km is not None and best_km > max_km:
        return None
    return best


def nearest_settlement_with_distance(lat: float, lng: float, *, max_km: float | None = None) -> tuple[dict[str, Any] | None, float | None]:
    """Return closest settlement and distance in km (None when beyond max_km)."""
    best: dict[str, Any] | None = None
    best_km = float("inf")
    for item in load_settlements():
        center = settlement_center(item)
        if center is None:
            continue
        distance = _haversine_km(lat, lng, center["lat"], center["lng"])
        if distance < best_km:
            best_km = distance
            best = item
    if best is None:
        return None, None
    if max_km is not None and best_km > max_km:
        return None, best_km
    return best, best_km


def filter_providers_near(providers: list[dict[str, Any]], lat: float, lng: float, radius_km: float) -> list[dict[str, Any]]:
    filtered: list[dict[str, Any]] = []
    for provider in providers:
        location = provider.get("location") if isinstance(provider.get("location"), dict) else {}
        plat = location.get("lat")
        plng = location.get("lng")
        if plat is None or plng is None:
            continue
        if _haversine_km(float(plat), float(plng), lat, lng) <= radius_km:
            filtered.append(provider)
    return filtered
