"""Order queries operations; no dependency on the compatibility facade."""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional


@dataclass(frozen=True)
class Dependencies:
    ACCEPTED_IDLE_TIMEOUT_SECONDS: Any
    STORE_LOCK: Any
    _customer_ids_for_order_history: Callable[..., Any]
    _customer_profile_phone_digits: Callable[..., Any]
    _default_store_path: Callable[..., Any]
    _normalize_ukraine_phone_digits: Callable[..., Any]
    _now_iso: Callable[..., Any]
    _order_accepted_at: Callable[..., Any]
    _order_belongs_to_customer: Callable[..., Any]
    _order_belongs_to_provider: Callable[..., Any]
    _should_use_sql_store: Callable[..., Any]
    _valid_point: Any
    _write_json_atomic: Callable[..., Any]
    enrich_order_for_client: Callable[..., Any]
    get_customer_profile: Callable[..., Any]
    get_order: Callable[..., Any]
    get_provider_profile: Callable[..., Any]
    haversine_distance_km: Any
    is_customer_client_registered: Callable[..., Any]
    is_map_request_order: Any
    list_provider_public_reviews: Callable[..., Any]
    load_customer_profiles: Callable[..., Any]
    load_offers: Callable[..., Any]
    load_orders: Callable[..., Any]
    load_providers: Callable[..., Any]
    normalize_order_status: Any
    normalize_service: Any
    normalize_verification_status: Callable[..., Any]
    partner_provider_ids_for_order: Callable[..., Any]
    peek_order_status: Any
    resolve_linked_provider_id: Callable[..., Any]
    resolve_provider_telegram_user_id: Callable[..., Any]
    sql_get_order: Any
    sql_orders_for_provider: Any
    sql_upsert_order: Any


def resolve_provider_telegram_user_id(deps: Dependencies, provider_id: str, provider_store_path: Optional[Path] = None, customer_store_path: Optional[Path] = None) -> Optional[str]:
    normalized_provider_id = str(provider_id or "").strip()
    if not normalized_provider_id:
        return None

    if normalized_provider_id.startswith("provider-tg-"):
        return normalized_provider_id[len("provider-tg-"):]
    if normalized_provider_id.startswith("provider-"):
        suffix = normalized_provider_id[len("provider-"):]
        if suffix.startswith("tg-"):
            return suffix[3:]
        if suffix.isdigit():
            return suffix

    provider = deps.get_provider_profile(normalized_provider_id, provider_store_path)
    if provider:
        direct_id = str(provider.get("telegramUserId") or provider.get("telegramChatId") or "").strip()
        if direct_id.isdigit():
            return direct_id

    for profile in deps.load_customer_profiles(customer_store_path):
        if str(profile.get("linkedProviderId") or "").strip() != normalized_provider_id:
            continue
        customer_id = str(profile.get("id") or "").strip()
        if customer_id.startswith("tg-"):
            return customer_id[3:]
        verification = profile.get("verification") if isinstance(profile.get("verification"), dict) else {}
        telegram_user_id = str(verification.get("telegramUserId") or "").strip()
        if telegram_user_id:
            return telegram_user_id
    return None


def partner_provider_ids_for_order(deps: Dependencies,
    order_id: str,
    order: Optional[Dict[str, Any]] = None,
    offer_store_path: Optional[Path] = None,
) -> List[str]:
    payload = order if isinstance(order, dict) else deps.get_order(order_id)
    provider_ids: set[str] = set()
    if payload:
        assigned_provider_id = str(payload.get("assignedProviderId") or payload.get("partnerId") or "").strip()
        if assigned_provider_id:
            provider_ids.add(assigned_provider_id)

    for offer in deps.load_offers(offer_store_path):
        if str(offer.get("orderId")) != str(order_id):
            continue
        if offer.get("status") not in {"pending", "accepted"}:
            continue
        provider_id = str(offer.get("providerId") or "").strip()
        if provider_id:
            provider_ids.add(provider_id)
    return sorted(provider_ids)


def partner_telegram_user_ids_for_order(deps: Dependencies,
    order_id: str,
    order: Optional[Dict[str, Any]] = None,
    provider_store_path: Optional[Path] = None,
    customer_store_path: Optional[Path] = None,
    offer_store_path: Optional[Path] = None,
) -> List[str]:
    telegram_ids: List[str] = []
    seen: set[str] = set()
    for provider_id in deps.partner_provider_ids_for_order(order_id, order, offer_store_path):
        telegram_user_id = deps.resolve_provider_telegram_user_id(provider_id, provider_store_path, customer_store_path)
        if not telegram_user_id or telegram_user_id in seen:
            continue
        seen.add(telegram_user_id)
        telegram_ids.append(telegram_user_id)
    return telegram_ids


