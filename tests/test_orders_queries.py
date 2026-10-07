from bot.order_store import enrich_order_for_client, partner_telegram_user_ids_for_order, save_order, save_offers, save_providers, update_order_status, update_customer_profile



def test_update_order_status_adds_history(tmp_path):
    store_path = tmp_path / "orders.json"
    order = save_order({"service": "tow"}, store_path=store_path)

    updated = update_order_status(order["id"], "accepted", store_path=store_path)

    assert updated is not None
    assert updated["status"] == "accepted"
    assert updated["statusHistory"][-1]["status"] == "accepted"


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


def test_enrich_order_for_client_prefers_stored_location_on_completed(tmp_path):
    provider_store = tmp_path / "providers.json"
    save_providers([
        {
            "id": "provider-tg-55",
            "name": "Partner",
            "rating": 5.0,
            "vehicle": "Van",
            "plate": "AA 0001 BB",
            "phone": "+380671112233",
            "telegram": "pomich_help_bot",
            "status": "online",
            "etaMinutes": 8,
            "location": {"lat": 48.7, "lng": 22.4},
            "specialties": ["mechanic"],
            "serviceRadiusKm": 15,
            "verificationStatus": "verified",
        }
    ], store_path=provider_store)

    enriched = enrich_order_for_client(
        {
            "id": "PM-55",
            "status": "completed",
            "assignedProviderId": "provider-tg-55",
            "customerCoordinates": {"lat": 48.62, "lng": 22.28},
            "assignedProvider": {
                "id": "provider-tg-55",
                "name": "Partner",
                "location": {"lat": 48.625, "lng": 22.29},
                "distanceKm": 0.5,
            },
        },
        provider_store_path=provider_store,
    )

    assert enriched["assignedProvider"]["location"] == {"lat": 48.625, "lng": 22.29}
    assert enriched["assignedProvider"]["distanceKm"] == 0.5


def test_list_orders_for_customer_matches_id_and_telegram_chat(tmp_path, monkeypatch):
    from bot import order_store
    from bot.order_store import list_orders_for_customer

    order_path = tmp_path / "orders.json"
    customer_path = tmp_path / "customers.json"
    monkeypatch.setattr(order_store, "_default_customer_store_path", lambda: customer_path)
    monkeypatch.setattr(order_store, "_default_store_path", lambda: order_path)

    update_customer_profile(
        "tg-829741830",
        {"name": "Віталій", "phone": "+380661007434", "city": "Ужгород"},
        store_path=customer_path,
    )
    # Legacy guest row with same phone (pre-uniqueness era / imported data).
    profiles = order_store.load_customer_profiles(customer_path)
    profiles.append(
        {
            "id": "guest-old",
            "name": "Віталій",
            "phone": "+380661007434",
            "city": "Ужгород",
            "verificationStatus": "verified",
        }
    )
    order_store.save_customer_profiles(profiles, customer_path)

    save_order(
        {"service": "tow", "status": "completed", "customerId": "guest-old"},
        store_path=order_path,
    )
    save_order(
        {
            "service": "mechanic",
            "status": "cancelled",
            "customerId": "tg-829741830",
            "chatId": "829741830",
        },
        store_path=order_path,
    )
    save_order(
        {"service": "fuel", "status": "searching", "customerId": "someone-else"},
        store_path=order_path,
    )

    history = list_orders_for_customer(
        "tg-829741830",
        store_path=order_path,
        customer_store_path=customer_path,
        limit=20,
    )
    ids = {item["id"] for item in history}
    assert len(history) == 2
    assert len(ids) == 2


def test_customer_orders_endpoint_returns_history(monkeypatch, tmp_path):
    from bot import order_store
    from bot.fastapi_app import app
    from fastapi.testclient import TestClient

    order_path = tmp_path / "orders.json"
    customer_path = tmp_path / "customers.json"
    monkeypatch.setenv("POMICH_RUNTIME", "dev")
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", "test-customer-secret-for-cabinet-history")
    monkeypatch.setattr(order_store, "_default_customer_store_path", lambda: customer_path)
    monkeypatch.setattr(order_store, "_default_store_path", lambda: order_path)

    client = TestClient(app)
    session = client.post("/api/auth/customer/guest/session", json={"customerId": "guest-cabinet-1"})
    assert session.status_code == 200
    token = session.json()["accessToken"]
    customer_id = session.json()["customerId"]

    save_order(
        {"service": "tow", "status": "completed", "customerId": customer_id},
        store_path=order_path,
    )

    response = client.get(
        f"/api/customers/{customer_id}/orders?limit=10",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, list)
    assert len(body) == 1
    assert body[0]["customerId"] == customer_id
    assert body[0]["service"] == "tow"
