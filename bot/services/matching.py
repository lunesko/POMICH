"""Matching operations; no dependency on the compatibility facade."""

from __future__ import annotations

import math
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional


@dataclass(frozen=True)
class Dependencies:
    DISPATCH_BLOCK_REOFFER_STATUSES: Any
    DISPATCH_SEARCH_RADIUS_STEPS_KM: Any
    DISPATCH_WAVE1_SIZE: Any
    DISPATCH_WAVE2_SIZE: Any
    DISPATCH_WAVE_WAIT_SECONDS: Any
    DispatchConflict: Any
    MAX_PROVIDER_OFFERS: Any
    OFFER_TIMEOUT_SECONDS: Any
    PROVIDER_PRESENCE_TTL_SECONDS: Any
    PROVIDER_SPECIALTIES: Any
    STORE_LOCK: Any
    _append_order_event: Callable[..., Any]
    _clean_provider_specialties: Callable[..., Any]
    _default_offer_store_path: Callable[..., Any]
    _default_provider_store_path: Callable[..., Any]
    _default_store_path: Callable[..., Any]
    _dispatch_order_sql: Callable[..., Any]
    _expire_offers_in_memory: Callable[..., Any]
    _now_iso: Callable[..., Any]
    _parse_iso: Callable[..., Any]
    _pending_offer_count_for_order: Callable[..., Any]
    _provider_is_recent: Callable[..., Any]
    _provider_should_skip_order: Callable[..., Any]
    _providers_blocked_for_order: Callable[..., Any]
    _public_offer_payload: Callable[..., Any]
    _should_use_sql_runtime: Callable[..., Any]
    _should_use_sql_store: Callable[..., Any]
    _try_offer_order_to_provider: Callable[..., Any]
    _valid_point: Any
    _write_json_atomic: Callable[..., Any]
    attach_dispatch_to_order: Callable[..., Any]
    eligible_providers_for_order: Callable[..., Any]
    enrich_order_for_client: Callable[..., Any]
    expire_stale_dispatch: Callable[..., Any]
    get_provider_profile: Callable[..., Any]
    haversine_distance_km: Any
    initial_radius_km_for_service: Any
    is_provider_verified: Callable[..., Any]
    load_offers: Callable[..., Any]
    load_orders: Callable[..., Any]
    load_providers: Callable[..., Any]
    normalize_order_status: Any
    normalize_service: Any
    peek_order_status: Any
    save_offers: Callable[..., Any]
    search_radius_steps_for_service: Any
    sql_candidate_providers_for_order: Any
    sql_commit_dispatch_wave: Any
    sql_expire_pending_offers: Any
    sql_get_order: Any
    sql_offers_for_order: Any
    sql_pending_offers_for_provider: Any
    sql_searching_orders_near_provider: Any
    sql_upsert_order: Any
    wave_batch_size: Any


def _pending_offer_count_for_order(deps: Dependencies, offers: List[Dict[str, Any]], order_id: str) -> int:
    return sum(
        1
        for offer in offers
        if str(offer.get("orderId")) == str(order_id) and offer.get("status") == "pending"
    )


