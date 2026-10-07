from bot.order_store import get_provider_public_card, list_provider_public_reviews, save_order, save_providers



def test_provider_public_reviews_from_completed_orders(tmp_path):
    order_path = tmp_path / "orders.json"
    provider_path = tmp_path / "providers.json"
    save_providers(
        [
            {
                "id": "p-public",
                "name": "Public partner",
                "rating": 4.5,
                "ratingCount": 2,
                "status": "online",
                "specialties": ["tow"],
            }
        ],
        provider_path,
    )
    save_order(
        {
            "id": "o1",
            "service": "tow",
            "status": "completed",
            "assignedProviderId": "p-public",
            "customerReview": {"rating": 5, "comment": "Great", "at": "2026-08-01T10:00:00"},
        },
        store_path=order_path,
    )
    save_order(
        {
            "id": "o2",
            "service": "fuel",
            "status": "completed",
            "assignedProviderId": "p-public",
            "customerReview": {"rating": 4, "comment": "", "at": "2026-07-01T10:00:00"},
        },
        store_path=order_path,
    )
    save_order(
        {
            "id": "o3",
            "service": "tow",
            "status": "searching",
            "assignedProviderId": "p-public",
            "customerReview": {"rating": 1, "comment": "should ignore"},
        },
        store_path=order_path,
    )

    reviews = list_provider_public_reviews("p-public", store_path=order_path)
    assert len(reviews) == 2
    assert reviews[0]["rating"] == 5
    assert reviews[0]["comment"] == "Great"

    card = get_provider_public_card("p-public", store_path=order_path, provider_store_path=provider_path)
    assert card is not None
    assert card["name"] == "Public partner"
    assert len(card["reviews"]) == 2


def test_submit_order_review_allows_history_alias_customer(tmp_path, monkeypatch):
    customer_path = tmp_path / "customers.json"
    order_path = tmp_path / "orders.json"
    provider_path = tmp_path / "providers.json"
    provider_path.write_text("[]", encoding="utf-8")
    monkeypatch.setenv("POMICH_CUSTOMER_STORE_PATH", str(customer_path))
    monkeypatch.setenv("POMICH_PROVIDER_STORE_PATH", str(provider_path))
    monkeypatch.setenv("POMICH_ORDER_STORE_PATH", str(order_path))

    from bot import order_store
    from bot.order_store import save_order, submit_order_review

    monkeypatch.setattr(order_store, "_default_customer_store_path", lambda: customer_path)
    monkeypatch.setattr(order_store, "_default_store_path", lambda: order_path)

    order_store.save_customer_profiles(
        [
            {
                "id": "tg-reviewer",
                "name": "Client",
                "phone": "+380501112233",
                "verificationStatus": "verified",
                "rolesRegistered": ["customer"],
            },
            {
                "id": "guest-old",
                "name": "Legacy",
                "phone": "+380501112233",
                "rolesRegistered": ["customer"],
            },
        ],
        customer_path,
    )
    saved = save_order(
        {"service": "tow", "status": "completed", "customerId": "guest-old"},
        store_path=order_path,
    )

    reviewed = submit_order_review(
        saved["id"],
        author_role="customer",
        rating=5,
        comment="ok",
        author_id="tg-reviewer",
        store_path=order_path,
        customer_store_path=customer_path,
    )
    assert reviewed.get("customerReview", {}).get("rating") == 5
