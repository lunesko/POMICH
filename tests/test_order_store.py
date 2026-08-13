from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pytest

from bot.order_store import (
    DispatchConflict,
    InvalidStatusTransition,
    MAX_PROVIDER_OFFERS,
    OFFER_TIMEOUT_SECONDS,
    accept_offer,
    apply_provider_presence_ttl,
    confirm_order_price,
    decline_offer,
    dispatch_order,
    enrich_order_for_client,
    get_order,
    get_provider_offers,
    get_telegram_session,
    load_offers,
    load_orders,
    load_providers,
    partner_telegram_user_ids_for_order,
    resolve_provider_telegram_user_id,
    review_provider_verification,
    save_order,
    save_offers,
    save_providers,
    save_telegram_session,
    submit_provider_verification,
    update_order_status,
    update_provider_order_status,
    update_provider_presence,
    update_provider_profile,
    update_customer_profile,
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


def test_update_order_status_adds_history(tmp_path):
    store_path = tmp_path / "orders.json"
    order = save_order({"service": "tow"}, store_path=store_path)

    updated = update_order_status(order["id"], "accepted", store_path=store_path)

    assert updated is not None
    assert updated["status"] == "accepted"
    assert updated["statusHistory"][-1]["status"] == "accepted"


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


def test_provider_profile_registration_updates_capabilities(tmp_path):
    store_path = tmp_path / "providers.json"

    updated = update_provider_profile(
        "provider-oleksandr",
        {
            "name": "Олександр",
            "phone": "+380671112233",
            "vehicle": "Volkswagen Transporter",
            "plate": "AO 1248 CH",
            "specialties": ["tow", "fuel", "fuel", "unknown"],
            "serviceRadiusKm": 12,
        },
        store_path=store_path,
    )

    assert updated["registeredAt"]
    assert updated["specialties"] == ["tow", "fuel"]
    assert updated["serviceRadiusKm"] == 12


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


def test_unregistered_provider_cannot_go_online(tmp_path):
    store_path = tmp_path / "providers.json"

    with pytest.raises(ValueError):
        update_provider_presence(
            "provider-new",
            {"status": "online", "location": {"lat": 48.63, "lng": 22.27}},
            store_path=store_path,
        )


def test_provider_presence_ttl_expires_online_provider():
    stale_provider = {
        "id": "provider-stale",
        "status": "online",
        "lastSeenAt": (datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=90)).isoformat(timespec="seconds"),
    }

    providers = apply_provider_presence_ttl([stale_provider])

    assert providers[0]["status"] == "offline"
    assert providers[0]["stale"] is True


def _provider(provider_id, lat, lng, specialties=None, status="online", radius=50, assigned_order_id=None, last_seen_at=None):
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds")
    payload = {
        "id": provider_id,
        "name": provider_id,
        "rating": 4.8,
        "vehicle": "Service van",
        "plate": "TEST",
        "phone": "+380000000000",
        "telegram": "pomich_help_bot",
        "status": status,
        "etaMinutes": 10,
        "location": {"lat": lat, "lng": lng},
        "specialties": specialties or ["tow"],
        "serviceRadiusKm": radius,
        "verificationStatus": "verified",
        "verification": {
            "identityDocument": True,
            "driverLicense": True,
            "vehicleRegistration": True,
            "serviceProof": True,
            "selfieCheck": True,
            "backgroundCheck": "passed",
        },
        "registeredAt": now,
        "profileUpdatedAt": now,
        "lastSeenAt": last_seen_at or now,
        "lastLocationAt": last_seen_at or now,
        "updatedAt": last_seen_at or now,
    }
    if assigned_order_id:
        payload["assignedOrderId"] = assigned_order_id
    return payload


def test_dispatch_creates_max_five_sorted_eligible_offers(tmp_path):
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
    assert dispatched["dispatchInfo"]["offersSent"] == MAX_PROVIDER_OFFERS
    assert [offer["providerId"] for offer in offers] == ["p1", "p2", "p3", "p4", "p5"]
    assert all(offer["status"] == "pending" for offer in offers)


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


