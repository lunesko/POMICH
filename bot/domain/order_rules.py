import math
from typing import Any, Dict, Optional

ORDER_STATUS_ALIASES = {
    "created": "searching",
    "matching": "searching",
    "tracking": "en_route",
    "pending": "searching",
}


ORDER_STATUSES = {
    "draft",
    "searching",
    "accepted",
    "price_confirmed",
    "assigned",
    "en_route",
    "arrived",
    "in_progress",
    "completed",
    "cancelled",
}


ACTIVE_ORDER_STATUSES = {
    "searching",
    "accepted",
    "price_confirmed",
    "assigned",
    "en_route",
    "arrived",
    "in_progress",
}


TERMINAL_ORDER_STATUSES = {"completed", "cancelled"}


MAP_REQUEST_PIN_STATUSES = {"searching"}


ORDER_TRANSITIONS = {
    "draft": {"searching", "cancelled"},
    "searching": {"accepted", "cancelled"},
    "accepted": {"price_confirmed", "cancelled"},
    "price_confirmed": {"en_route", "cancelled"},
    "assigned": {"price_confirmed", "en_route", "cancelled"},
    "en_route": {"arrived", "cancelled"},
    "arrived": {"in_progress", "cancelled"},
    "in_progress": {"completed", "cancelled"},
    "completed": set(),
    "cancelled": set(),
}


def peek_order_status(status: Any) -> Optional[str]:
    """Map-safe status: missing/unknown is None, never silently becomes searching."""
    raw = str(status or "").strip().lower()
    if not raw:
        return None
    raw = ORDER_STATUS_ALIASES.get(raw, raw)
    if raw not in ORDER_STATUSES:
        return None
    return raw


def normalize_order_status(status: Any) -> str:
    normalized = str(status or "searching").strip().lower()
    normalized = ORDER_STATUS_ALIASES.get(normalized, normalized)
    if normalized not in ORDER_STATUSES:
        raise ValueError(f"unknown order status: {status}")
    return normalized


def is_map_request_order(order: Dict[str, Any]) -> bool:
    """Unassigned searching orders only — completed/cancelled never become map pins."""
    status = peek_order_status(order.get("status"))
    if status not in MAP_REQUEST_PIN_STATUSES:
        return False
    if order.get("assignedProviderId"):
        return False
    return True


def _normalize_proposed_price(value: Any) -> Optional[float]:
    if value is None or value == "":
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if parsed <= 0:
        return None
    return round(parsed, 2)


def normalize_service(value: Any) -> str:
    service = str(value or "").strip().lower()
    aliases = {
        "tow_truck": "tow",
        "towtruck": "tow",
        "battery_start": "battery",
        "wheel_help": "wheel",
        "fuel_delivery": "fuel",
        "mobile_mechanic": "mechanic",
    }
    return aliases.get(service, service)


def _valid_point(value: Any) -> Optional[Dict[str, float]]:
    if not isinstance(value, dict):
        return None
    try:
        lat = float(value.get("lat"))
        lng = float(value.get("lng"))
    except (TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return None
    return {"lat": lat, "lng": lng}


def haversine_distance_km(left: Dict[str, float], right: Dict[str, float]) -> float:
    earth_radius_km = 6371.0
    lat1 = math.radians(left["lat"])
    lat2 = math.radians(right["lat"])
    delta_lat = math.radians(right["lat"] - left["lat"])
    delta_lng = math.radians(right["lng"] - left["lng"])

    a = math.sin(delta_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lng / 2) ** 2
    return 2 * earth_radius_km * math.atan2(math.sqrt(a), math.sqrt(1 - a))
