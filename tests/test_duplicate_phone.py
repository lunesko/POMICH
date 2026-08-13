from pathlib import Path

import pytest

from bot.order_store import (
    PHONE_ALREADY_REGISTERED,
    update_customer_profile,
    update_provider_profile,
)


def test_duplicate_customer_phone_rejected(tmp_path: Path) -> None:
    store = tmp_path / "customers.json"
    update_customer_profile(
        "tg-1",
        {"name": "Марія", "phone": "+380501112233", "city": "Ужгород"},
        store,
    )
    with pytest.raises(ValueError, match=PHONE_ALREADY_REGISTERED):
        update_customer_profile(
            "guest-2",
            {"name": "Олег", "phone": "+380501112233", "city": "Львів"},
            store,
        )


def test_same_customer_can_keep_own_phone(tmp_path: Path) -> None:
    store = tmp_path / "customers.json"
    first = update_customer_profile(
        "tg-7",
        {"name": "Іван", "phone": "+380671234567", "city": "Київ"},
        store,
    )
    again = update_customer_profile(
        "tg-7",
        {"name": "Іван Петренко", "phone": "+380671234567", "city": "Київ"},
        store,
    )
    assert again["phone"] == first["phone"]
    assert again["name"] == "Іван Петренко"


def test_duplicate_provider_phone_rejected(tmp_path: Path) -> None:
    store = tmp_path / "providers.json"
    update_provider_profile(
        "provider-a",
        {
            "name": "Партнер А",
            "phone": "+380931112233",
            "vehicle": "VW Crafter",
            "city": "Ужгород",
            "specialties": ["tow"],
            "serviceRadiusKm": 10,
        },
        store,
    )
    with pytest.raises(ValueError, match=PHONE_ALREADY_REGISTERED):
        update_provider_profile(
            "provider-b",
            {
                "name": "Партнер Б",
                "phone": "+380931112233",
                "vehicle": "Ford Transit",
                "city": "Львів",
                "specialties": ["battery"],
                "serviceRadiusKm": 8,
            },
            store,
        )