def test_customer_profile_does_not_auto_verify_on_save(tmp_path):
    store_path = tmp_path / "customers.json"
    created = update_customer_profile(
        "customer-vitaliy",
        {"name": "Виталий", "phone": "+380661007434"},
        store_path=store_path,
    )

    assert created["verificationStatus"] == "unverified"
    assert created["verification"]["phone"] is False


def test_duplicate_phone_registration_rejected(tmp_path):
    store_path = tmp_path / "customers.json"
    update_customer_profile(
        "tg-829741830",
        {"name": "Vitaliy", "phone": "+380661007434", "city": "Ужгород"},
        store_path=store_path,
    )

    with pytest.raises(ValueError, match="phone_already_registered"):
        update_customer_profile(
            "guest-browser-1",
            {"name": "Інший", "phone": "+380661007434", "city": "Київ"},
            store_path=store_path,
        )


def test_duplicate_provider_phone_registration_rejected(tmp_path):
    from bot.order_store import update_provider_profile

    provider_path = tmp_path / "providers.json"
    update_provider_profile(
        "provider-a",
        {
            "name": "Партнер А",
            "phone": "+380671112233",
            "city": "Ужгород",
            "vehicle": "Ford Transit",
            "plate": "АА1234ВВ",
            "specialties": ["tow"],
            "serviceRadiusKm": 15,
            "registeredAt": "2026-08-12T12:00:00Z",
        },
        store_path=provider_path,
    )

    with pytest.raises(ValueError, match="phone_already_registered"):
        update_provider_profile(
            "provider-b",
            {
                "name": "Партнер Б",
                "phone": "+380671112233",
                "city": "Львів",
                "vehicle": "Mercedes Sprinter",
                "plate": "ВС5678АА",
                "specialties": ["battery"],
                "serviceRadiusKm": 10,
                "registeredAt": "2026-08-12T12:05:00Z",
            },
            store_path=provider_path,
        )


def test_provider_registration_links_customer_for_phone_login_restore(tmp_path, monkeypatch):
    from bot.order_store import (
        build_user_account_status,
        find_registered_customer_by_phone,
        update_provider_profile,
    )

    customer_path = tmp_path / "customers.json"
    provider_path = tmp_path / "providers.json"
    monkeypatch.setattr("bot.order_store._default_customer_store_path", lambda: customer_path)
    monkeypatch.setattr("bot.order_store._default_provider_store_path", lambda: provider_path)

    update_customer_profile(
        "guest-vitaliy",
        {"name": "Віталій", "phone": "+380661007434", "city": "Ужгород"},
        store_path=customer_path,
    )
    update_provider_profile(
        "provider-guest-vitaliy",
        {
            "name": "Віталій",
            "phone": "+380661007434",
            "city": "Ужгород",
            "vehicle": "Volkswagen Crafter",
            "plate": "BX5874HX",
            "specialties": ["tow", "fuel"],
            "serviceRadiusKm": 15,
        },
        store_path=provider_path,
    )

    restored = find_registered_customer_by_phone("+380661007434", store_path=customer_path)
    assert restored is not None
    assert restored["id"] == "guest-vitaliy"

    status = build_user_account_status("guest-vitaliy", store_path=customer_path)
    assert status["providerRegistered"] is True
    assert status["linkedProviderId"] == "provider-guest-vitaliy"


