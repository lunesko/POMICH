from datetime import datetime, timedelta, timezone
import pytest
from bot.dispatch_config import DISPATCH_WAVE1_SIZE, DISPATCH_WAVE2_SIZE
from bot.order_store import DispatchConflict, OFFER_TIMEOUT_SECONDS, accept_offer, apply_provider_presence_ttl, confirm_order_price, decline_offer, dispatch_order, expire_stale_dispatch, get_order, get_provider_offers, load_offers, load_orders, load_providers, nearby_searching_orders, redispatch_searching_orders_for_provider, save_order, save_offers, save_providers, update_order_status, update_provider_order_status, update_provider_presence

from .support.orders import (
    _provider,
)


def test_nearby_searching_orders_excludes_completed_and_cancelled(tmp_path):
    store_path = tmp_path / "orders.json"
    coords = {"lat": 48.62, "lng": 22.28}
    save_order(
        {"id": "PM-OPEN", "service": "tow", "status": "searching", "customerCoordinates": coords},
        store_path=store_path,
    )
    save_order(
        {"id": "PM-DONE", "service": "tow", "status": "completed", "customerCoordinates": coords},
        store_path=store_path,
    )
    save_order(
        {"id": "PM-CANCEL", "service": "tow", "status": "cancelled", "customerCoordinates": coords},
        store_path=store_path,
    )
    save_order(
        {
            "id": "PM-TAKEN",
            "service": "tow",
            "status": "searching",
            "assignedProviderId": "p1",
            "customerCoordinates": coords,
        },
        store_path=store_path,
    )

    nearby = nearby_searching_orders(48.62, 22.28, radius_km=20, order_store_path=store_path)
    assert {item["id"] for item in nearby} == {"PM-OPEN"}


def test_provider_presence_updates_and_persists(tmp_path):
    store_path = tmp_path / "providers.json"

    updated = update_provider_presence(
        "provider-oleksandr",
        {"status": "offline", "location": {"lat": 48.63, "lng": 22.27}},
        store_path=store_path,
    )

    providers = load_providers(store_path)
    assert updated["status"] == "offline"
    assert providers[0]["id"] == "provider-oleksandr"
    assert providers[0]["status"] == "offline"


def test_provider_presence_ttl_expires_online_provider():
    stale_provider = {
        "id": "provider-stale",
        "status": "online",
        "lastSeenAt": (datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=90)).isoformat(timespec="seconds"),
    }

    providers = apply_provider_presence_ttl([stale_provider])

    assert providers[0]["status"] == "offline"
    assert providers[0]["stale"] is True


def test_dispatch_wave1_sends_three_nearest_eligible_offers(tmp_path):
    order_path = tmp_path / "orders.json"
    provider_path = tmp_path / "providers.json"
    offer_path = tmp_path / "offers.json"
    pickup = {"lat": 48.6208, "lng": 22.2879}
    stale_time = (datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=120)).isoformat(timespec="seconds")

    save_providers(
        [
            _provider("p1", 48.6218, 22.2879),
            _provider("p2", 48.6228, 22.2879),
            _provider("p3", 48.6238, 22.2879),
            _provider("p4", 48.6248, 22.2879),
            _provider("p5", 48.6258, 22.2879),
            _provider("p6", 48.6268, 22.2879),
            _provider("wrong-service", 48.621, 22.2879, specialties=["fuel"]),
            _provider("offline", 48.621, 22.2879, status="offline"),
            _provider("busy", 48.621, 22.2879, assigned_order_id="PM-BUSY"),
            _provider("stale", 48.621, 22.2879, last_seen_at=stale_time),
        ],
        provider_path,
    )
    order = save_order({"service": "tow", "customerCoordinates": pickup}, store_path=order_path)

    dispatched = dispatch_order(order["id"], order_path, provider_path, offer_path)
    offers = load_offers(offer_path)

    assert dispatched is not None
    assert dispatched["dispatchState"] == "OFFERS_SENT"
    assert dispatched["dispatchInfo"]["offersSent"] == DISPATCH_WAVE1_SIZE
    assert dispatched["dispatchInfo"]["wave"] == 1
    assert dispatched["dispatchInfo"]["serviceInitialRadiusKm"] == 30  # tow
    assert [offer["providerId"] for offer in offers] == ["p1", "p2", "p3"]
    assert all(offer["status"] == "pending" for offer in offers)