def _try_offer_order_to_provider(deps: Dependencies,
    order: Dict[str, Any],
    provider: Dict[str, Any],
    offers: List[Dict[str, Any]],
    now: Optional[datetime] = None,
) -> bool:
    """Create a pending offer for one eligible provider. Returns True when a new offer is added."""
    order_id = str(order.get("id"))
    provider_id = str(provider.get("id"))
    if deps.peek_order_status(order.get("status")) != "searching":
        return False
    if order.get("assignedProviderId"):
        return False
    if deps._provider_should_skip_order(offers, provider_id, order_id):
        return False
    if deps._pending_offer_count_for_order(offers, order_id) >= deps.MAX_PROVIDER_OFFERS:
        return False

    service = deps.normalize_service(order.get("service"))
    specialties = deps._clean_provider_specialties(provider.get("specialties"))
    if service not in specialties:
        return False

    pickup = deps._valid_point(order.get("customerCoordinates"))
    location = deps._valid_point(provider.get("location"))
    if pickup is None or location is None:
        return False

    checked_at = now or datetime.now(timezone.utc).replace(tzinfo=None)
    if provider.get("status") != "online":
        return False
    if not deps.is_provider_verified(provider):
        return False
    if provider.get("assignedOrderId"):
        return False
    if provider.get("stale") or not deps._provider_is_recent(provider, checked_at):
        return False

    distance = deps.haversine_distance_km(pickup, location)
    radius_km = float(provider.get("serviceRadiusKm") or 15)
    if distance > radius_km:
        return False

    now_iso = f"{checked_at.isoformat(timespec='seconds')}Z"
    expires_at = f"{(checked_at + timedelta(seconds=deps.OFFER_TIMEOUT_SECONDS)).isoformat(timespec='seconds')}Z"
    offer = {
        "id": f"OF-{uuid.uuid4().hex[:12].upper()}",
        "orderId": order_id,
        "providerId": provider_id,
        "status": "pending",
        "distanceKm": round(distance, 2),
        "createdAt": now_iso,
        "expiresAt": expires_at,
    }
    offers.append(offer)
    deps._append_order_event(
        order,
        "OFFER_CREATED",
        now_iso,
        {"offerId": offer["id"], "providerId": provider_id, "distanceKm": offer["distanceKm"], "source": "redispatch"},
    )

    dispatch_info = order.get("dispatchInfo") if isinstance(order.get("dispatchInfo"), dict) else {}
    order["dispatchState"] = "OFFERS_SENT"
    order["dispatchInfo"] = {
        **dispatch_info,
        "eligibleProviders": max(int(dispatch_info.get("eligibleProviders") or 0), 1),
        "offersSent": deps._pending_offer_count_for_order(offers, order_id),
        "searchRadiusStepsKm": deps.DISPATCH_SEARCH_RADIUS_STEPS_KM,
        "maxProviderOffers": deps.MAX_PROVIDER_OFFERS,
        "offerTimeoutSeconds": deps.OFFER_TIMEOUT_SECONDS,
        "lastDispatchAt": now_iso,
    }
    order["updatedAt"] = now_iso
    return True


def redispatch_searching_orders_for_provider(deps: Dependencies,
    provider_id: str,
    order_store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
    offer_store_path: Optional[Path] = None,
) -> List[str]:
    """Offer nearby searching orders directly to a provider who is online. Returns order IDs with new offers."""
    provider = deps.get_provider_profile(provider_id, provider_store_path)
    if provider is None or provider.get("status") != "online":
        return []
    if not deps.is_provider_verified(provider):
        return []
    if not deps._valid_point(provider.get("location")):
        return []

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    with deps.STORE_LOCK:
        order_path = order_store_path or deps._default_store_path()
        offer_path = offer_store_path or deps._default_offer_store_path()
        if deps._should_use_sql_store(order_path, deps._default_store_path) and deps._should_use_sql_store(
            offer_path, deps._default_offer_store_path
        ):
            created_order_ids: List[str] = []
            location = deps._valid_point(provider.get("location"))
            if location is None:
                return []
            candidate_orders = deps.sql_searching_orders_near_provider(
                lat=location["lat"],
                lng=location["lng"],
                services=set(deps._clean_provider_specialties(provider.get("specialties"))),
                radius_km=float(provider.get("serviceRadiusKm") or 15),
            )
            for order in candidate_orders:
                order_id = str(order.get("id") or "")
                offers = deps.sql_offers_for_order(order_id)
                before_ids = {str(offer.get("id")) for offer in offers}
                if not deps._try_offer_order_to_provider(order, provider, offers, now):
                    continue
                proposed = [offer for offer in offers if str(offer.get("id")) not in before_ids]
                persisted_order, persisted_offers = deps.sql_commit_dispatch_wave(order, proposed)
                persisted_ids = {str(offer.get("id")) for offer in persisted_offers}
                if any(str(offer.get("id")) in persisted_ids for offer in proposed):
                    created_order_ids.append(str(persisted_order.get("id") or order_id))
            return created_order_ids

        orders = deps.load_orders(order_path)
        offers = deps.load_offers(offer_path)
        deps._expire_offers_in_memory(offers, orders, now)

        created_order_ids: List[str] = []
        for order in orders:
            if deps.peek_order_status(order.get("status")) != "searching":
                continue
            if deps._try_offer_order_to_provider(order, provider, offers, now):
                created_order_ids.append(str(order.get("id")))

        if created_order_ids:
            deps._write_json_atomic(order_path, orders)
            deps.save_offers(offers, offer_path)

        return created_order_ids