def enrich_order_for_client(deps: Dependencies,
    order: Dict[str, Any],
    provider_store_path: Optional[Path] = None,
    customer_store_path: Optional[Path] = None,
) -> Dict[str, Any]:
    payload = dict(order)
    try:
        payload["status"] = deps.normalize_order_status(payload.get("status"))
    except ValueError:
        payload["status"] = "searching"

    provider_id = str(payload.get("assignedProviderId") or payload.get("partnerId") or "").strip()
    assigned_provider = dict(payload.get("assignedProvider")) if isinstance(payload.get("assignedProvider"), dict) else {}
    terminal_status = str(payload.get("status") or "").strip() in {"completed", "cancelled"}

    if provider_id:
        provider = deps.get_provider_profile(provider_id, provider_store_path)
        if provider:
            stored_location = deps._valid_point(assigned_provider.get("location"))
            live_location = deps._valid_point(provider.get("location"))
            # History should keep the approach snapshot; live GPS is for active trips only.
            location = (stored_location or live_location) if terminal_status else (live_location or stored_location)
            pickup = deps._valid_point(payload.get("customerCoordinates"))
            distance_km = assigned_provider.get("distanceKm")
            eta_minutes = assigned_provider.get("etaMinutes") or provider.get("etaMinutes")
            if location and pickup and not terminal_status:
                distance_km = round(deps.haversine_distance_km(location, pickup), 2)
                eta_minutes = max(1, math.ceil(float(distance_km) * 4))
            assigned_provider = {
                "id": provider.get("id") or assigned_provider.get("id"),
                "name": provider.get("name") or assigned_provider.get("name"),
                "rating": provider.get("rating") if provider.get("rating") is not None else assigned_provider.get("rating"),
                "vehicle": provider.get("vehicle") or assigned_provider.get("vehicle"),
                "plate": provider.get("plate") or assigned_provider.get("plate"),
                "phone": provider.get("phone") or assigned_provider.get("phone"),
                "telegram": provider.get("telegram") or assigned_provider.get("telegram"),
                "location": location,
                "verificationStatus": provider.get("verificationStatus") or assigned_provider.get("verificationStatus"),
                "trustedBadges": provider.get("trustedBadges") or assigned_provider.get("trustedBadges"),
                "distanceKm": distance_km,
                "etaMinutes": eta_minutes,
            }

    if assigned_provider:
        payload["assignedProvider"] = assigned_provider
        if assigned_provider.get("name"):
            payload["providerName"] = assigned_provider.get("name")
        if assigned_provider.get("etaMinutes") is not None:
            payload["etaMinutes"] = assigned_provider.get("etaMinutes")

    if payload.get("partnerProposedPrice") is None and payload.get("proposedPrice") is not None:
        payload["partnerProposedPrice"] = payload.get("proposedPrice")

    if payload.get("status") == "accepted":
        payload["acceptedIdleTimeoutSeconds"] = deps.ACCEPTED_IDLE_TIMEOUT_SECONDS
        accepted_at = deps._order_accepted_at(payload)
        if accepted_at is not None:
            expires_at = accepted_at + timedelta(seconds=deps.ACCEPTED_IDLE_TIMEOUT_SECONDS)
            payload["acceptedIdleExpiresAt"] = f"{expires_at.isoformat(timespec='seconds')}Z"

    customer_id = str(payload.get("customerId") or "").strip()
    if customer_id and not str(payload.get("customerName") or "").strip():
        try:
            customer = deps.get_customer_profile(customer_id, customer_store_path)
            name = str(customer.get("name") or customer.get("displayName") or "").strip()
            if name:
                payload["customerName"] = name
        except Exception:
            pass

    return payload