def test_dispatch_wave2_adds_next_providers_after_wait(tmp_path):
    order_path = tmp_path / "orders.json"
    provider_path = tmp_path / "providers.json"
    offer_path = tmp_path / "offers.json"
    pickup = {"lat": 48.6208, "lng": 22.2879}

    save_providers(
        [
            _provider("p1", 48.6218, 22.2879, specialties=["wheel"]),
            _provider("p2", 48.6228, 22.2879, specialties=["wheel"]),
            _provider("p3", 48.6238, 22.2879, specialties=["wheel"]),
            _provider("p4", 48.6248, 22.2879, specialties=["wheel"]),
            _provider("p5", 48.6258, 22.2879, specialties=["wheel"]),
            _provider("p6", 48.6268, 22.2879, specialties=["wheel"]),
            _provider("p7", 48.6278, 22.2879, specialties=["wheel"]),
            _provider("p8", 48.6288, 22.2879, specialties=["wheel"]),
        ],
        provider_path,
    )
    order = save_order({"service": "wheel", "customerCoordinates": pickup}, store_path=order_path)
    first = dispatch_order(order["id"], order_path, provider_path, offer_path)
    assert first["dispatchInfo"]["offersSent"] == DISPATCH_WAVE1_SIZE
    assert first["dispatchInfo"]["wave"] == 1
    assert first["dispatchInfo"]["serviceInitialRadiusKm"] == 10
    assert first["dispatchInfo"]["nextWaveAt"]

    # Force wave due immediately.
    orders = load_orders(order_path)
    target = next(item for item in orders if item["id"] == order["id"])
    past = (datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=1)).isoformat(timespec="seconds") + "Z"
    target["dispatchInfo"]["nextWaveAt"] = past
    from bot.order_store import _write_json_atomic

    _write_json_atomic(order_path, orders)

    expire_stale_dispatch(order_path, offer_path, provider_path)
    offers = load_offers(offer_path)
    second = get_order(order["id"], order_path)

    assert second["dispatchInfo"]["wave"] == 2
    assert second["dispatchInfo"]["offersSent"] == DISPATCH_WAVE1_SIZE + DISPATCH_WAVE2_SIZE
    assert len(offers) == DISPATCH_WAVE1_SIZE + DISPATCH_WAVE2_SIZE
    assert {offer["providerId"] for offer in offers} == {"p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"}


def test_provider_offer_payload_includes_customer_coordinates(tmp_path):
    order_path = tmp_path / "orders.json"
    provider_path = tmp_path / "providers.json"
    offer_path = tmp_path / "offers.json"
    pickup = {"lat": 48.6208, "lng": 22.2879}

    save_providers([_provider("p1", 48.6218, 22.2879)], provider_path)
    order = save_order(
        {
            "service": "tow",
            "customerCoordinates": pickup,
            "customerLocation": "вул. Швабська, Ужгород",
            "vehicleState": "Не заводиться",
        },
        store_path=order_path,
    )
    dispatch_order(order["id"], order_path, provider_path, offer_path)

    offers = get_provider_offers("p1", order_path, offer_path)

    assert len(offers) == 1
    assert offers[0]["customerCoordinates"] == pickup
    assert offers[0]["approximateLocation"] == "вул. Швабська, Ужгород"
    assert offers[0]["vehicleState"] == "Не заводиться"
    assert offers[0]["distanceKm"] > 0
    assert offers[0]["etaMinutes"] >= 2


def test_dispatch_reports_no_providers_when_none_are_eligible(tmp_path):
    order_path = tmp_path / "orders.json"
    provider_path = tmp_path / "providers.json"
    offer_path = tmp_path / "offers.json"

    save_providers([_provider("tow-only", 48.621, 22.2879, specialties=["tow"])], provider_path)
    order = save_order({"service": "fuel", "customerCoordinates": {"lat": 48.6208, "lng": 22.2879}}, store_path=order_path)

    dispatched = dispatch_order(order["id"], order_path, provider_path, offer_path)

    assert dispatched is not None
    assert dispatched["dispatchState"] == "NO_PROVIDERS_AVAILABLE"
    assert dispatched["dispatchInfo"]["offersSent"] == 0
    assert load_offers(offer_path) == []


