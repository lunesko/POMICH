from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import pytest
from bot.order_store import DispatchConflict, InvalidStatusTransition, ACCEPTED_IDLE_TIMEOUT_SECONDS, accept_offer, confirm_order_price, dispatch_order, expire_stale_dispatch, get_order, get_provider_profile, get_telegram_session, load_offers, load_orders, load_providers, save_order, save_providers, save_telegram_session, update_order_status, update_provider_order_status, update_provider_presence, update_provider_profile

from .support.orders import (
    _provider,
)


def test_save_order_persists_to_json(tmp_path):
    store_path = tmp_path / "orders.json"

    order = save_order({
        "service": "tow",
        "customerLocation": "вул. Собранецька",
        "destination": "СТО",
        "distanceKm": 3.2,
    }, store_path=store_path)

    assert order["id"].startswith("PM-")
    assert len(load_orders(store_path)) == 1
    assert load_orders(store_path)[0]["service"] == "tow"


def test_update_order_status_rejects_invalid_transition(tmp_path):
    store_path = tmp_path / "orders.json"
    order = save_order({"service": "tow"}, store_path=store_path)

    with pytest.raises(InvalidStatusTransition):
        update_order_status(order["id"], "completed", store_path=store_path)


def test_telegram_session_persists_location(tmp_path):
    store_path = tmp_path / "telegram_sessions.json"

    save_telegram_session("42", {"location": {"latitude": 48.62, "longitude": 22.28}}, store_path=store_path)

    session = get_telegram_session("42", store_path=store_path)
    assert session is not None
    assert session["location"]["latitude"] == 48.62


def test_new_provider_requires_otp_before_online(tmp_path):
    store_path = tmp_path / "providers.json"

    created = update_provider_profile(
        "provider-new",
        {
            "name": "Новий партнер",
            "phone": "+380501112233",
            "vehicle": "Iveco Daily",
            "plate": "AA 1122 BB",
            "specialties": ["tow"],
            "serviceRadiusKm": 12,
        },
        store_path=store_path,
    )

    assert created["verificationStatus"] == "unverified"

    with pytest.raises(ValueError, match="provider verification"):
        update_provider_presence(
            "provider-new",
            {"status": "online", "location": {"lat": 48.63, "lng": 22.27}},
            store_path=store_path,
        )

    from bot.order_store import verify_provider_phone_otp

    verified = verify_provider_phone_otp("provider-new", store_path=store_path)
    online = update_provider_presence(
        "provider-new",
        {"status": "online", "location": {"lat": 48.63, "lng": 22.27}},
        store_path=store_path,
    )

    assert verified["verificationStatus"] == "verified"
    assert verified["verification"]["phone"] is True
    assert online["status"] == "online"


def test_incomplete_provider_cannot_go_online_without_plate(tmp_path):
    store_path = tmp_path / "providers.json"
    from bot.order_store import is_provider_profile_complete, update_provider_profile, verify_provider_phone_otp

    created = update_provider_profile(
        "provider-no-plate",
        {
            "name": "Без номера",
            "phone": "+380501112244",
            "vehicle": "Iveco Daily",
            "plate": "",
            "specialties": ["tow"],
            "serviceRadiusKm": 12,
        },
        store_path=store_path,
    )
    # Force empty plate after registration (normalize may leave blank)
    providers = load_providers(store_path)
    for provider in providers:
        if provider.get("id") == "provider-no-plate":
            provider["plate"] = ""
    save_providers(providers, store_path)
    verify_provider_phone_otp("provider-no-plate", store_path=store_path)
    assert is_provider_profile_complete(get_provider_profile("provider-no-plate", store_path)) is False

    with pytest.raises(ValueError, match="complete"):
        update_provider_presence(
            "provider-no-plate",
            {"status": "online", "location": {"lat": 48.63, "lng": 22.27}},
            store_path=store_path,
        )
    assert created["registeredAt"]


def test_customer_can_confirm_partner_price(tmp_path):
    order_path = tmp_path / "orders.json"
    provider_path = tmp_path / "providers.json"
    offer_path = tmp_path / "offers.json"

    save_providers([_provider("p1", 48.6218, 22.2879)], provider_path)
    order = save_order({"service": "tow", "customerCoordinates": {"lat": 48.6208, "lng": 22.2879}}, store_path=order_path)
    dispatch_order(order["id"], order_path, provider_path, offer_path)
    offer = load_offers(offer_path)[0]
    accept_offer(offer["id"], "p1", order_path, provider_path, offer_path, proposed_price=980, price_note="Подача включена")

    confirmed = confirm_order_price(order["id"], order_path, offer_path)

    assert confirmed["status"] == "price_confirmed"
    assert confirmed["partnerProposedPrice"] == 980
    assert confirmed["priceConfirmedAt"]


