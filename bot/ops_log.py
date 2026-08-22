"""Admin-facing ops log: stage trail + error breadcrumbs for POMICH support."""

from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from bot.order_store import STORE_LOCK, _now_iso, load_orders, normalize_order_status
from bot.runtime_store import load_collection, save_collection, sql_get_order, sql_storage_enabled

OPS_LOG_COLLECTION = "ops_log"
OPS_LOG_MAX = 400
_MEMORY_OPS_LOG: List[Dict[str, Any]] = []

# Events that usually mean ops attention is needed.
ERROR_EVENT_TYPES = {
    "NO_PROVIDERS_AVAILABLE",
    "OFFERS_EXHAUSTED",
    "ORDER_ACCEPTED_TIMEOUT",
    "NOTIFY_FAILED",
    "GEO_REJECTED",
    "AUTH_DENIED",
    "CONFLICT",
    "STATUS_UPDATE_FAILED",
    "REVIEW_FAILED",
    "DISPATCH_FAILED",
    "API_ERROR",
}

WARN_EVENT_TYPES = {
    "OFFER_EXPIRED",
    "OFFER_DECLINED",
    "DISPATCH_AUTO_RETRY",
    "DISPATCH_RETRY",
    "ORDER_CANCELLED",
    "CANCELLED",
}

STAGE_EVENT_TYPES = {
    "ORDER_CREATED",
    "DISPATCH_STARTED",
    "OFFER_CREATED",
    "OFFER_ACCEPTED",
    "PROVIDER_ASSIGNED",
    "PRICE_CONFIRMED",
    "ORDER_EN_ROUTE",
    "ORDER_ARRIVED",
    "ORDER_IN_PROGRESS",
    "ORDER_COMPLETED",
    "REVIEW_SUBMITTED",
}


def classify_ops_severity(event_type: str) -> str:
    normalized = str(event_type or "").strip().upper()
    if normalized in ERROR_EVENT_TYPES or normalized.endswith("_FAILED") or "ERROR" in normalized:
        return "error"
    if normalized in WARN_EVENT_TYPES or normalized.endswith("_TIMEOUT") or "EXHAUST" in normalized:
        return "warn"
    if normalized in STAGE_EVENT_TYPES or normalized.startswith("ORDER_"):
        return "info"
    return "info"


def _event_message(event: Dict[str, Any]) -> str:
    for key in ("message", "error", "reason", "detail", "code"):
        value = event.get(key)
        if value is None or value == "":
            continue
        text = str(value).strip()
        if text:
            return text[:300]
    return ""


def _load_ops_ring() -> List[Dict[str, Any]]:
    if sql_storage_enabled():
        found, data = load_collection(OPS_LOG_COLLECTION)
        if found and isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]
        return []
    return list(_MEMORY_OPS_LOG)


def _save_ops_ring(events: List[Dict[str, Any]]) -> None:
    trimmed = events[:OPS_LOG_MAX]
    if sql_storage_enabled():
        save_collection(OPS_LOG_COLLECTION, trimmed)
        return
    global _MEMORY_OPS_LOG
    _MEMORY_OPS_LOG = list(trimmed)


