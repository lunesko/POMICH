"""Lifecycle operations; no dependency on the compatibility facade."""

from __future__ import annotations

import math
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional


@dataclass(frozen=True)
class Dependencies:
    ACCEPTED_IDLE_TIMEOUT_SECONDS: Any
    DispatchConflict: Any
    InvalidStatusTransition: Any
    MAX_DISPATCH_AUTO_RETRIES: Any
    ORDER_TRANSITIONS: Any
    STORE_LOCK: Any
    SqlDispatchConflict: Any
    TERMINAL_ORDER_STATUSES: Any
    _append_order_event: Callable[..., Any]
    _cancel_idle_accepted_orders_in_memory: Callable[..., Any]
    _default_offer_store_path: Callable[..., Any]
    _default_provider_store_path: Callable[..., Any]
    _default_store_path: Callable[..., Any]
    _expire_offers_in_memory: Callable[..., Any]
    _free_providers_after_idle_cancel: Callable[..., Any]
    _increment_customer_orders_completed: Callable[..., Any]
    _increment_provider_orders_completed: Callable[..., Any]
    _normalize_proposed_price: Any
    _now_iso: Callable[..., Any]
    _offer_error_for_status: Callable[..., Any]
    _order_accepted_at: Callable[..., Any]
    _parse_iso: Callable[..., Any]
    _set_provider_status: Callable[..., Any]
    _should_use_sql_runtime: Callable[..., Any]
    _should_use_sql_store: Callable[..., Any]
    _write_json_atomic: Callable[..., Any]
    attach_dispatch_to_order: Callable[..., Any]
    dispatch_order: Callable[..., Any]
    enrich_order_for_client: Callable[..., Any]
    expire_stale_and_notify: Callable[..., Any]
    expire_stale_dispatch: Callable[..., Any]
    get_order: Callable[..., Any]
    get_provider_profile: Callable[..., Any]
    invalidate_order_offers: Callable[..., Any]
    is_provider_verified: Callable[..., Any]
    load_offers: Callable[..., Any]
    load_orders: Callable[..., Any]
    load_providers: Callable[..., Any]
    normalize_order_status: Any
    peek_order_status: Any
    save_offers: Callable[..., Any]
    save_providers: Callable[..., Any]
    sql_accept_offer: Any
    sql_commit_order_snapshot: Any
    sql_decline_offer: Any
    sql_expire_pending_offers: Any
    sql_get_order: Any
    sql_invalidate_order_offers: Any
    sql_offers_for_order: Any
    sql_offers_for_orders: Any
    sql_orders_by_status: Any
    sql_upsert_order: Any
    sql_upsert_provider: Any
    update_order_status: Callable[..., Any]


def confirm_order_price(deps: Dependencies,
    order_id: str,
    order_store_path: Optional[Path] = None,
    offer_store_path: Optional[Path] = None,
) -> Dict[str, Any]:
    deps.expire_stale_and_notify(order_store_path=order_store_path, offer_store_path=offer_store_path)
    with deps.STORE_LOCK:
        path = order_store_path or deps._default_store_path()
        use_sql = deps._should_use_sql_store(path, deps._default_store_path)
        orders = [] if use_sql else deps.load_orders(path)
        order = deps.sql_get_order(str(order_id)) if use_sql else next(
            (item for item in orders if str(item.get("id")) == str(order_id)), None
        )
        if order is None:
            raise deps.DispatchConflict("ORDER_NOT_FOUND", "Order was not found.")

        current_status = deps.normalize_order_status(order.get("status"))
        if current_status == "cancelled" and order.get("cancelReason") == "accepted_idle_timeout":
            raise deps.DispatchConflict("ORDER_ACCEPTED_TIMEOUT", "Accepted order was cancelled after idle timeout.")
        if current_status not in {"accepted", "assigned"}:
            raise deps.DispatchConflict("PRICE_NOT_PENDING", "Order is not waiting for price confirmation.")

        original = deepcopy(order)
        now = deps._now_iso()
        order["status"] = "price_confirmed"
        order["priceConfirmedAt"] = now
        order["updatedAt"] = now
        history = order.get("statusHistory") if isinstance(order.get("statusHistory"), list) else []
        history.append({"status": "price_confirmed", "at": now})
        order["statusHistory"] = history
        deps._append_order_event(order, "PRICE_CONFIRMED", now, {"price": order.get("partnerProposedPrice")})
        if use_sql:
            if not deps.sql_commit_order_snapshot(original, order):
                raise deps.DispatchConflict("PRICE_NOT_PENDING", "Order changed during price confirmation. Refresh and retry.")
            return deps.attach_dispatch_to_order(order, deps.sql_offers_for_order(str(order_id)))
        deps._write_json_atomic(path, orders)
        return deps.attach_dispatch_to_order(order, deps.load_offers(offer_store_path))


