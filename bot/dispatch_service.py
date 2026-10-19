"""SQL dispatch orchestration shared by HTTP, Telegram and the durable worker.

The legacy store facade remains the adapter while profile operations are migrated.
"""
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from bot import order_store as store

def dispatch_order_sql(
    order_id: str,
    *,
    reset_auto_retry: bool = False,
    force_wave: Optional[int] = None,
) -> Optional[Dict[str, Any]]:
    """Row-level SQL dispatch: no full-table rewrite of orders/offers/providers."""
    store.sql_expire_pending_offers(order_id=str(order_id))
    order = store.sql_get_order(str(order_id))
    if order is None:
        return None
    offers = store.sql_offers_for_order(str(order_id))
    if store.normalize_order_status(order.get("status")) != "searching":
        return store.attach_dispatch_to_order(order, offers)

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

    service = store.normalize_service(order.get("service"))
    radius_steps = store.search_radius_steps_for_service(service)
    current_wave = int(force_wave if force_wave is not None else (prev_info.get("wave") or 0)) + 1
    batch_size = store.wave_batch_size(current_wave)
    pending_existing = store._pending_offer_count_for_order(offers, order_id)
    slots_left = max(0, store.MAX_PROVIDER_OFFERS - pending_existing)
    if slots_left <= 0:
        order["dispatchState"] = "OFFERS_SENT"
        order["updatedAt"] = store._now_iso()
        store.sql_upsert_order(order)
        return store.attach_dispatch_to_order(order, offers)
    batch_size = min(batch_size, slots_left)

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    now_iso = f"{now.isoformat(timespec='seconds')}Z"
    offered_ids = store._providers_blocked_for_order(offers, order_id)
    max_radius = max(radius_steps)
    candidates = store.sql_candidate_providers_for_order(
        order_id=str(order_id),
        service=service,
        already_offered_provider_ids=offered_ids,
        max_radius_km=max_radius,
        ttl_seconds=store.PROVIDER_PRESENCE_TTL_SECONDS,
        now=now,
    )
    from bot.routing import rank_candidates
    candidates = rank_candidates(candidates, order.get("customerCoordinates") or {})
    selected: List[Dict[str, Any]] = []
    used_ids: set[str] = set()
    selected_radius: Optional[int] = None

    store._append_order_event(
        order,
        "DISPATCH_STARTED" if current_wave == 1 else "DISPATCH_WAVE",
        now_iso,
        {"wave": current_wave, "batchSize": batch_size, "serviceInitialRadiusKm": store.initial_radius_km_for_service(service)},
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
        pending_existing = store._pending_offer_count_for_order(offers, order_id)
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
                "serviceInitialRadiusKm": store.initial_radius_km_for_service(service),
            }
            order["updatedAt"] = now_iso
            store.sql_upsert_order(order)
            return store.attach_dispatch_to_order(order, offers)
        order["dispatchState"] = "NO_PROVIDERS_AVAILABLE"
        order["dispatchInfo"] = {
            "eligibleProviders": len(candidates),
            "offersSent": 0,
            "searchRadiusStepsKm": radius_steps,
            "serviceInitialRadiusKm": store.initial_radius_km_for_service(service),
            "wave": current_wave,
            "lastDispatchAt": now_iso,
            **{
                key: prev_info[key]
                for key in ("autoRetryCount", "lastAutoRetryAt", "exhaustedAt")
                if key in prev_info
            },
        }
        order["updatedAt"] = now_iso
        store._append_order_event(order, "NO_PROVIDERS_AVAILABLE", now_iso)
        store.sql_upsert_order(order)
        return store.attach_dispatch_to_order(order, offers)

    expires_at = f"{(now + timedelta(seconds=store.OFFER_TIMEOUT_SECONDS)).isoformat(timespec='seconds')}Z"
    new_offers: List[Dict[str, Any]] = []
    for candidate in selected:
        offer = {
            "id": f"OF-{uuid.uuid4().hex[:12].upper()}",
            "orderId": order_id,
            "providerId": candidate["id"],
            "status": "pending",
            "distanceKm": candidate["distanceKm"],
            "etaMinutes": candidate.get("etaMinutes"),
            "etaSource": candidate.get("etaSource", "approximate"),
            "roadDistanceKm": candidate.get("roadDistanceKm"),
            "createdAt": now_iso,
            "expiresAt": expires_at,
            "wave": current_wave,
        }
        new_offers.append(offer)
        store._append_order_event(
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
        next_wave_at = f"{(now + timedelta(seconds=store.DISPATCH_WAVE_WAIT_SECONDS)).isoformat(timespec='seconds')}Z"

    order["dispatchState"] = "OFFERS_SENT"
    prev_info = order.get("dispatchInfo") if isinstance(order.get("dispatchInfo"), dict) else {}
    total_sent = int(prev_info.get("offersSent") or 0) + len(selected)
    order["dispatchInfo"] = {
        "eligibleProviders": len(candidates),
        "offersSent": total_sent,
        "offersSentThisWave": len(selected),
        "searchRadiusKm": selected_radius,
        "searchRadiusStepsKm": radius_steps,
        "serviceInitialRadiusKm": store.initial_radius_km_for_service(service),
        "maxProviderOffers": store.MAX_PROVIDER_OFFERS,
        "offerTimeoutSeconds": store.OFFER_TIMEOUT_SECONDS,
        "wave": current_wave,
        "wave1Size": store.DISPATCH_WAVE1_SIZE,
        "wave2Size": store.DISPATCH_WAVE2_SIZE,
        "waveWaitSeconds": store.DISPATCH_WAVE_WAIT_SECONDS,
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
    persisted_order, persisted_offers = store.sql_commit_dispatch_wave(order, new_offers)
    return store.attach_dispatch_to_order(persisted_order, persisted_offers)