def _offer_error_for_status(deps: Dependencies, status: str) -> DispatchConflict:
    if status == "expired":
        return deps.DispatchConflict("OFFER_EXPIRED", "Offer has expired.")
    if status == "declined":
        return deps.DispatchConflict("OFFER_DECLINED", "Offer has already been declined.")
    return deps.DispatchConflict("ORDER_ALREADY_ACCEPTED", "Order has already been accepted by another provider.")


def _providers_blocked_for_order(deps: Dependencies, offers: List[Dict[str, Any]], order_id: str) -> set[str]:
    return {
        str(offer.get("providerId"))
        for offer in offers
        if str(offer.get("orderId")) == str(order_id) and offer.get("status") in deps.DISPATCH_BLOCK_REOFFER_STATUSES
    }


def _provider_should_skip_order(deps: Dependencies, offers: List[Dict[str, Any]], provider_id: str, order_id: str) -> bool:
    for offer in offers:
        if str(offer.get("orderId")) != str(order_id):
            continue
        if str(offer.get("providerId")) != str(provider_id):
            continue
        status = offer.get("status")
        if status in {"pending", "declined", "lost", "accepted", "cancelled"}:
            return True
    return False


def _provider_is_recent(deps: Dependencies, provider: Dict[str, Any], now: Optional[datetime] = None) -> bool:
    checked_at = now or datetime.now(timezone.utc).replace(tzinfo=None)
    last_seen = deps._parse_iso(provider.get("lastSeenAt") or provider.get("updatedAt"))
    last_location_at = deps._parse_iso(provider.get("lastLocationAt") or provider.get("lastSeenAt") or provider.get("updatedAt"))
    if not last_seen or checked_at - last_seen > timedelta(seconds=deps.PROVIDER_PRESENCE_TTL_SECONDS):
        return False
    if not last_location_at or checked_at - last_location_at > timedelta(seconds=deps.PROVIDER_PRESENCE_TTL_SECONDS):
        return False
    return True


def eligible_providers_for_order(deps: Dependencies,
    order: Dict[str, Any],
    providers: Optional[List[Dict[str, Any]]] = None,
    already_offered_provider_ids: Optional[set[str]] = None,
    now: Optional[datetime] = None,
) -> List[Dict[str, Any]]:
    service = deps.normalize_service(order.get("service"))
    pickup = deps._valid_point(order.get("customerCoordinates"))
    if service not in deps.PROVIDER_SPECIALTIES or pickup is None:
        return []

    offered_ids = already_offered_provider_ids or set()
    checked_at = now or datetime.now(timezone.utc).replace(tzinfo=None)
    candidates: List[Dict[str, Any]] = []

    for provider in providers if providers is not None else deps.load_providers():
        provider_id = str(provider.get("id"))
        location = deps._valid_point(provider.get("location"))
        specialties = deps._clean_provider_specialties(provider.get("specialties"))
        if provider_id in offered_ids:
            continue
        if provider.get("status") != "online":
            continue
        if not deps.is_provider_verified(provider):
            continue
        if provider.get("stale") or not deps._provider_is_recent(provider, checked_at):
            continue
        if provider.get("assignedOrderId"):
            continue
        if service not in specialties:
            continue
        if location is None:
            continue

        distance = deps.haversine_distance_km(pickup, location)
        provider_radius = float(provider.get("serviceRadiusKm") or 15)
        if distance > provider_radius:
            continue

        candidate = dict(provider)
        candidate["distanceKm"] = round(distance, 2)
        candidates.append(candidate)

    return sorted(candidates, key=lambda provider: provider["distanceKm"])