def get_order(deps: Dependencies, order_id: str, store_path: Optional[Path] = None, provider_store_path: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    if deps._should_use_sql_store(store_path, deps._default_store_path):
        found = deps.sql_get_order(str(order_id))
        if found is None:
            return None
        return deps.enrich_order_for_client(found, provider_store_path)
    for order in deps.load_orders(store_path):
        if str(order.get("id")) == str(order_id):
            return deps.enrich_order_for_client(order, provider_store_path)
    return None


def nearby_searching_orders(deps: Dependencies,
    lat: float,
    lng: float,
    *,
    radius_km: float = 20.0,
    service: Optional[str] = None,
    order_store_path: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    pickup = deps._valid_point({"lat": lat, "lng": lng})
    if pickup is None:
        return []
    normalized_service = deps.normalize_service(service) if service else None
    results: List[Dict[str, Any]] = []
    for order in deps.load_orders(order_store_path):
        if not deps.is_map_request_order(order):
            continue
        order_service = deps.normalize_service(order.get("service"))
        if normalized_service and order_service != normalized_service:
            continue
        order_point = deps._valid_point(order.get("customerCoordinates"))
        if order_point is None:
            continue
        distance = deps.haversine_distance_km(pickup, order_point)
        if distance > radius_km:
            continue
        payload = {
            "id": order.get("id"),
            "service": order_service,
            "status": deps.peek_order_status(order.get("status")) or "searching",
            "customerLocation": order.get("customerLocation"),
            "vehicleState": order.get("vehicleState"),
            "serviceDetails": order.get("serviceDetails"),
            "customerComment": order.get("customerComment"),
            "customerCoordinates": order_point,
            "distanceKm": round(distance, 2),
            "createdAt": order.get("createdAt"),
            "etaMinutes": max(2, math.ceil(distance * 4)),
        }
        results.append(payload)
    return sorted(results, key=lambda item: item.get("distanceKm") or 0)


def build_admin_stats(deps: Dependencies,
    order_store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
    customer_store_path: Optional[Path] = None,
) -> Dict[str, Any]:
    customers = deps.load_customer_profiles(customer_store_path)
    providers = deps.load_providers(provider_store_path)
    orders = deps.load_orders(order_store_path)
    terminal = {"completed", "cancelled"}
    active_orders = [order for order in orders if deps.normalize_order_status(order.get("status")) not in terminal]
    completed_orders = [order for order in orders if deps.normalize_order_status(order.get("status")) == "completed"]
    dispatch_providers = [provider for provider in providers if str(provider.get("providerKind") or "dispatch").lower() != "directory"]
    directory_providers = [provider for provider in providers if str(provider.get("providerKind") or "").lower() == "directory"]
    return {
        "totals": {
            "clients": len(customers),
            "providers": len(providers),
            "dispatchProviders": len(dispatch_providers),
            "directoryProviders": len(directory_providers),
            "orders": len(orders),
            "activeOrders": len(active_orders),
            "completedOrders": len(completed_orders),
        },
        "providers": {
            "online": sum(1 for provider in providers if provider.get("status") == "online"),
            "busy": sum(1 for provider in providers if provider.get("status") == "busy"),
            "offline": sum(1 for provider in providers if provider.get("status") == "offline"),
            "verified": sum(1 for provider in providers if deps.normalize_verification_status(provider.get("verificationStatus"), "") == "verified"),
            "pendingVerification": sum(1 for provider in providers if deps.normalize_verification_status(provider.get("verificationStatus"), "") == "pending"),
        },
        "clients": {
            "verified": sum(1 for customer in customers if deps.normalize_verification_status(customer.get("verificationStatus"), "") == "verified"),
            "registered": sum(1 for customer in customers if deps.is_customer_client_registered(customer)),
            "disabled": sum(1 for customer in customers if str(customer.get("accountStatus") or "active").lower() == "disabled"),
        },
        "orders": {
            "searching": sum(1 for order in orders if deps.normalize_order_status(order.get("status")) == "searching"),
            "assigned": sum(1 for order in orders if deps.normalize_order_status(order.get("status")) == "assigned"),
            "enRoute": sum(1 for order in orders if deps.normalize_order_status(order.get("status")) == "en_route"),
            "inProgress": sum(1 for order in orders if deps.normalize_order_status(order.get("status")) == "in_progress"),
        },
    }


def build_admin_activity_feed(deps: Dependencies, limit: int = 20, order_store_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    orders = deps.load_orders(order_store_path)
    feed: List[Dict[str, Any]] = []
    for order in sorted(orders, key=lambda item: str(item.get("updatedAt") or item.get("createdAt") or ""), reverse=True)[:limit]:
        feed.append(
            {
                "type": "order",
                "id": order.get("id"),
                "status": deps.normalize_order_status(order.get("status")),
                "service": order.get("service"),
                "source": order.get("source"),
                "customerLocation": order.get("customerLocation"),
                "assignedProviderId": order.get("assignedProviderId"),
                "at": order.get("updatedAt") or order.get("createdAt"),
            }
        )
    return feed


def _order_belongs_to_customer(deps: Dependencies, order: Dict[str, Any], customer_id: str) -> bool:
    needle = str(customer_id or "").strip()
    if not needle:
        return False
    if str(order.get("customerId") or "").strip() == needle:
        return True
    identity = order.get("customerIdentity") if isinstance(order.get("customerIdentity"), dict) else {}
    if str(identity.get("customerId") or "").strip() == needle:
        return True
    if needle.startswith("tg-"):
        telegram_user_id = needle[3:]
        if str(order.get("chatId") or "").strip() == telegram_user_id:
            return True
        if str(order.get("telegramUserId") or "").strip() == telegram_user_id:
            return True
        if str(identity.get("telegramUserId") or "").strip() == telegram_user_id:
            return True
    return False


def _order_belongs_to_provider(deps: Dependencies, order: Dict[str, Any], provider_id: str) -> bool:
    needle = str(provider_id or "").strip()
    if not needle:
        return False
    if str(order.get("assignedProviderId") or "").strip() == needle:
        return True
    if str(order.get("partnerId") or "").strip() == needle:
        return True
    assigned = order.get("assignedProvider") if isinstance(order.get("assignedProvider"), dict) else {}
    return str(assigned.get("id") or "").strip() == needle


def _customer_ids_for_order_history(deps: Dependencies,
    customer_id: str,
    customer_store_path: Optional[Path] = None,
) -> set[str]:
    """Include phone-linked guest/tg aliases so cabinet history is not empty after re-login."""
    needle = str(customer_id or "").strip()
    ids: set[str] = {needle} if needle else set()
    if not needle:
        return ids
    profile = deps.get_customer_profile(needle, customer_store_path) or {}
    phone_digits = deps._customer_profile_phone_digits(profile)
    if not phone_digits or len(phone_digits) != 12:
        # Partner→client soft-patch may leave tg-* without phone; use linked provider phone.
        provider_id = deps.resolve_linked_provider_id(needle, profile)
        if provider_id:
            provider = deps.get_provider_profile(provider_id)
            if provider:
                phone_digits = deps._normalize_ukraine_phone_digits(str(provider.get("phone") or ""))
    if not phone_digits or len(phone_digits) != 12:
        return ids
    for other in deps.load_customer_profiles(customer_store_path):
        other_id = str(other.get("id") or "").strip()
        if not other_id or other_id in ids:
            continue
        if deps._customer_profile_phone_digits(other) == phone_digits:
            ids.add(other_id)
    return ids


def rebind_customer_orders(deps: Dependencies,
    from_customer_ids: set[str] | list[str],
    to_customer_id: str,
    store_path: Optional[Path] = None,
) -> int:
    """Rewrite order customerId from legacy guest/alias rows onto the canonical account."""
    target = str(to_customer_id or "").strip()
    sources = {str(item).strip() for item in from_customer_ids if str(item or "").strip()}
    sources.discard(target)
    if not target or not sources:
        return 0

    rebound = 0
    with deps.STORE_LOCK:
        use_sql = deps._should_use_sql_store(store_path, deps._default_store_path)
        if use_sql:
            orders = deps.load_orders(store_path)
            for order in orders:
                current = str(order.get("customerId") or "").strip()
                if current not in sources:
                    continue
                order["customerId"] = target
                identity = order.get("customerIdentity") if isinstance(order.get("customerIdentity"), dict) else {}
                if identity:
                    identity = dict(identity)
                    identity["customerId"] = target
                    order["customerIdentity"] = identity
                order["updatedAt"] = deps._now_iso()
                deps.sql_upsert_order(order)
                rebound += 1
            return rebound

        path = store_path or deps._default_store_path()
        orders = deps.load_orders(path)
        changed = False
        for order in orders:
            current = str(order.get("customerId") or "").strip()
            if current not in sources:
                continue
            order["customerId"] = target
            identity = order.get("customerIdentity") if isinstance(order.get("customerIdentity"), dict) else {}
            if identity:
                identity = dict(identity)
                identity["customerId"] = target
                order["customerIdentity"] = identity
            order["updatedAt"] = deps._now_iso()
            rebound += 1
            changed = True
        if changed:
            deps._write_json_atomic(path, orders)
    return rebound


def list_orders_for_customer(deps: Dependencies,
    customer_id: str,
    store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
    customer_store_path: Optional[Path] = None,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    needles = deps._customer_ids_for_order_history(customer_id, customer_store_path)
    seen: set[str] = set()
    orders: List[Dict[str, Any]] = []
    for order in deps.load_orders(store_path):
        if not any(deps._order_belongs_to_customer(order, needle) for needle in needles):
            continue
        order_id = str(order.get("id") or "").strip()
        if order_id and order_id in seen:
            continue
        if order_id:
            seen.add(order_id)
        orders.append(deps.enrich_order_for_client(order, provider_store_path))
    orders.sort(key=lambda item: str(item.get("updatedAt") or item.get("createdAt") or ""), reverse=True)
    return orders[: max(1, min(int(limit or 50), 200))]


def list_orders_for_provider(deps: Dependencies,
    provider_id: str,
    store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    if deps._should_use_sql_store(store_path, deps._default_store_path):
        orders = [
            deps.enrich_order_for_client(order, provider_store_path)
            for order in deps.sql_orders_for_provider(str(provider_id), limit=limit)
        ]
        orders.sort(key=lambda item: str(item.get("updatedAt") or item.get("createdAt") or ""), reverse=True)
        return orders[: max(1, min(int(limit or 50), 200))]

    orders = [
        deps.enrich_order_for_client(order, provider_store_path)
        for order in deps.load_orders(store_path)
        if deps._order_belongs_to_provider(order, provider_id)
    ]
    orders.sort(key=lambda item: str(item.get("updatedAt") or item.get("createdAt") or ""), reverse=True)
    return orders[: max(1, min(int(limit or 50), 200))]


def list_provider_public_reviews(deps: Dependencies,
    provider_id: str,
    store_path: Optional[Path] = None,
    limit: int = 20,
) -> List[Dict[str, Any]]:
    """Customer reviews left for a provider after completed orders (public, sanitized)."""
    needle = str(provider_id or "").strip()
    if not needle:
        return []
    reviews: List[Dict[str, Any]] = []
    for order in deps.load_orders(store_path):
        if not deps._order_belongs_to_provider(order, needle):
            continue
        if deps.normalize_order_status(order.get("status")) != "completed":
            continue
        review = order.get("customerReview")
        if not isinstance(review, dict) or review.get("rating") is None:
            continue
        try:
            stars = int(review.get("rating"))
        except (TypeError, ValueError):
            continue
        if stars < 1 or stars > 5:
            continue
        reviews.append(
            {
                "rating": stars,
                "comment": str(review.get("comment") or "").strip()[:500],
                "at": review.get("at") or order.get("updatedAt") or order.get("createdAt"),
                "service": order.get("service"),
            }
        )
    reviews.sort(key=lambda item: str(item.get("at") or ""), reverse=True)
    return reviews[: max(1, min(int(limit or 20), 50))]


def get_provider_public_card(deps: Dependencies,
    provider_id: str,
    *,
    store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
    limit: int = 20,
) -> Optional[Dict[str, Any]]:
    """Public partner card for map clients: profile summary + reviews (no auth).

    Contacts and exact coordinates stay private until assignment — same privacy bar
    as ``/map/providers`` pins. Directory businesses may keep a public street address.
    """
    provider = deps.get_provider_profile(provider_id, provider_store_path)
    if provider is None:
        return None
    reviews = deps.list_provider_public_reviews(provider_id, store_path=store_path, limit=limit)
    provider_kind = provider.get("providerKind") or "dispatch"
    location = provider.get("location")
    approx_location = None
    if isinstance(location, dict):
        try:
            approx_location = {
                "lat": round(float(location.get("lat")), 3),
                "lng": round(float(location.get("lng")), 3),
            }
        except (TypeError, ValueError):
            approx_location = None
    card: Dict[str, Any] = {
        "id": provider.get("id"),
        "name": provider.get("name") or "Партнер POMICH",
        "rating": provider.get("rating"),
        "ratingCount": provider.get("ratingCount"),
        "vehicle": provider.get("vehicle"),
        "specialties": provider.get("specialties") or [],
        "status": provider.get("status"),
        "etaMinutes": provider.get("etaMinutes"),
        "providerKind": provider_kind,
        "city": provider.get("city"),
        "verificationStatus": provider.get("verificationStatus"),
        "openingHours": provider.get("openingHours"),
        "website": provider.get("website"),
        "ordersCompleted": provider.get("ordersCompleted"),
        "location": approx_location,
        "reviews": reviews,
    }
    if provider_kind == "directory" and provider.get("address") is not None:
        card["address"] = provider.get("address")
    return card