def update_order_status(deps: Dependencies,
    order_id: str,
    status: str,
    store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
    offer_store_path: Optional[Path] = None,
) -> Optional[Dict[str, Any]]:
    with deps.STORE_LOCK:
        now = deps._now_iso()
        next_status = deps.normalize_order_status(status)
        use_sql = deps._should_use_sql_store(store_path, deps._default_store_path)

        if use_sql:
            order = deps.sql_get_order(str(order_id))
            if order is None:
                return None
            current_status = deps.normalize_order_status(order.get("status"))
            if next_status == current_status:
                return deps.enrich_order_for_client(order, provider_store_path)
            if next_status not in deps.ORDER_TRANSITIONS[current_status]:
                raise deps.InvalidStatusTransition(current_status, next_status)

            order["status"] = next_status
            order["updatedAt"] = now
            history = order.get("statusHistory")
            if not isinstance(history, list):
                history = []
            history.append({"status": next_status, "at": now})
            order["statusHistory"] = history
            deps._append_order_event(order, f"ORDER_{next_status.upper()}", now)
            try:
                updated_order = deps.sql_upsert_order(order)
            except deps.SqlDispatchConflict as exc:
                raise deps.DispatchConflict(exc.code, str(exc)) from exc
        else:
            path = store_path or deps._default_store_path()
            orders = deps.load_orders(path)
            updated_order = None

            for order in orders:
                if str(order.get("id")) != str(order_id):
                    continue
                current_status = deps.normalize_order_status(order.get("status"))
                if next_status == current_status:
                    updated_order = order
                    break
                if next_status not in deps.ORDER_TRANSITIONS[current_status]:
                    raise deps.InvalidStatusTransition(current_status, next_status)

                order["status"] = next_status
                order["updatedAt"] = now
                history = order.get("statusHistory")
                if not isinstance(history, list):
                    history = []
                history.append({"status": next_status, "at": now})
                order["statusHistory"] = history
                deps._append_order_event(order, f"ORDER_{next_status.upper()}", now)
                updated_order = order
                break

            if updated_order is None:
                return None

            deps._write_json_atomic(path, orders)

        if next_status == "cancelled":
            deps.invalidate_order_offers(order_id, "cancelled", offer_store_path)
            if updated_order.get("assignedProviderId"):
                deps._set_provider_status(str(updated_order.get("assignedProviderId")), "online", provider_store_path=provider_store_path)
        elif next_status == "completed":
            deps.invalidate_order_offers(order_id, "lost", offer_store_path)
            if updated_order.get("assignedProviderId"):
                provider_id = str(updated_order.get("assignedProviderId"))
                deps._set_provider_status(provider_id, "online", provider_store_path=provider_store_path)
                deps._increment_provider_orders_completed(provider_id, provider_store_path=provider_store_path)
                customer_id = str(updated_order.get("customerId") or "").strip()
                if customer_id:
                    deps._increment_customer_orders_completed(customer_id)
        if updated_order is not None:
            updated_order = deps.enrich_order_for_client(updated_order, provider_store_path)
        return updated_order


def _order_accepted_at(deps: Dependencies, order: Dict[str, Any]) -> Optional[datetime]:
    parsed = deps._parse_iso(order.get("acceptedAt"))
    if parsed is not None:
        return parsed
    history = order.get("statusHistory")
    if isinstance(history, list):
        for entry in reversed(history):
            if not isinstance(entry, dict):
                continue
            if deps.peek_order_status(entry.get("status")) == "accepted":
                at = deps._parse_iso(entry.get("at"))
                if at is not None:
                    return at
    return deps._parse_iso(order.get("updatedAt")) or deps._parse_iso(order.get("createdAt"))