def test_accepted_idle_timeout_defaults_to_fifteen_minutes():
    assert ACCEPTED_IDLE_TIMEOUT_SECONDS == 900


def test_idle_accepted_order_is_cancelled_after_timeout(tmp_path):
    order_path = tmp_path / "orders.json"
    provider_path = tmp_path / "providers.json"
    offer_path = tmp_path / "offers.json"

    save_providers([_provider("p1", 48.6218, 22.2879)], provider_path)
    order = save_order({"service": "tow", "customerCoordinates": {"lat": 48.6208, "lng": 22.2879}}, store_path=order_path)
    dispatch_order(order["id"], order_path, provider_path, offer_path)
    offer = load_offers(offer_path)[0]
    accept_offer(offer["id"], "p1", order_path, provider_path, offer_path, proposed_price=1200)

    orders = load_orders(order_path)
    stale_at = (datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=ACCEPTED_IDLE_TIMEOUT_SECONDS + 5)).isoformat(timespec="seconds") + "Z"
    orders[0]["acceptedAt"] = stale_at
    orders[0]["updatedAt"] = stale_at
    from bot.order_store import _write_json_atomic

    _write_json_atomic(order_path, orders)

    cancelled = expire_stale_dispatch(order_path, offer_path, provider_path)
    persisted = get_order(order["id"], order_path, provider_path)
    provider = next(item for item in load_providers(provider_path) if item["id"] == "p1")

    assert len(cancelled) == 1
    assert cancelled[0]["id"] == order["id"]
    assert persisted["status"] == "cancelled"
    assert persisted["cancelReason"] == "accepted_idle_timeout"
    assert any(event.get("type") == "ORDER_ACCEPTED_TIMEOUT" for event in persisted.get("dispatchEvents") or [])
    assert provider["status"] == "online"
    assert not provider.get("assignedOrderId")


def test_recent_accepted_order_is_not_cancelled_by_idle_timeout(tmp_path):
    order_path = tmp_path / "orders.json"
    provider_path = tmp_path / "providers.json"
    offer_path = tmp_path / "offers.json"

    save_providers([_provider("p1", 48.6218, 22.2879)], provider_path)
    order = save_order({"service": "tow", "customerCoordinates": {"lat": 48.6208, "lng": 22.2879}}, store_path=order_path)
    dispatch_order(order["id"], order_path, provider_path, offer_path)
    offer = load_offers(offer_path)[0]
    accept_offer(offer["id"], "p1", order_path, provider_path, offer_path, proposed_price=1200)

    cancelled = expire_stale_dispatch(order_path, offer_path, provider_path)
    persisted = get_order(order["id"], order_path, provider_path)

    assert cancelled == []
    assert persisted["status"] == "accepted"
    assert persisted["acceptedIdleTimeoutSeconds"] == ACCEPTED_IDLE_TIMEOUT_SECONDS
    assert persisted.get("acceptedIdleExpiresAt")


def test_confirm_price_rejected_after_accepted_idle_timeout(tmp_path):
    order_path = tmp_path / "orders.json"
    provider_path = tmp_path / "providers.json"
    offer_path = tmp_path / "offers.json"

    save_providers([_provider("p1", 48.6218, 22.2879)], provider_path)
    order = save_order({"service": "tow", "customerCoordinates": {"lat": 48.6208, "lng": 22.2879}}, store_path=order_path)
    dispatch_order(order["id"], order_path, provider_path, offer_path)
    offer = load_offers(offer_path)[0]
    accept_offer(offer["id"], "p1", order_path, provider_path, offer_path, proposed_price=1200)

    orders = load_orders(order_path)
    stale_at = (datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=ACCEPTED_IDLE_TIMEOUT_SECONDS + 5)).isoformat(timespec="seconds") + "Z"
    orders[0]["acceptedAt"] = stale_at
    from bot.order_store import _write_json_atomic

    _write_json_atomic(order_path, orders)

    with pytest.raises(DispatchConflict) as exc_info:
        confirm_order_price(order["id"], order_path, offer_path)
    assert exc_info.value.code == "ORDER_ACCEPTED_TIMEOUT"
    assert get_order(order["id"], order_path, provider_path)["status"] == "cancelled"


