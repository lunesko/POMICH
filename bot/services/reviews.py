"""Reviews operations; no dependency on the compatibility facade."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional


@dataclass(frozen=True)
class Dependencies:
    DispatchConflict: Any
    STORE_LOCK: Any
    _append_order_event: Callable[..., Any]
    _apply_star_rating: Callable[..., Any]
    _customer_ids_for_order_history: Callable[..., Any]
    _decrypt_customer_record: Callable[..., Any]
    _default_customer_store_path: Callable[..., Any]
    _default_provider_store_path: Callable[..., Any]
    _default_store_path: Callable[..., Any]
    _encrypt_customer_record: Callable[..., Any]
    _now_iso: Callable[..., Any]
    _order_belongs_to_customer: Callable[..., Any]
    _should_use_sql_store: Callable[..., Any]
    _write_json_atomic: Callable[..., Any]
    enrich_order_for_client: Callable[..., Any]
    get_provider_profile: Callable[..., Any]
    load_customer_profiles: Callable[..., Any]
    load_orders: Callable[..., Any]
    load_providers: Callable[..., Any]
    normalize_order_status: Any
    save_customer_profiles: Callable[..., Any]
    save_providers: Callable[..., Any]
    sql_get_customer: Any
    sql_get_order: Any
    sql_upsert_customer: Any
    sql_upsert_order: Any
    sql_upsert_provider: Any


def _increment_provider_orders_completed(deps: Dependencies, provider_id: str, provider_store_path: Optional[Path] = None) -> None:
    if deps._should_use_sql_store(provider_store_path, deps._default_provider_store_path):
        provider = deps.get_provider_profile(provider_id, provider_store_path)
        if provider is None:
            return
        provider["ordersCompleted"] = int(provider.get("ordersCompleted") or 0) + 1
        provider["updatedAt"] = deps._now_iso()
        deps.sql_upsert_provider(dict(provider))
        return

    providers = deps.load_providers(provider_store_path)
    changed = False
    for provider in providers:
        if str(provider.get("id")) != str(provider_id):
            continue
        provider["ordersCompleted"] = int(provider.get("ordersCompleted") or 0) + 1
        provider["updatedAt"] = deps._now_iso()
        changed = True
        break
    if changed:
        deps.save_providers(providers, provider_store_path)


def _increment_customer_orders_completed(deps: Dependencies, customer_id: str, customer_store_path: Optional[Path] = None) -> None:
    if deps._should_use_sql_store(customer_store_path, deps._default_customer_store_path):
        found = deps.sql_get_customer(str(customer_id))
        if found is None:
            return
        profile = deps._decrypt_customer_record(found)
        profile["ordersCompleted"] = int(profile.get("ordersCompleted") or 0) + 1
        profile["updatedAt"] = deps._now_iso()
        deps.sql_upsert_customer(deps._encrypt_customer_record(profile))
        return

    path = customer_store_path
    profiles = deps.load_customer_profiles(path)
    changed = False
    for profile in profiles:
        if str(profile.get("id")) != str(customer_id):
            continue
        profile["ordersCompleted"] = int(profile.get("ordersCompleted") or 0) + 1
        profile["updatedAt"] = deps._now_iso()
        changed = True
        break
    if changed:
        deps.save_customer_profiles(profiles, path)


def _apply_star_rating(deps: Dependencies, target: Dict[str, Any], stars: int) -> None:
    rating_count = int(target.get("ratingCount") or 0)
    current = float(target.get("rating") or 0)
    if rating_count <= 0:
        target["rating"] = float(stars)
        target["ratingCount"] = 1
    else:
        target["rating"] = round(((current * rating_count) + float(stars)) / (rating_count + 1), 2)
        target["ratingCount"] = rating_count + 1


def submit_order_review(deps: Dependencies,
    order_id: str,
    *,
    author_role: str,
    rating: int,
    comment: str = "",
    author_id: str = "",
    store_path: Optional[Path] = None,
    provider_store_path: Optional[Path] = None,
    customer_store_path: Optional[Path] = None,
) -> Dict[str, Any]:
    role = str(author_role or "").strip().lower()
    if role not in {"customer", "partner"}:
        raise ValueError("invalid_review_role")
    try:
        stars = int(rating)
    except (TypeError, ValueError) as exc:
        raise ValueError("invalid_review_rating") from exc
    if stars < 1 or stars > 5:
        raise ValueError("invalid_review_rating")
    note = str(comment or "").strip()[:500]

    with deps.STORE_LOCK:
        use_sql = deps._should_use_sql_store(store_path, deps._default_store_path)
        if use_sql:
            order = deps.sql_get_order(str(order_id))
            orders: Optional[List[Dict[str, Any]]] = None
            path: Optional[Path] = None
        else:
            path = store_path or deps._default_store_path()
            orders = deps.load_orders(path)
            order = next((item for item in orders if str(item.get("id")) == str(order_id)), None)

        if order is None:
            raise deps.DispatchConflict("ORDER_NOT_FOUND", "Order was not found.")
        if deps.normalize_order_status(order.get("status")) != "completed":
            raise deps.DispatchConflict("ORDER_NOT_COMPLETED", "Reviews are available only for completed orders.")

        review_key = "customerReview" if role == "customer" else "partnerReview"
        if isinstance(order.get(review_key), dict) and order[review_key].get("rating") is not None:
            raise deps.DispatchConflict("REVIEW_ALREADY_SUBMITTED", "Review already submitted for this order.")

        if role == "customer":
            if author_id:
                aliases = deps._customer_ids_for_order_history(str(author_id), customer_store_path)
                if not any(deps._order_belongs_to_customer(order, needle) for needle in aliases):
                    raise deps.DispatchConflict("REVIEW_FORBIDDEN", "Customer cannot review this order.")
        else:
            provider_id = str(order.get("assignedProviderId") or order.get("partnerId") or "").strip()
            if author_id and provider_id and str(author_id) != provider_id:
                raise deps.DispatchConflict("REVIEW_FORBIDDEN", "Partner cannot review this order.")

        now = deps._now_iso()
        review_payload = {
            "rating": stars,
            "comment": note,
            "at": now,
            "authorId": str(author_id or "").strip() or None,
            "authorRole": role,
        }

        if use_sql:
            # Re-read immediately before write so a concurrent opposite-role review is not clobbered.
            latest = deps.sql_get_order(str(order_id))
            if latest is None:
                raise deps.DispatchConflict("ORDER_NOT_FOUND", "Order was not found.")
            if deps.normalize_order_status(latest.get("status")) != "completed":
                raise deps.DispatchConflict("ORDER_NOT_COMPLETED", "Reviews are available only for completed orders.")
            if isinstance(latest.get(review_key), dict) and latest[review_key].get("rating") is not None:
                raise deps.DispatchConflict("REVIEW_ALREADY_SUBMITTED", "Review already submitted for this order.")
            order = dict(latest)
            order[review_key] = review_payload
            order["updatedAt"] = now
            deps._append_order_event(order, "REVIEW_SUBMITTED", now, {"role": role, "rating": stars})
            deps.sql_upsert_order(order)
        else:
            order[review_key] = review_payload
            order["updatedAt"] = now
            deps._append_order_event(order, "REVIEW_SUBMITTED", now, {"role": role, "rating": stars})
            assert path is not None and orders is not None
            deps._write_json_atomic(path, orders)

        if role == "customer":
            provider_id = str(order.get("assignedProviderId") or order.get("partnerId") or "").strip()
            if provider_id:
                provider = deps.get_provider_profile(provider_id, provider_store_path)
                if provider is not None:
                    deps._apply_star_rating(provider, stars)
                    provider["updatedAt"] = now
                    if deps._should_use_sql_store(provider_store_path, deps._default_provider_store_path):
                        deps.sql_upsert_provider(dict(provider))
                    else:
                        providers = deps.load_providers(provider_store_path)
                        for index, item in enumerate(providers):
                            if str(item.get("id")) != provider_id:
                                continue
                            providers[index] = provider
                            break
                        deps.save_providers(providers, provider_store_path)
        else:
            customer_id = str(order.get("customerId") or "").strip()
            if customer_id:
                if deps._should_use_sql_store(customer_store_path, deps._default_customer_store_path):
                    found = deps.sql_get_customer(customer_id)
                    if found is not None:
                        profile = deps._decrypt_customer_record(found)
                        deps._apply_star_rating(profile, stars)
                        profile["updatedAt"] = now
                        deps.sql_upsert_customer(deps._encrypt_customer_record(profile))
                else:
                    profiles = deps.load_customer_profiles(customer_store_path)
                    for profile in profiles:
                        if str(profile.get("id")) != customer_id:
                            continue
                        deps._apply_star_rating(profile, stars)
                        profile["updatedAt"] = now
                        break
                    deps.save_customer_profiles(profiles, customer_store_path)

        return deps.enrich_order_for_client(order, provider_store_path, customer_store_path)