def test_dispatch_skips_unverified_provider(tmp_path):
    order_path = tmp_path / "orders.json"
    provider_path = tmp_path / "providers.json"
    offer_path = tmp_path / "offers.json"
    unverified = _provider("pending-provider", 48.621, 22.2879)
    unverified["verificationStatus"] = "pending"

    save_providers([unverified], provider_path)
    order = save_order({"service": "tow", "customerCoordinates": {"lat": 48.6208, "lng": 22.2879}}, store_path=order_path)

    dispatched = dispatch_order(order["id"], order_path, provider_path, offer_path)

    assert dispatched is not None
    assert dispatched["dispatchState"] == "NO_PROVIDERS_AVAILABLE"
    assert dispatched["dispatchInfo"]["eligibleProviders"] == 0


def test_dispatch_reoffers_provider_after_offer_expires(tmp_path, monkeypatch):
    order_path = tmp_path / "orders.json"
    provider_path = tmp_path / "providers.json"
    offer_path = tmp_path / "offers.json"
    pickup = {"lat": 48.6208, "lng": 22.2879}

    save_providers([_provider("p1", 48.6218, 22.2879)], provider_path)
    order = save_order({"service": "tow", "customerCoordinates": pickup}, store_path=order_path)
    dispatch_order(order["id"], order_path, provider_path, offer_path)
    offers = load_offers(offer_path)
    assert len(offers) == 1
    offers[0]["status"] = "expired"
    save_offers(offers, offer_path)

    redispatched = dispatch_order(order["id"], order_path, provider_path, offer_path)
    active_offers = [offer for offer in load_offers(offer_path) if offer.get("status") == "pending"]

    assert redispatched is not None
    assert redispatched["dispatchState"] == "OFFERS_SENT"
    assert len(active_offers) == 1
    assert active_offers[0]["providerId"] == "p1"


def test_dispatch_keeps_offers_sent_when_pending_already_exist(tmp_path):
    order_path = tmp_path / "orders.json"
    provider_path = tmp_path / "providers.json"
    offer_path = tmp_path / "offers.json"
    pickup = {"lat": 48.6208, "lng": 22.2879}

    save_providers([_provider("p1", 48.6218, 22.2879)], provider_path)
    order = save_order({"service": "tow", "customerCoordinates": pickup}, store_path=order_path)
    first = dispatch_order(order["id"], order_path, provider_path, offer_path)
    assert first is not None
    assert first["dispatchState"] == "OFFERS_SENT"
    pending_before = [offer for offer in load_offers(offer_path) if offer.get("status") == "pending"]
    assert len(pending_before) == 1

    # Block new candidates (same provider already offered as pending) — must not flip to NO_PROVIDERS.
    again = dispatch_order(order["id"], order_path, provider_path, offer_path)
    assert again is not None
    assert again["dispatchState"] == "OFFERS_SENT"
    pending_after = [offer for offer in load_offers(offer_path) if offer.get("status") == "pending"]
    assert len(pending_after) == 1


def test_expire_stale_auto_retries_exhausted_searching_offers(tmp_path, monkeypatch):
    order_path = tmp_path / "orders.json"
    provider_path = tmp_path / "providers.json"
    offer_path = tmp_path / "offers.json"
    monkeypatch.setenv("POMICH_ORDER_STORE_PATH", str(order_path))
    monkeypatch.setenv("POMICH_PROVIDER_STORE_PATH", str(provider_path))
    monkeypatch.setenv("POMICH_OFFER_STORE_PATH", str(offer_path))
    pickup = {"lat": 48.6208, "lng": 22.2879}

    save_providers([_provider("p1", 48.6218, 22.2879)], provider_path)
    order = save_order({"service": "tow", "customerCoordinates": pickup}, store_path=order_path)
    dispatch_order(order["id"], order_path, provider_path, offer_path)
    offers = load_offers(offer_path)
    assert len(offers) == 1
    offers[0]["expiresAt"] = (datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=5)).isoformat(timespec="seconds") + "Z"
    save_offers(offers, offer_path)

    expire_stale_dispatch(order_path, offer_path, provider_path)
    pending = [offer for offer in load_offers(offer_path) if offer.get("status") == "pending"]
    refreshed = get_order(order["id"], order_path, provider_path)

    assert refreshed is not None
    assert refreshed["status"] == "searching"
    assert int((refreshed.get("dispatchInfo") or {}).get("autoRetryCount") or 0) >= 1
    assert len(pending) == 1