def _expire_offers_in_memory(deps: Dependencies, offers: List[Dict[str, Any]], orders: List[Dict[str, Any]], now: Optional[datetime] = None) -> bool:
    checked_at = now or datetime.now(timezone.utc).replace(tzinfo=None)
    now_iso = f"{checked_at.isoformat(timespec='seconds')}Z"
    order_by_id = {str(order.get("id")): order for order in orders}
    changed = False

    for offer in offers:
        if offer.get("status") != "pending":
            continue

        order = order_by_id.get(str(offer.get("orderId")))
        order_status = deps.peek_order_status(order.get("status")) if order else "cancelled"
        expires_at = deps._parse_iso(offer.get("expiresAt"))

        if order_status in {None, "cancelled"} or order_status in deps.TERMINAL_ORDER_STATUSES:
            offer["status"] = "cancelled" if order_status != "completed" else "lost"
            offer["respondedAt"] = now_iso
            changed = True
        elif order_status != "searching":
            offer["status"] = "lost"
            offer["respondedAt"] = now_iso
            changed = True
        elif expires_at and checked_at >= expires_at:
            offer["status"] = "expired"
            offer["respondedAt"] = now_iso
            if order:
                deps._append_order_event(order, "OFFER_EXPIRED", now_iso, {"offerId": offer.get("id"), "providerId": offer.get("providerId")})
            changed = True

    return changed


def _cancel_idle_accepted_orders_in_memory(deps: Dependencies,
    orders: List[Dict[str, Any]],
    offers: List[Dict[str, Any]],
    now: Optional[datetime] = None,
) -> List[Dict[str, Any]]:
    """Cancel accepted orders idle longer than ACCEPTED_IDLE_TIMEOUT_SECONDS. Mutates orders/offers."""
    checked_at = now or datetime.now(timezone.utc).replace(tzinfo=None)
    now_iso = f"{checked_at.isoformat(timespec='seconds')}Z"
    timeout = timedelta(seconds=deps.ACCEPTED_IDLE_TIMEOUT_SECONDS)
    cancelled: List[Dict[str, Any]] = []

    for order in orders:
        if deps.peek_order_status(order.get("status")) != "accepted":
            continue
        accepted_at = deps._order_accepted_at(order)
        if accepted_at is None or checked_at - accepted_at < timeout:
            continue

        order["status"] = "cancelled"
        order["cancelReason"] = "accepted_idle_timeout"
        order["cancelledAt"] = now_iso
        order["updatedAt"] = now_iso
        order["dispatchState"] = "CANCELLED"
        history = order.get("statusHistory") if isinstance(order.get("statusHistory"), list) else []
        history.append({"status": "cancelled", "at": now_iso, "reason": "accepted_idle_timeout"})
        order["statusHistory"] = history
        deps._append_order_event(
            order,
            "ORDER_ACCEPTED_TIMEOUT",
            now_iso,
            {"timeoutSeconds": deps.ACCEPTED_IDLE_TIMEOUT_SECONDS, "acceptedAt": order.get("acceptedAt")},
        )
        deps._append_order_event(order, "ORDER_CANCELLED", now_iso, {"reason": "accepted_idle_timeout"})
        cancelled.append(order)

        order_id = str(order.get("id") or "")
        for offer in offers:
            if str(offer.get("orderId")) != order_id:
                continue
            if offer.get("status") != "pending":
                continue
            offer["status"] = "cancelled"
            offer["respondedAt"] = now_iso

    return cancelled


def _free_providers_after_idle_cancel(deps: Dependencies,
    cancelled_orders: List[Dict[str, Any]],
    provider_store_path: Optional[Path] = None,
) -> bool:
    if not cancelled_orders:
        return False
    now = deps._now_iso()
    changed = False
    provider_ids = {
        str(order.get("assignedProviderId") or order.get("partnerId") or "").strip()
        for order in cancelled_orders
    }
    provider_ids.discard("")
    if deps._should_use_sql_store(provider_store_path, deps._default_provider_store_path):
        for provider_id in provider_ids:
            deps._set_provider_status(provider_id, "online", provider_store_path=provider_store_path)
        return bool(provider_ids)
    providers = deps.load_providers(provider_store_path)
    for provider in providers:
        if str(provider.get("id") or "") not in provider_ids:
            continue
        provider.pop("stale", None)
        provider["status"] = "online"
        provider["assignedOrderId"] = None
        provider["updatedAt"] = now
        provider["lastSeenAt"] = now
        changed = True
    if changed:
        deps.save_providers(providers, provider_store_path)
    return changed


