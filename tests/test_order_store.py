from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

import pytest

from bot.order_store import (
    DispatchConflict,
    InvalidStatusTransition,
    MAX_PROVIDER_OFFERS,
    accept_offer,
    apply_provider_presence_ttl,
    decline_offer,
    dispatch_order,
    get_provider_offers,
    get_telegram_session,
    load_offers,
    load_orders,
    load_providers,
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

    updated = update_order_status(order["id"], "assigned", store_path=store_path)

    assert updated is not None
    assert updated["status"] == "assigned"
    assert updated["statusHistory"][-1]["status"] == "assigned"


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


def test_new_provider_requires_verification_before_online(tmp_path):
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

    submitted = submit_provider_verification(
        "provider-new",
        {
            "identityDocumentRef": "doc/passport",
            "driverLicenseRef": "doc/license",
            "vehicleRegistrationRef": "doc/vehicle",
            "serviceProofRef": "doc/tools",
            "selfieRef": "doc/selfie",
        },
        store_path=store_path,
    )
    reviewed = review_provider_verification("provider-new", {"status": "verified"}, store_path=store_path)
    online = update_provider_presence(
        "provider-new",
        {"status": "online", "location": {"lat": 48.63, "lng": 22.27}},
        store_path=store_path,
    )

    assert submitted["verificationStatus"] == "pending"
    assert reviewed["verificationStatus"] == "verified"
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
        "lastSeenAt": (datetime.utcnow() - timedelta(seconds=90)).isoformat(timespec="seconds"),
    }

    providers = apply_provider_presence_ttl([stale_provider])

    assert providers[0]["status"] == "offline"
    assert providers[0]["stale"] is True


def _provider(provider_id, lat, lng, specialties=None, status="online", radius=50, assigned_order_id=None, last_seen_at=None):
    now = datetime.utcnow().isoformat(timespec="seconds")
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
    stale_time = (datetime.utcnow() - timedelta(seconds=120)).isoformat(timespec="seconds")

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
        accept_offer(offer["id"], "p1", order_path, provider_path, offer_path)
    assert exc_info.value.code == "OFFER_DECLINED"


def test_expired_offer_disappears_from_provider_queue(tmp_path):
    order_path = tmp_path / "orders.json"
    provider_path = tmp_path / "providers.json"
    offer_path = tmp_path / "offers.json"

    save_providers([_provider("p1", 48.6218, 22.2879)], provider_path)
    order = save_order({"service": "tow", "customerCoordinates": {"lat": 48.6208, "lng": 22.2879}}, store_path=order_path)
    dispatch_order(order["id"], order_path, provider_path, offer_path)
    offers = load_offers(offer_path)
    offers[0]["expiresAt"] = (datetime.utcnow() - timedelta(seconds=1)).isoformat(timespec="seconds")
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
            result = accept_offer(offer["id"], offer["providerId"], order_path, provider_path, offer_path)
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
    assert persisted_order["status"] == "assigned"
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
    accept_offer(offer["id"], "p1", order_path, provider_path, offer_path)

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