def test_redispatch_offers_searching_orders_when_provider_goes_online(tmp_path, monkeypatch):
    order_path = tmp_path / "orders.json"
    provider_path = tmp_path / "providers.json"
    offer_path = tmp_path / "offers.json"
    monkeypatch.setenv("POMICH_ORDER_STORE_PATH", str(order_path))
    monkeypatch.setenv("POMICH_PROVIDER_STORE_PATH", str(provider_path))
    monkeypatch.setenv("POMICH_OFFER_STORE_PATH", str(offer_path))
    pickup = {"lat": 48.6208, "lng": 22.2879}

    save_providers([_provider("p1", 48.6218, 22.2879, status="offline")], provider_path)
    order = save_order({"service": "tow", "customerCoordinates": pickup}, store_path=order_path)
    initial = dispatch_order(order["id"], order_path, provider_path, offer_path)

    assert initial is not None
    assert initial["dispatchState"] == "NO_PROVIDERS_AVAILABLE"
    assert load_offers(offer_path) == []

    update_provider_presence(
        "p1",
        {"status": "online", "location": {"lat": 48.6218, "lng": 22.2879}},
        store_path=provider_path,
    )

    offers = load_offers(offer_path)
    assert len(offers) == 1
    assert offers[0]["providerId"] == "p1"
    assert offers[0]["orderId"] == order["id"]


def test_accept_offer_requires_proposed_price(tmp_path):
    order_path = tmp_path / "orders.json"
    provider_path = tmp_path / "providers.json"
    offer_path = tmp_path / "offers.json"

    save_providers([_provider("p1", 48.6218, 22.2879)], provider_path)
    order = save_order({"service": "tow", "customerCoordinates": {"lat": 48.6208, "lng": 22.2879}}, store_path=order_path)
    dispatch_order(order["id"], order_path, provider_path, offer_path)
    offer = load_offers(offer_path)[0]

    with pytest.raises(DispatchConflict) as exc_info:
        accept_offer(offer["id"], "p1", order_path, provider_path, offer_path)
    assert exc_info.value.code == "PRICE_REQUIRED"


def test_accept_offer_exposes_partner_price_and_identity_for_customer(tmp_path):
    order_path = tmp_path / "orders.json"
    provider_path = tmp_path / "providers.json"
    offer_path = tmp_path / "offers.json"

    partner = _provider("p1", 48.6218, 22.2879)
    partner["name"] = "Віталій"
    save_providers([partner], provider_path)
    order = save_order({"service": "tow", "customerCoordinates": {"lat": 48.6208, "lng": 22.2879}}, store_path=order_path)
    dispatch_order(order["id"], order_path, provider_path, offer_path)
    offer = load_offers(offer_path)[0]

    accepted = accept_offer(offer["id"], "p1", order_path, provider_path, offer_path, proposed_price=1500)
    polled = get_order(order["id"], order_path, provider_path)

    assert accepted["order"]["status"] == "accepted"
    assert accepted["order"]["partnerProposedPrice"] == 1500
    assert accepted["order"]["assignedProvider"]["name"] == "Віталій"
    assert polled is not None
    assert polled["status"] == "accepted"
    assert polled["partnerProposedPrice"] == 1500
    assert polled["providerName"] == "Віталій"
    assert polled["assignedProvider"]["name"] == "Віталій"


def test_offer_timeout_default_allows_partner_to_enter_price():
    assert OFFER_TIMEOUT_SECONDS >= 60


def test_provider_can_decline_offer_and_cannot_accept_it_later(tmp_path):
    order_path = tmp_path / "orders.json"
    provider_path = tmp_path / "providers.json"
    offer_path = tmp_path / "offers.json"

    save_providers([_provider("p1", 48.6218, 22.2879)], provider_path)
    order = save_order({"service": "tow", "customerCoordinates": {"lat": 48.6208, "lng": 22.2879}}, store_path=order_path)
    dispatch_order(order["id"], order_path, provider_path, offer_path)
    offer = load_offers(offer_path)[0]

    declined = decline_offer(offer["id"], "p1", order_path, offer_path)

    assert declined["status"] == "declined"
    assert get_provider_offers("p1", order_path, offer_path) == []
    with pytest.raises(DispatchConflict) as exc_info:
        accept_offer(offer["id"], "p1", order_path, provider_path, offer_path, proposed_price=1200)
    assert exc_info.value.code == "OFFER_DECLINED"

    # Presence heartbeat / redispatch must not recreate the same offer for this partner.
    redispatched = dispatch_order(order["id"], order_path, provider_path, offer_path)
    assert redispatched is not None
    assert get_provider_offers("p1", order_path, offer_path) == []
    assert all(
        not (item.get("providerId") == "p1" and item.get("status") == "pending")
        for item in load_offers(offer_path)
    )