def expire_stale_dispatch(deps: Dependencies,
    order_store_path: Optional[Path] = None,
    offer_store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
) -> List[Dict[str, Any]]:
    """Expire pending offers and cancel idle accepted orders. Returns cancelled (enriched) orders."""
    retry_order_ids: List[str] = []
    wave_order_ids: List[str] = []
    with deps.STORE_LOCK:
        order_path = order_store_path or deps._default_store_path()
        offer_path = offer_store_path or deps._default_offer_store_path()
        use_sql = deps._should_use_sql_store(order_path, deps._default_store_path) and deps._should_use_sql_store(
            offer_path, deps._default_offer_store_path
        )
        if use_sql:
            deps.sql_expire_pending_offers(now=datetime.now(timezone.utc).replace(tzinfo=None))
            orders = deps.sql_orders_by_status({"searching", "accepted"}, limit=None)
            offers = deps.sql_offers_for_orders({str(order.get("id") or "") for order in orders})
            original_orders = {str(order["id"]): deepcopy(order) for order in orders}
            original_offers = deepcopy(offers)
            offer_changed = False
        else:
            orders = deps.load_orders(order_path)
            offers = deps.load_offers(offer_path)
            offer_changed = deps._expire_offers_in_memory(offers, orders)
        cancelled = deps._cancel_idle_accepted_orders_in_memory(orders, offers)
        exhaustion_changed = False
        now_iso = deps._now_iso()
        checked_at = datetime.now(timezone.utc).replace(tzinfo=None)
        for order in orders:
            if deps.peek_order_status(order.get("status")) != "searching":
                continue
            order_id = str(order.get("id") or "")
            if not order_id:
                continue
            related = [offer for offer in offers if str(offer.get("orderId")) == order_id]
            info = order.get("dispatchInfo") if isinstance(order.get("dispatchInfo"), dict) else {}

            # Priority-2 wave 2: after waveWaitSeconds, offer the next cohort even if wave 1 is still pending.
            next_wave_at = deps._parse_iso(info.get("nextWaveAt"))
            current_wave = int(info.get("wave") or 0)
            if (
                current_wave == 1
                and next_wave_at
                and checked_at >= next_wave_at
                and order_id not in wave_order_ids
            ):
                order["dispatchInfo"] = {**info, "nextWaveAt": None, "waveAdvanceQueuedAt": now_iso}
                order["updatedAt"] = now_iso
                deps._append_order_event(order, "DISPATCH_WAVE_DUE", now_iso, {"fromWave": 1, "toWave": 2})
                exhaustion_changed = True
                wave_order_ids.append(order_id)
                continue

            if not related:
                continue
            if any(offer.get("status") == "pending" for offer in related):
                continue
            auto_retries = int(info.get("autoRetryCount") or 0)
            if auto_retries >= deps.MAX_DISPATCH_AUTO_RETRIES:
                if order.get("dispatchState") != "NO_PROVIDERS_AVAILABLE":
                    order["dispatchState"] = "NO_PROVIDERS_AVAILABLE"
                    order["updatedAt"] = now_iso
                    order["dispatchInfo"] = {
                        **info,
                        "autoRetryCount": auto_retries,
                        "exhaustedAt": now_iso,
                        "awaitingDispatcher": True,
                        "clientStatusHint": "Партнера поруч поки немає. Диспетчер розширює пошук.",
                    }
                    deps._append_order_event(
                        order,
                        "OFFERS_EXHAUSTED",
                        now_iso,
                        {"autoRetryCount": auto_retries},
                    )
                    exhaustion_changed = True
                continue
            last_auto = deps._parse_iso(info.get("lastAutoRetryAt"))
            if last_auto and (checked_at - last_auto).total_seconds() < 8:
                continue
            order["dispatchInfo"] = {**info, "autoRetryCount": auto_retries + 1, "lastAutoRetryAt": now_iso}
            order["dispatchInfo"].pop("nextWaveAt", None)
            # Full auto-retry starts a fresh wave cycle from wave 1.
            order["dispatchInfo"]["wave"] = 0
            order["updatedAt"] = now_iso
            deps._append_order_event(
                order,
                "DISPATCH_AUTO_RETRY",
                now_iso,
                {"autoRetryCount": auto_retries + 1},
            )
            exhaustion_changed = True
            retry_order_ids.append(order_id)
        if offer_changed or cancelled or exhaustion_changed:
            if use_sql:
                committed_ids = set()
                for order in orders:
                    order_id = str(order["id"])
                    before = original_orders[order_id]
                    before_offers = [item for item in original_offers if str(item.get("orderId")) == order_id]
                    after_offers = [item for item in offers if str(item.get("orderId")) == order_id]
                    if order == before and before_offers == after_offers:
                        continue
                    if deps.sql_commit_order_snapshot(before, order, before_offers, after_offers):
                        committed_ids.add(order_id)
                cancelled = [order for order in cancelled if str(order["id"]) in committed_ids]
                retry_order_ids = [key for key in retry_order_ids if key in committed_ids]
                wave_order_ids = [key for key in wave_order_ids if key in committed_ids]
            else:
                deps.save_offers(offers, offer_path)
                deps._write_json_atomic(order_path, orders)
        if cancelled:
            deps._free_providers_after_idle_cancel(cancelled, provider_store_path)

    for order_id in wave_order_ids:
        try:
            deps.dispatch_order(
                order_id,
                order_store_path=order_store_path,
                provider_store_path=provider_store_path,
                offer_store_path=offer_store_path,
            )
        except Exception:
            continue

    for order_id in retry_order_ids:
        try:
            deps.dispatch_order(
                order_id,
                order_store_path=order_store_path,
                provider_store_path=provider_store_path,
                offer_store_path=offer_store_path,
                reset_auto_retry=False,
            )
        except Exception:
            continue

    return [deps.enrich_order_for_client(order, provider_store_path) for order in cancelled]