def test_guest_inherits_verification_from_tg_profile_by_phone(tmp_path, monkeypatch):
    from bot import otp_verification
    from bot.order_store import get_customer_profile

    store_path = tmp_path / "customers.json"
    otp_path = tmp_path / "otp_codes.json"
    monkeypatch.setattr("bot.order_store._default_customer_store_path", lambda: store_path)
    monkeypatch.setenv("POMICH_OTP_SECRET", "test-otp-secret")
    monkeypatch.setenv("POMICH_RUNTIME", "dev")
    monkeypatch.setattr(otp_verification, "_default_otp_store_path", lambda: otp_path)
    monkeypatch.setattr(otp_verification, "_generate_otp_code", lambda: "654321")
    monkeypatch.setattr(otp_verification, "_send_telegram_otp", lambda chat_id, code: None)

    # Guest may hold the same phone before becoming a registered client (placeholder name).
    update_customer_profile(
        "guest-browser-1",
        {"phone": "+380661007434"},
        store_path=store_path,
    )
    update_customer_profile(
        "tg-829741830",
        {"name": "Vitaliy", "phone": "+380661007434"},
        store_path=store_path,
    )
    otp_verification.send_customer_verification_code("tg-829741830", "telegram", customer_store_path=store_path)
    otp_verification.confirm_customer_verification_code("tg-829741830", "654321", customer_store_path=store_path)

    loaded = get_customer_profile("guest-browser-1", store_path=store_path)
    assert loaded["verificationStatus"] == "verified"
    assert loaded["verification"]["phone"] is True


def test_default_customer_profile_has_empty_city(tmp_path):
    from bot.order_store import get_customer_profile

    profile = get_customer_profile("guest-new-user", store_path=tmp_path / "customers.json")
    assert profile["city"] == ""


def test_resolve_provider_telegram_user_id_from_linked_customer(tmp_path):
    customer_store = tmp_path / "customers.json"
    update_customer_profile(
        "tg-998877",
        {"name": "Partner", "phone": "+380671112233", "linkedProviderId": "provider-tg-998877"},
        store_path=customer_store,
    )

    assert resolve_provider_telegram_user_id("provider-tg-998877", customer_store_path=customer_store) == "998877"


def test_partner_telegram_user_ids_for_cancelled_order(tmp_path):
    order_store = tmp_path / "orders.json"
    offer_store = tmp_path / "offers.json"
    customer_store = tmp_path / "customers.json"
    update_customer_profile(
        "tg-445566",
        {"name": "Partner", "phone": "+380671112244", "linkedProviderId": "provider-tg-445566"},
        store_path=customer_store,
    )
    order = save_order({"service": "tow", "status": "searching"}, store_path=order_store)
    save_offers([
        {
            "id": "OF-1",
            "orderId": order["id"],
            "providerId": "provider-tg-445566",
            "status": "pending",
            "distanceKm": 1.2,
            "createdAt": "2026-08-12T12:00:00Z",
            "expiresAt": "2026-08-12T12:00:20Z",
        }
    ], store_path=offer_store)

    telegram_ids = partner_telegram_user_ids_for_order(
        order["id"],
        order,
        customer_store_path=customer_store,
        offer_store_path=offer_store,
    )
    assert telegram_ids == ["445566"]


def test_enrich_order_for_client_fills_provider_name_and_price(tmp_path):
    provider_store = tmp_path / "providers.json"
    save_providers([
        {
            "id": "provider-tg-123",
            "name": "Олександр",
            "rating": 4.9,
            "vehicle": "Volkswagen Transporter",
            "plate": "AO 1248 CH",
            "phone": "+380671112233",
            "telegram": "pomich_help_bot",
            "status": "busy",
            "etaMinutes": 12,
            "location": {"lat": 48.632, "lng": 22.271},
            "specialties": ["tow"],
            "serviceRadiusKm": 15,
            "verificationStatus": "verified",
        }
    ], store_path=provider_store)

    enriched = enrich_order_for_client(
        {
            "id": "PM-1",
            "status": "accepted",
            "assignedProviderId": "provider-tg-123",
            "partnerProposedPrice": 1500,
        },
        provider_store_path=provider_store,
    )

    assert enriched["providerName"] == "Олександр"
    assert enriched["assignedProvider"]["name"] == "Олександр"
    assert enriched["partnerProposedPrice"] == 1500


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