def test_expired_offer_disappears_from_provider_queue(tmp_path):
    order_path = tmp_path / "orders.json"
    provider_path = tmp_path / "providers.json"
    offer_path = tmp_path / "offers.json"

    save_providers([_provider("p1", 48.6218, 22.2879)], provider_path)
    order = save_order({"service": "tow", "customerCoordinates": {"lat": 48.6208, "lng": 22.2879}}, store_path=order_path)
    dispatch_order(order["id"], order_path, provider_path, offer_path)
    offers = load_offers(offer_path)
    offers[0]["expiresAt"] = (datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=1)).isoformat(timespec="seconds")
    save_offers(offers, offer_path)

    assert get_provider_offers("p1", order_path, offer_path) == []
    assert load_offers(offer_path)[0]["status"] == "expired"


def test_completed_order_does_not_reappear_in_provider_offers(tmp_path):
    order_path = tmp_path / "orders.json"
    provider_path = tmp_path / "providers.json"
    offer_path = tmp_path / "offers.json"

    save_providers([_provider("p1", 48.6218, 22.2879)], provider_path)
    order = save_order({"service": "tow", "customerCoordinates": {"lat": 48.6208, "lng": 22.2879}}, store_path=order_path)
    dispatch_order(order["id"], order_path, provider_path, offer_path)
    offer = load_offers(offer_path)[0]
    accept_offer(offer["id"], "p1", order_path, provider_path, offer_path, proposed_price=1200)
    confirm_order_price(order["id"], order_path, offer_path)

    update_provider_order_status("p1", order["id"], "en_route", order_path, provider_path, offer_path)
    update_provider_order_status("p1", order["id"], "arrived", order_path, provider_path, offer_path)
    update_provider_order_status("p1", order["id"], "in_progress", order_path, provider_path, offer_path)
    update_provider_order_status("p1", order["id"], "completed", order_path, provider_path, offer_path)

    assert get_provider_offers("p1", order_path, offer_path) == []
    redispatch_searching_orders_for_provider("p1", order_path, provider_path, offer_path)
    assert get_provider_offers("p1", order_path, offer_path) == []
    assert all(item.get("status") != "pending" for item in load_offers(offer_path) if item.get("orderId") == order["id"])


def test_nearby_searching_orders_exclude_terminal_and_assigned(tmp_path):
    import json

    order_path = tmp_path / "orders.json"
    pickup = {"lat": 48.6208, "lng": 22.2879}
    live = save_order({"service": "tow", "customerCoordinates": pickup}, store_path=order_path)
    cancelled = save_order({"service": "tow", "customerCoordinates": pickup}, store_path=order_path)
    update_order_status(cancelled["id"], "cancelled", store_path=order_path)
    accepted = save_order({"service": "tow", "customerCoordinates": pickup}, store_path=order_path)
    update_order_status(accepted["id"], "accepted", store_path=order_path)

    orders = load_orders(order_path)
    orders.extend(
        [
            {
                "id": "PM-DONE",
                "status": "completed",
                "service": "tow",
                "customerCoordinates": pickup,
            },
            {
                "id": "PM-EMPTY",
                "service": "tow",
                "customerCoordinates": pickup,
            },
            {
                "id": "PM-ASSIGNED",
                "status": "searching",
                "service": "tow",
                "assignedProviderId": "p1",
                "customerCoordinates": pickup,
            },
        ]
    )
    order_path.write_text(json.dumps(orders), encoding="utf-8")

    pins = nearby_searching_orders(48.6208, 22.2879, radius_km=20, order_store_path=order_path)
    ids = {item["id"] for item in pins}
    assert ids == {live["id"]}
    assert all(item["status"] == "searching" for item in pins)


def test_provider_offer_includes_customer_comment(tmp_path):
    order_path = tmp_path / "orders.json"
    offer_path = tmp_path / "offers.json"
    provider_path = tmp_path / "providers.json"
    pickup = {"lat": 48.6208, "lng": 22.2879}

    save_providers([_provider("p1", 48.6218, 22.2879)], provider_path)
    order = save_order({
        "service": "tow",
        "status": "searching",
        "customerLocation": "вул. Швабська",
        "customerCoordinates": pickup,
        "customerComment": "Паркінг -1, біля ліфта",
    }, store_path=order_path)

    dispatch_order(order["id"], order_path, provider_path, offer_path)
    offers = get_provider_offers("p1", order_path, offer_path)

    assert len(offers) == 1
    assert offers[0]["customerComment"] == "Паркінг -1, біля ліфта"
