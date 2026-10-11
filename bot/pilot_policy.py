"""Small, explicit service boundary for the operator-free Uzhhorod pilot."""

from __future__ import annotations

import math
import os

PILOT_SERVICES = frozenset({"tow", "battery"})
UZHHOROD_LAT = 48.622
UZHHOROD_LNG = 22.300


def pilot_mode_enabled() -> bool:
    value = os.getenv("POMICH_PILOT_MODE")
    if value is None:
        return os.getenv("POMICH_RUNTIME", "").strip().lower() == "production"
    return value.strip().lower() in {"1", "true", "yes", "on"}


def pilot_radius_km() -> float:
    try:
        radius = float(os.getenv("POMICH_PILOT_RADIUS_KM", "15"))
    except ValueError:
        return 15.0
    return min(50.0, max(1.0, radius)) if math.isfinite(radius) else 15.0


def pickup_in_pilot_area(lat: float, lng: float) -> bool:
    if not math.isfinite(lat) or not math.isfinite(lng):
        return False
    lat1, lat2 = math.radians(UZHHOROD_LAT), math.radians(lat)
    delta_lat = lat2 - lat1
    delta_lng = math.radians(lng - UZHHOROD_LNG)
    a = math.sin(delta_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lng / 2) ** 2
    return 6371.0 * 2 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1 - a))) <= pilot_radius_km()
