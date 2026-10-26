from typing import Any, Optional

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


class InvalidStatusTransition(ValueError):
    def __init__(self, current_status: str, next_status: str) -> None:
        self.current_status = current_status
        self.next_status = next_status
        super().__init__(f"invalid order status transition: {current_status} -> {next_status}")


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