def record_ops_event(
    *,
    event_type: str,
    message: str = "",
    order_id: str | None = None,
    provider_id: str | None = None,
    customer_id: str | None = None,
    code: str | None = None,
    source: str = "api",
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Append a durable ops breadcrumb (ring buffer in SQL runtime collections)."""
    payload: Dict[str, Any] = {
        "id": f"ops-{_now_iso()}-{uuid.uuid4().hex[:10]}-{str(event_type or 'EVENT')[:32]}",
        "type": str(event_type or "API_ERROR").strip().upper() or "API_ERROR",
        "at": _now_iso(),
        "severity": classify_ops_severity(event_type),
        "source": str(source or "api"),
        "message": str(message or "")[:300],
    }
    if order_id:
        payload["orderId"] = str(order_id)
    if provider_id:
        payload["providerId"] = str(provider_id)
    if customer_id:
        payload["customerId"] = str(customer_id)
    if code:
        payload["code"] = str(code)[:120]
    if extra:
        for key, value in extra.items():
            if key in payload or value is None:
                continue
            if isinstance(value, (str, int, float, bool)):
                payload[key] = value if not isinstance(value, str) else value[:200]

    with STORE_LOCK:
        events = _load_ops_ring()
        events.insert(0, payload)
        _save_ops_ring(events)
    return payload


def _order_events_as_ops_rows(order: Dict[str, Any]) -> List[Dict[str, Any]]:
    order_id = str(order.get("id") or "").strip()
    if not order_id:
        return []
    rows: List[Dict[str, Any]] = []
    status = normalize_order_status(order.get("status")) if order.get("status") else None
    service = order.get("service")
    assigned = order.get("assignedProviderId") or order.get("partnerId")
    customer_id = order.get("customerId")

    history = order.get("statusHistory")
    if isinstance(history, list):
        for index, entry in enumerate(history):
            if not isinstance(entry, dict):
                continue
            st = str(entry.get("status") or "").strip()
            if not st:
                continue
            rows.append(
                {
                    # Include index so identical status+at pairs are not silently dropped.
                    "id": f"{order_id}:status:{index}:{st}:{entry.get('at')}",
                    "type": f"STATUS_{st.upper()}",
                    "at": entry.get("at") or order.get("updatedAt") or order.get("createdAt"),
                    "severity": "warn" if st == "cancelled" else "info",
                    "source": "statusHistory",
                    "message": f"Статус → {st}",
                    "orderId": order_id,
                    "providerId": assigned,
                    "customerId": customer_id,
                    "orderStatus": status,
                    "service": service,
                }
            )

    events = order.get("dispatchEvents")
    if isinstance(events, list):
        for index, event in enumerate(events):
            if not isinstance(event, dict):
                continue
            event_type = str(event.get("type") or "EVENT").strip().upper() or "EVENT"
            message = _event_message(event) or event_type.replace("_", " ").title()
            rows.append(
                {
                    "id": f"{order_id}:dispatch:{index}:{event_type}:{event.get('at')}",
                    "type": event_type,
                    "at": event.get("at") or order.get("updatedAt") or order.get("createdAt"),
                    "severity": classify_ops_severity(event_type),
                    "source": "dispatchEvents",
                    "message": message,
                    "orderId": order_id,
                    "providerId": event.get("providerId") or assigned,
                    "offerId": event.get("offerId"),
                    "customerId": customer_id,
                    "orderStatus": status,
                    "service": service,
                    "code": event.get("code"),
                }
            )
    return rows


def _resolve_order_for_ops(order_id: str, orders: List[Dict[str, Any]], order_store_path=None) -> Dict[str, Any] | None:
    wanted = str(order_id or "").strip()
    if not wanted:
        return None
    found = next((item for item in orders if str(item.get("id") or "") == wanted), None)
    if found is not None:
        return found
    if sql_storage_enabled() and order_store_path is None:
        return sql_get_order(wanted)
    return None


def build_admin_ops_log(
    *,
    limit: int = 80,
    severity: str | None = None,
    order_id: str | None = None,
    provider_id: str | None = None,
    customer_id: str | None = None,
    order_store_path=None,
) -> Dict[str, Any]:
    """Merge order stage trails + API ops ring for the admin console."""
    wanted_severity = str(severity or "").strip().lower()
    if wanted_severity not in {"", "all", "error", "warn", "info"}:
        wanted_severity = "all"
    wanted_order = str(order_id or "").strip()
    wanted_provider = str(provider_id or "").strip()
    wanted_customer = str(customer_id or "").strip()
    try:
        raw_limit = 80 if limit is None else int(limit)
    except (TypeError, ValueError):
        raw_limit = 80
    safe_limit = max(1, min(raw_limit if raw_limit > 0 else 80, 200))

    rows: List[Dict[str, Any]] = []
    for event in _load_ops_ring():
        rows.append(
            {
                **event,
                "severity": event.get("severity") or classify_ops_severity(str(event.get("type") or "")),
                "source": event.get("source") or "ops_log",
            }
        )

    orders = load_orders(order_store_path)
    if wanted_order:
        # Always load the requested order by id — do not require it to be in the recent-80 window.
        target = _resolve_order_for_ops(wanted_order, orders, order_store_path)
        if target is not None:
            rows.extend(_order_events_as_ops_rows(target))
    else:
        # Prefer recently updated orders for stage extraction.
        recent = sorted(
            orders,
            key=lambda item: str(item.get("updatedAt") or item.get("createdAt") or ""),
            reverse=True,
        )[:80]
        for order in recent:
            rows.extend(_order_events_as_ops_rows(order))

    if wanted_order:
        rows = [row for row in rows if str(row.get("orderId") or "") == wanted_order]
    if wanted_provider:
        rows = [row for row in rows if str(row.get("providerId") or "") == wanted_provider]
    if wanted_customer:
        rows = [row for row in rows if str(row.get("customerId") or "") == wanted_customer]

    rows.sort(key=lambda item: str(item.get("at") or ""), reverse=True)

    # De-dupe identical ids while preserving order.
    seen: set[str] = set()
    unique: List[Dict[str, Any]] = []
    for row in rows:
        row_id = str(row.get("id") or "")
        if row_id and row_id in seen:
            continue
        if row_id:
            seen.add(row_id)
        unique.append(row)

    # Counts stay global for the order filter (not the severity chip), so admin
    # severity cards don't collapse to zeroes when viewing errors-only.
    counts = {
        "error": sum(1 for row in unique if row.get("severity") == "error"),
        "warn": sum(1 for row in unique if row.get("severity") == "warn"),
        "info": sum(1 for row in unique if row.get("severity") == "info"),
        "total": len(unique),
    }

    filtered = unique
    if wanted_severity in {"error", "warn", "info"}:
        filtered = [row for row in unique if str(row.get("severity") or "") == wanted_severity]

    trimmed = filtered[:safe_limit]
    return {"events": trimmed, "counts": counts, "limit": safe_limit}