def _public_offer_payload(deps: Dependencies, offer: Dict[str, Any], order: Dict[str, Any]) -> Dict[str, Any]:
    customer_coordinates = order.get("customerCoordinates")
    if not isinstance(customer_coordinates, dict):
        customer_coordinates = None
    return {
        **offer,
        "orderStatus": deps.normalize_order_status(order.get("status")),
        "service": deps.normalize_service(order.get("service")),
        "vehicleState": order.get("vehicleState"),
        "serviceDetails": order.get("serviceDetails"),
        "approximateLocation": order.get("customerLocation"),
        "customerComment": order.get("customerComment"),
        "customerCoordinates": customer_coordinates,
        "etaMinutes": max(2, math.ceil(float(offer.get("distanceKm") or 0) * 4)),
    }


def dispatch_order(deps: Dependencies,
    order_id: str,
    order_store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
    offer_store_path: Optional[Path] = None,
    *,
    reset_auto_retry: bool = False,
    force_wave: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    if deps._should_use_sql_runtime(order_store_path, provider_store_path, offer_store_path):
        with deps.STORE_LOCK:
            return deps._dispatch_order_sql(
                order_id,
                reset_auto_retry=reset_auto_retry,
                force_wave=force_wave,
            )

    with deps.STORE_LOCK:
        order_path = order_store_path or deps._default_store_path()
        offer_path = offer_store_path or deps._default_offer_store_path()
        provider_path = provider_store_path or deps._default_provider_store_path()
        orders = deps.load_orders(order_path)
        offers = deps.load_offers(offer_path)
        providers = deps.load_providers(provider_path)
        deps._expire_offers_in_memory(offers, orders)

        order = next((item for item in orders if str(item.get("id")) == str(order_id)), None)
        if order is None:
            return None
        if deps.normalize_order_status(order.get("status")) != "searching":
            return deps.attach_dispatch_to_order(order, offers)

        prev_info = order.get("dispatchInfo") if isinstance(order.get("dispatchInfo"), dict) else {}
        if reset_auto_retry:
            order["dispatchInfo"] = {
                **prev_info,
                "autoRetryCount": 0,
            }
            order["dispatchInfo"].pop("exhaustedAt", None)
            order["dispatchInfo"].pop("lastAutoRetryAt", None)
            order["dispatchInfo"].pop("nextWaveAt", None)
            order["dispatchInfo"]["wave"] = 0
            prev_info = order["dispatchInfo"]

        service = deps.normalize_service(order.get("service"))
        radius_steps = deps.search_radius_steps_for_service(service)
        current_wave = int(force_wave if force_wave is not None else (prev_info.get("wave") or 0)) + 1
        batch_size = deps.wave_batch_size(current_wave)
        pending_existing = deps._pending_offer_count_for_order(offers, order_id)
        slots_left = max(0, deps.MAX_PROVIDER_OFFERS - pending_existing)
        if slots_left <= 0:
            order["dispatchState"] = "OFFERS_SENT"
            order["updatedAt"] = deps._now_iso()
            deps._write_json_atomic(order_path, orders)
            deps.save_offers(offers, offer_path)
            return deps.attach_dispatch_to_order(order, offers)
        batch_size = min(batch_size, slots_left)

        now = datetime.now(timezone.utc).replace(tzinfo=None)
        now_iso = f"{now.isoformat(timespec='seconds')}Z"
        offered_ids = deps._providers_blocked_for_order(offers, order_id)
        max_radius = max(radius_steps)
        candidates = deps.eligible_providers_for_order(order, providers, offered_ids, now)
        selected: List[Dict[str, Any]] = []
        used_ids: set[str] = set()
        selected_radius: Optional[int] = None

        deps._append_order_event(
            order,
            "DISPATCH_STARTED" if current_wave == 1 else "DISPATCH_WAVE",
            now_iso,
            {"wave": current_wave, "batchSize": batch_size, "serviceInitialRadiusKm": deps.initial_radius_km_for_service(service)},
        )
        for radius in radius_steps:
            for candidate in candidates:
                if candidate["id"] in used_ids or candidate["distanceKm"] > radius:
                    continue
                selected.append(candidate)
                used_ids.add(candidate["id"])
                selected_radius = radius
                if len(selected) >= batch_size:
                    break
            if len(selected) >= batch_size:
                break

        if not selected:
            pending_existing = deps._pending_offer_count_for_order(offers, order_id)
            prev_info = order.get("dispatchInfo") if isinstance(order.get("dispatchInfo"), dict) else {}
            if pending_existing > 0:
                # Another concurrent retry already sent offers — keep OFFERS_SENT.
                order["dispatchState"] = "OFFERS_SENT"
                order["dispatchInfo"] = {
                    **prev_info,
                    "eligibleProviders": len(candidates),
                    "offersSent": max(int(prev_info.get("offersSent") or 0), pending_existing),
                    "lastDispatchAt": now_iso,
                    "wave": max(int(prev_info.get("wave") or 0), current_wave - 1),
                    "searchRadiusStepsKm": radius_steps,
                    "serviceInitialRadiusKm": deps.initial_radius_km_for_service(service),
                }
                order["updatedAt"] = now_iso
                deps._write_json_atomic(order_path, orders)
                deps.save_offers(offers, offer_path)
                return deps.attach_dispatch_to_order(order, offers)
            order["dispatchState"] = "NO_PROVIDERS_AVAILABLE"
            order["dispatchInfo"] = {
                "eligibleProviders": len(candidates),
                "offersSent": 0,
                "searchRadiusStepsKm": radius_steps,
                "serviceInitialRadiusKm": deps.initial_radius_km_for_service(service),
                "wave": current_wave,
                "lastDispatchAt": now_iso,
                **{
                    key: prev_info[key]
                    for key in ("autoRetryCount", "lastAutoRetryAt", "exhaustedAt")
                    if key in prev_info
                },
            }
            order["updatedAt"] = now_iso
            deps._append_order_event(order, "NO_PROVIDERS_AVAILABLE", now_iso)
            deps._write_json_atomic(order_path, orders)
            deps.save_offers(offers, offer_path)
            return deps.attach_dispatch_to_order(order, offers)

        expires_at = f"{(now + timedelta(seconds=deps.OFFER_TIMEOUT_SECONDS)).isoformat(timespec='seconds')}Z"
        for candidate in selected:
            offer = {
                "id": f"OF-{uuid.uuid4().hex[:12].upper()}",
                "orderId": order_id,
                "providerId": candidate["id"],
                "status": "pending",
                "distanceKm": candidate["distanceKm"],
                "createdAt": now_iso,
                "expiresAt": expires_at,
                "wave": current_wave,
            }
            offers.append(offer)
            deps._append_order_event(
                order,
                "OFFER_CREATED",
                now_iso,
                {
                    "offerId": offer["id"],
                    "providerId": candidate["id"],
                    "distanceKm": candidate["distanceKm"],
                    "wave": current_wave,
                },
            )

        next_wave_at = None
        if current_wave == 1:
            next_wave_at = f"{(now + timedelta(seconds=deps.DISPATCH_WAVE_WAIT_SECONDS)).isoformat(timespec='seconds')}Z"

        order["dispatchState"] = "OFFERS_SENT"
        prev_info = order.get("dispatchInfo") if isinstance(order.get("dispatchInfo"), dict) else {}
        total_sent = int(prev_info.get("offersSent") or 0) + len(selected)
        order["dispatchInfo"] = {
            "eligibleProviders": len(candidates),
            "offersSent": total_sent,
            "offersSentThisWave": len(selected),
            "searchRadiusKm": selected_radius,
            "searchRadiusStepsKm": radius_steps,
            "serviceInitialRadiusKm": deps.initial_radius_km_for_service(service),
            "maxProviderOffers": deps.MAX_PROVIDER_OFFERS,
            "offerTimeoutSeconds": deps.OFFER_TIMEOUT_SECONDS,
            "wave": current_wave,
            "wave1Size": deps.DISPATCH_WAVE1_SIZE,
            "wave2Size": deps.DISPATCH_WAVE2_SIZE,
            "waveWaitSeconds": deps.DISPATCH_WAVE_WAIT_SECONDS,
            "lastDispatchAt": now_iso,
            **({"nextWaveAt": next_wave_at} if next_wave_at else {}),
            **{
                key: prev_info[key]
                for key in ("autoRetryCount", "lastAutoRetryAt", "exhaustedAt")
                if key in prev_info
            },
        }
        if current_wave > 1:
            order["dispatchInfo"].pop("nextWaveAt", None)
        order["updatedAt"] = now_iso
        deps._write_json_atomic(order_path, orders)
        deps.save_offers(offers, offer_path)
        return deps.attach_dispatch_to_order(order, offers)


def _dispatch_order_sql(deps: Dependencies,
    order_id: str,
    *,
    reset_auto_retry: bool = False,
    force_wave: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    """Row-level SQL dispatch: no full-table rewrite of orders/offers/providers."""
    deps.sql_expire_pending_offers(order_id=str(order_id))
    order = deps.sql_get_order(str(order_id))
    if order is None:
        return None
    offers = deps.sql_offers_for_order(str(order_id))
    if deps.normalize_order_status(order.get("status")) != "searching":
        return deps.attach_dispatch_to_order(order, offers)

    prev_info = order.get("dispatchInfo") if isinstance(order.get("dispatchInfo"), dict) else {}
    if reset_auto_retry:
        order["dispatchInfo"] = {
            **prev_info,
            "autoRetryCount": 0,
            "wave": 0,
        }
        order["dispatchInfo"].pop("exhaustedAt", None)
        order["dispatchInfo"].pop("lastAutoRetryAt", None)
        order["dispatchInfo"].pop("nextWaveAt", None)
        prev_info = order["dispatchInfo"]

    service = deps.normalize_service(order.get("service"))
    radius_steps = deps.search_radius_steps_for_service(service)
    current_wave = int(force_wave if force_wave is not None else (prev_info.get("wave") or 0)) + 1
    batch_size = deps.wave_batch_size(current_wave)
    pending_existing = deps._pending_offer_count_for_order(offers, order_id)
    slots_left = max(0, deps.MAX_PROVIDER_OFFERS - pending_existing)
    if slots_left <= 0:
        order["dispatchState"] = "OFFERS_SENT"
        order["updatedAt"] = deps._now_iso()
        persisted = deps.sql_upsert_order(order)
        return deps.attach_dispatch_to_order(persisted, offers)
    batch_size = min(batch_size, slots_left)

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    now_iso = f"{now.isoformat(timespec='seconds')}Z"
    offered_ids = deps._providers_blocked_for_order(offers, order_id)
    max_radius = max(radius_steps)
    candidates = deps.sql_candidate_providers_for_order(
        order_id=str(order_id),
        service=service,
        already_offered_provider_ids=offered_ids,
        max_radius_km=max_radius,
        ttl_seconds=deps.PROVIDER_PRESENCE_TTL_SECONDS,
        now=now,
    )
    selected: List[Dict[str, Any]] = []
    used_ids: set[str] = set()
    selected_radius: Optional[int] = None

    deps._append_order_event(
        order,
        "DISPATCH_STARTED" if current_wave == 1 else "DISPATCH_WAVE",
        now_iso,
        {"wave": current_wave, "batchSize": batch_size, "serviceInitialRadiusKm": deps.initial_radius_km_for_service(service)},
    )
    for radius in radius_steps:
        for candidate in candidates:
            if candidate["id"] in used_ids or candidate["distanceKm"] > radius:
                continue
            selected.append(candidate)
            used_ids.add(candidate["id"])
            selected_radius = radius
            if len(selected) >= batch_size:
                break
        if len(selected) >= batch_size:
            break

    if not selected:
        pending_existing = deps._pending_offer_count_for_order(offers, order_id)
        prev_info = order.get("dispatchInfo") if isinstance(order.get("dispatchInfo"), dict) else {}
        if pending_existing > 0:
            order["dispatchState"] = "OFFERS_SENT"
            order["dispatchInfo"] = {
                **prev_info,
                "eligibleProviders": len(candidates),
                "offersSent": max(int(prev_info.get("offersSent") or 0), pending_existing),
                "lastDispatchAt": now_iso,
                "wave": max(int(prev_info.get("wave") or 0), current_wave - 1),
                "searchRadiusStepsKm": radius_steps,
                "serviceInitialRadiusKm": deps.initial_radius_km_for_service(service),
            }
            order["updatedAt"] = now_iso
            persisted = deps.sql_upsert_order(order)
            return deps.attach_dispatch_to_order(persisted, offers)
        order["dispatchState"] = "NO_PROVIDERS_AVAILABLE"
        order["dispatchInfo"] = {
            "eligibleProviders": len(candidates),
            "offersSent": 0,
            "searchRadiusStepsKm": radius_steps,
            "serviceInitialRadiusKm": deps.initial_radius_km_for_service(service),
            "wave": current_wave,
            "lastDispatchAt": now_iso,
            **{
                key: prev_info[key]
                for key in ("autoRetryCount", "lastAutoRetryAt", "exhaustedAt")
                if key in prev_info
            },
        }
        order["updatedAt"] = now_iso
        deps._append_order_event(order, "NO_PROVIDERS_AVAILABLE", now_iso)
        persisted = deps.sql_upsert_order(order)
        return deps.attach_dispatch_to_order(persisted, offers)

    expires_at = f"{(now + timedelta(seconds=deps.OFFER_TIMEOUT_SECONDS)).isoformat(timespec='seconds')}Z"
    new_offers: List[Dict[str, Any]] = []
    for candidate in selected:
        offer = {
            "id": f"OF-{uuid.uuid4().hex[:12].upper()}",
            "orderId": order_id,
            "providerId": candidate["id"],
            "status": "pending",
            "distanceKm": candidate["distanceKm"],
            "createdAt": now_iso,
            "expiresAt": expires_at,
            "wave": current_wave,
        }
        new_offers.append(offer)
        deps._append_order_event(
            order,
            "OFFER_CREATED",
            now_iso,
            {
                "offerId": offer["id"],
                "providerId": candidate["id"],
                "distanceKm": candidate["distanceKm"],
                "wave": current_wave,
            },
        )

    next_wave_at = None
    if current_wave == 1:
        next_wave_at = f"{(now + timedelta(seconds=deps.DISPATCH_WAVE_WAIT_SECONDS)).isoformat(timespec='seconds')}Z"

    order["dispatchState"] = "OFFERS_SENT"
    prev_info = order.get("dispatchInfo") if isinstance(order.get("dispatchInfo"), dict) else {}
    total_sent = int(prev_info.get("offersSent") or 0) + len(selected)
    order["dispatchInfo"] = {
        "eligibleProviders": len(candidates),
        "offersSent": total_sent,
        "offersSentThisWave": len(selected),
        "searchRadiusKm": selected_radius,
        "searchRadiusStepsKm": radius_steps,
        "serviceInitialRadiusKm": deps.initial_radius_km_for_service(service),
        "maxProviderOffers": deps.MAX_PROVIDER_OFFERS,
        "offerTimeoutSeconds": deps.OFFER_TIMEOUT_SECONDS,
        "wave": current_wave,
        "wave1Size": deps.DISPATCH_WAVE1_SIZE,
        "wave2Size": deps.DISPATCH_WAVE2_SIZE,
        "waveWaitSeconds": deps.DISPATCH_WAVE_WAIT_SECONDS,
        "lastDispatchAt": now_iso,
        **({"nextWaveAt": next_wave_at} if next_wave_at else {}),
        **{
            key: prev_info[key]
            for key in ("autoRetryCount", "lastAutoRetryAt", "exhaustedAt")
            if key in prev_info
        },
    }
    if current_wave > 1:
        order["dispatchInfo"].pop("nextWaveAt", None)
    order["updatedAt"] = now_iso
    persisted_order, persisted_offers = deps.sql_commit_dispatch_wave(order, new_offers)
    return deps.attach_dispatch_to_order(persisted_order, persisted_offers)


def attach_dispatch_to_order(deps: Dependencies, order: Dict[str, Any], offers: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    payload = deps.enrich_order_for_client(order)
    if offers is not None:
        related_offers = [dict(offer) for offer in offers if str(offer.get("orderId")) == str(order.get("id"))]
    elif deps._should_use_sql_store(None, deps._default_offer_store_path):
        related_offers = [dict(offer) for offer in deps.sql_offers_for_order(str(order.get("id") or ""))]
    else:
        related_offers = [dict(offer) for offer in deps.load_offers() if str(offer.get("orderId")) == str(order.get("id"))]
    payload["offers"] = related_offers
    return payload


def attach_dispatch_to_orders(deps: Dependencies, orders: List[Dict[str, Any]], offers: Optional[List[Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
    active_offers = offers if offers is not None else deps.load_offers()
    return [deps.attach_dispatch_to_order(order, active_offers) for order in orders]


def get_provider_offers(deps: Dependencies,
    provider_id: str,
    order_store_path: Optional[Path] = None,
    offer_store_path: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    # Always expire before listing — do not use throttled expire_stale_and_notify here,
    # or recently-expired offers stay visible between throttle windows.
    deps.expire_stale_dispatch(order_store_path=order_store_path, offer_store_path=offer_store_path)
    if deps._should_use_sql_runtime(order_store_path, None, offer_store_path):
        provider_offers = []
        for offer in deps.sql_pending_offers_for_provider(str(provider_id)):
            order = offer.get("order") if isinstance(offer.get("order"), dict) else None
            if not isinstance(order, dict):
                continue
            bare = {key: value for key, value in offer.items() if key != "order"}
            provider_offers.append(deps._public_offer_payload(bare, order))
        return sorted(provider_offers, key=lambda item: item.get("createdAt") or "")

    with deps.STORE_LOCK:
        orders = deps.load_orders(order_store_path)
        offers = deps.load_offers(offer_store_path)

        order_by_id = {str(order.get("id")): order for order in orders}
        provider_offers = []
        for offer in offers:
            if str(offer.get("providerId")) != str(provider_id) or offer.get("status") != "pending":
                continue
            order = order_by_id.get(str(offer.get("orderId")))
            if not order:
                continue
            if deps.peek_order_status(order.get("status")) != "searching":
                continue
            if order.get("assignedProviderId"):
                continue
            provider_offers.append(deps._public_offer_payload(offer, order))

        return sorted(provider_offers, key=lambda offer: offer.get("createdAt") or "")