def expire_offers(deps: Dependencies, order_store_path: Optional[Path] = None, offer_store_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    deps.expire_stale_dispatch(order_store_path=order_store_path, offer_store_path=offer_store_path)
    return deps.load_offers(offer_store_path)


def invalidate_order_offers(deps: Dependencies, order_id: str, status: str = "cancelled", offer_store_path: Optional[Path] = None) -> List[Dict[str, Any]]:
    with deps.STORE_LOCK:
        if deps._should_use_sql_store(offer_store_path, deps._default_offer_store_path):
            return deps.sql_invalidate_order_offers(order_id, status)
        offers = deps.load_offers(offer_store_path)
        now = deps._now_iso()
        changed = False
        for offer in offers:
            if str(offer.get("orderId")) == str(order_id) and offer.get("status") == "pending":
                offer["status"] = "cancelled" if status == "cancelled" else "lost"
                offer["respondedAt"] = now
                changed = True
        if changed:
            deps.save_offers(offers, offer_store_path)
        return offers


def _set_provider_status(deps: Dependencies, provider_id: str, status: str, assigned_order_id: Optional[str] = None, provider_store_path: Optional[Path] = None) -> Optional[Dict[str, Any]]:
    now = deps._now_iso()
    use_sql = deps._should_use_sql_store(provider_store_path, deps._default_provider_store_path)

    if use_sql:
        provider = deps.get_provider_profile(provider_id, provider_store_path)
        if provider is None:
            return None
        provider.pop("stale", None)
        provider["status"] = status
        provider["updatedAt"] = now
        provider["lastSeenAt"] = now
        if assigned_order_id:
            provider["assignedOrderId"] = assigned_order_id
        else:
            provider.pop("assignedOrderId", None)
        return deps.sql_upsert_provider(dict(provider))

    providers = deps.load_providers(provider_store_path)
    updated: Optional[Dict[str, Any]] = None

    for provider in providers:
        if str(provider.get("id")) != str(provider_id):
            continue
        provider.pop("stale", None)
        provider["status"] = status
        provider["updatedAt"] = now
        provider["lastSeenAt"] = now
        if assigned_order_id:
            provider["assignedOrderId"] = assigned_order_id
        else:
            provider.pop("assignedOrderId", None)
        updated = provider
        break

    if updated is not None:
        deps.save_providers(providers, provider_store_path)
    return updated


def accept_offer(deps: Dependencies,
    offer_id: str,
    provider_id: str,
    order_store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
    offer_store_path: Optional[Path] = None,
    proposed_price: Optional[float] = None,
    price_note: Optional[str] = None,
) -> Dict[str, Any]:
    price_value = deps._normalize_proposed_price(proposed_price)
    if price_value is None:
        raise deps.DispatchConflict("PRICE_REQUIRED", "Partner must specify proposed price when accepting.")
    note_value = str(price_note or "").strip() or None

    if deps._should_use_sql_runtime(order_store_path, provider_store_path, offer_store_path):
        try:
            return deps.sql_accept_offer(str(offer_id), str(provider_id), proposed_price=price_value, price_note=note_value)
        except deps.SqlDispatchConflict as exc:
            raise deps.DispatchConflict(exc.code, exc.message) from exc

    with deps.STORE_LOCK:
        order_path = order_store_path or deps._default_store_path()
        provider_path = provider_store_path or deps._default_provider_store_path()
        offer_path = offer_store_path or deps._default_offer_store_path()
        orders = deps.load_orders(order_path)
        providers = deps.load_providers(provider_path)
        offers = deps.load_offers(offer_path)
        deps._expire_offers_in_memory(offers, orders)

        offer = next((item for item in offers if str(item.get("id")) == str(offer_id)), None)
        if offer is None or str(offer.get("providerId")) != str(provider_id):
            raise deps.DispatchConflict("OFFER_NOT_FOUND", "Offer was not found.")
        if offer.get("status") != "pending":
            deps.save_offers(offers, offer_path)
            deps._write_json_atomic(order_path, orders)
            raise deps._offer_error_for_status(str(offer.get("status")))

        order = next((item for item in orders if str(item.get("id")) == str(offer.get("orderId"))), None)
        if order is None:
            offer["status"] = "lost"
            offer["respondedAt"] = deps._now_iso()
            deps.save_offers(offers, offer_path)
            raise deps.DispatchConflict("ORDER_NOT_FOUND", "Order was not found.")

        now = deps._now_iso()
        if deps.normalize_order_status(order.get("status")) != "searching":
            offer["status"] = "lost"
            offer["respondedAt"] = now
            deps.save_offers(offers, offer_path)
            raise deps.DispatchConflict("ORDER_ALREADY_ACCEPTED", "Order has already been accepted by another provider.")

        provider = next((item for item in providers if str(item.get("id")) == str(provider_id)), None)
        if provider is None:
            raise deps.DispatchConflict("PROVIDER_NOT_FOUND", "Provider was not found.")
        if not deps.is_provider_verified(provider):
            raise deps.DispatchConflict("PROVIDER_NOT_VERIFIED", "Provider verification is not approved.")

        offer["status"] = "accepted"
        offer["respondedAt"] = now
        for other_offer in offers:
            if other_offer is offer:
                continue
            if str(other_offer.get("orderId")) == str(order.get("id")) and other_offer.get("status") == "pending":
                other_offer["status"] = "lost"
                other_offer["respondedAt"] = now

        order["status"] = "accepted"
        order["assignedProviderId"] = provider_id
        order["partnerId"] = provider_id
        order["assignedOfferId"] = offer_id
        order["partnerProposedPrice"] = price_value
        order["partnerPriceNote"] = note_value
        order["acceptedAt"] = now
        order["assignedProvider"] = {
            "id": provider.get("id"),
            "name": provider.get("name"),
            "rating": provider.get("rating"),
            "vehicle": provider.get("vehicle"),
            "plate": provider.get("plate"),
            "phone": provider.get("phone"),
            "telegram": provider.get("telegram"),
            "location": provider.get("location"),
            "verificationStatus": provider.get("verificationStatus"),
            "trustedBadges": provider.get("trustedBadges"),
            "distanceKm": offer.get("distanceKm"),
            "etaMinutes": max(2, math.ceil(float(offer.get("distanceKm") or 0) * 4)),
        }
        if provider.get("name"):
            order["providerName"] = provider.get("name")
        order["dispatchState"] = "ACCEPTED"
        order["updatedAt"] = now
        history = order.get("statusHistory") if isinstance(order.get("statusHistory"), list) else []
        history.append({"status": "accepted", "at": now})
        order["statusHistory"] = history
        deps._append_order_event(order, "OFFER_ACCEPTED", now, {"offerId": offer_id, "providerId": provider_id, "proposedPrice": price_value})
        deps._append_order_event(order, "PROVIDER_ASSIGNED", now, {"providerId": provider_id})

        provider.pop("stale", None)
        provider["status"] = "busy"
        provider["assignedOrderId"] = str(order.get("id"))
        provider["updatedAt"] = now
        provider["lastSeenAt"] = now

        deps._write_json_atomic(order_path, orders)
        deps.save_offers(offers, offer_path)
        deps.save_providers(providers, provider_path)
        return {"offer": dict(offer), "order": deps.attach_dispatch_to_order(order, offers), "provider": dict(provider)}


def decline_offer(deps: Dependencies,
    offer_id: str,
    provider_id: str,
    order_store_path: Optional[Path] = None,
    offer_store_path: Optional[Path] = None,
) -> Dict[str, Any]:
    if deps._should_use_sql_store(order_store_path, deps._default_store_path) and deps._should_use_sql_store(
        offer_store_path, deps._default_offer_store_path
    ):
        try:
            deps.sql_expire_pending_offers()
            return deps.sql_decline_offer(str(offer_id), str(provider_id))
        except deps.SqlDispatchConflict as exc:
            if exc.code == "OFFER_NOT_FOUND":
                raise deps.DispatchConflict(exc.code, exc.message) from exc
            raise deps._offer_error_for_status(exc.code) from exc

    with deps.STORE_LOCK:
        order_path = order_store_path or deps._default_store_path()
        offer_path = offer_store_path or deps._default_offer_store_path()
        orders = deps.load_orders(order_path)
        offers = deps.load_offers(offer_path)
        deps._expire_offers_in_memory(offers, orders)
        offer = next((item for item in offers if str(item.get("id")) == str(offer_id)), None)

        if offer is None or str(offer.get("providerId")) != str(provider_id):
            raise deps.DispatchConflict("OFFER_NOT_FOUND", "Offer was not found.")
        if offer.get("status") != "pending":
            deps.save_offers(offers, offer_path)
            deps._write_json_atomic(order_path, orders)
            raise deps._offer_error_for_status(str(offer.get("status")))

        now = deps._now_iso()
        offer["status"] = "declined"
        offer["respondedAt"] = now
        order = next((item for item in orders if str(item.get("id")) == str(offer.get("orderId"))), None)
        if order:
            deps._append_order_event(order, "OFFER_DECLINED", now, {"offerId": offer_id, "providerId": provider_id})

        deps.save_offers(offers, offer_path)
        deps._write_json_atomic(order_path, orders)
        return dict(offer)


def update_provider_order_status(deps: Dependencies,
    provider_id: str,
    order_id: str,
    status: str,
    order_store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
    offer_store_path: Optional[Path] = None,
) -> Dict[str, Any]:
    with deps.STORE_LOCK:
        order = deps.get_order(order_id, order_store_path)
        if order is None:
            raise deps.DispatchConflict("ORDER_NOT_FOUND", "Order was not found.")
        if str(order.get("assignedProviderId")) != str(provider_id):
            raise deps.DispatchConflict("ORDER_NOT_ASSIGNED_TO_PROVIDER", "Order is not assigned to this provider.")

        updated = deps.update_order_status(
            order_id,
            status,
            store_path=order_store_path,
            provider_store_path=provider_store_path,
            offer_store_path=offer_store_path,
        )
        if updated is None:
            raise deps.DispatchConflict("ORDER_NOT_FOUND", "Order was not found.")
        if deps.normalize_order_status(updated.get("status")) in {"completed", "cancelled"}:
            deps._set_provider_status(provider_id, "online", provider_store_path=provider_store_path)
        else:
            deps._set_provider_status(provider_id, "busy", order_id, provider_store_path=provider_store_path)
        return deps.attach_dispatch_to_order(updated, deps.load_offers(offer_store_path))