def test_first_provider_acceptance_wins_and_loser_gets_conflict(tmp_path):
    order_path = tmp_path / "orders.json"
    provider_path = tmp_path / "providers.json"
    offer_path = tmp_path / "offers.json"

    save_providers(
        [
            _provider("p1", 48.6218, 22.2879),
            _provider("p2", 48.6228, 22.2879),
        ],
        provider_path,
    )
    order = save_order({"service": "tow", "customerCoordinates": {"lat": 48.6208, "lng": 22.2879}}, store_path=order_path)
    dispatch_order(order["id"], order_path, provider_path, offer_path)
    pending_offers = load_offers(offer_path)

    def try_accept(offer):
        try:
            result = accept_offer(offer["id"], offer["providerId"], order_path, provider_path, offer_path, proposed_price=1200)
            return ("accepted", result["provider"]["id"])
        except DispatchConflict as exc:
            return ("conflict", exc.code)

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(try_accept, pending_offers))

    result_counts = Counter(result[0] for result in results)
    persisted_offers = load_offers(offer_path)
    persisted_order = load_orders(order_path)[0]
    providers = {provider["id"]: provider for provider in load_providers(provider_path)}
    accepted_provider_id = next(value for status, value in results if status == "accepted")

    assert result_counts == {"accepted": 1, "conflict": 1}
    assert ("conflict", "ORDER_ALREADY_ACCEPTED") in results
    assert Counter(offer["status"] for offer in persisted_offers) == {"accepted": 1, "lost": 1}
    assert persisted_order["status"] == "accepted"
    assert persisted_order["partnerProposedPrice"] == 1200
    assert persisted_order["assignedProviderId"] == accepted_provider_id
    assert providers[accepted_provider_id]["status"] == "busy"
    assert providers[accepted_provider_id]["assignedOrderId"] == persisted_order["id"]


def test_assigned_provider_drives_order_lifecycle_and_returns_online(tmp_path):
    order_path = tmp_path / "orders.json"
    provider_path = tmp_path / "providers.json"
    offer_path = tmp_path / "offers.json"

    save_providers([_provider("p1", 48.6218, 22.2879)], provider_path)
    order = save_order({"service": "tow", "customerCoordinates": {"lat": 48.6208, "lng": 22.2879}}, store_path=order_path)
    dispatch_order(order["id"], order_path, provider_path, offer_path)
    offer = load_offers(offer_path)[0]
    accept_offer(offer["id"], "p1", order_path, provider_path, offer_path, proposed_price=1500)
    confirm_order_price(order["id"], order_path, offer_path)

    assert update_provider_order_status("p1", order["id"], "en_route", order_path, provider_path, offer_path)["status"] == "en_route"
    assert update_provider_order_status("p1", order["id"], "arrived", order_path, provider_path, offer_path)["status"] == "arrived"
    assert update_provider_order_status("p1", order["id"], "in_progress", order_path, provider_path, offer_path)["status"] == "in_progress"
    assert update_provider_order_status("p1", order["id"], "completed", order_path, provider_path, offer_path)["status"] == "completed"

    provider = load_providers(provider_path)[0]
    assert provider["status"] == "online"
    assert "assignedOrderId" not in provider


def test_cancel_order_releases_assigned_provider(tmp_path):
    order_store = tmp_path / "orders.json"
    provider_store = tmp_path / "providers.json"
    offer_store = tmp_path / "offers.json"
    save_providers([
        {
            "id": "provider-tg-777",
            "name": "Partner",
            "rating": 4.8,
            "vehicle": "Van",
            "plate": "AA 1111 BB",
            "phone": "+380671112233",
            "telegram": "pomich_help_bot",
            "status": "busy",
            "assignedOrderId": "PM-777",
            "etaMinutes": 10,
            "location": {"lat": 48.62, "lng": 22.28},
            "specialties": ["tow"],
            "serviceRadiusKm": 15,
            "verificationStatus": "verified",
        }
    ], store_path=provider_store)
    save_order(
        {
            "id": "PM-777",
            "service": "tow",
            "status": "accepted",
            "assignedProviderId": "provider-tg-777",
        },
        store_path=order_store,
    )

    updated = update_order_status(
        "PM-777",
        "cancelled",
        store_path=order_store,
        provider_store_path=provider_store,
        offer_store_path=offer_store,
    )

    assert updated is not None
    assert updated["status"] == "cancelled"
    provider = load_providers(provider_store)[0]
    assert provider["status"] == "online"
    assert "assignedOrderId" not in provider


def test_save_order_normalizes_customer_comment(tmp_path):
    store_path = tmp_path / "orders.json"

    order = save_order({
        "service": "tow",
        "comment": "  Авто біля входу  ",
    }, store_path=store_path)

    assert order["customerComment"] == "Авто біля входу"
    assert "comment" not in load_orders(store_path)[0]


def test_save_order_truncates_long_customer_comment(tmp_path):
    store_path = tmp_path / "orders.json"
    long_text = "а" * 600

    order = save_order({"service": "tow", "customerComment": long_text}, store_path=store_path)

    assert len(order["customerComment"]) == 500
