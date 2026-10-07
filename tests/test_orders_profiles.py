import pytest
from bot.order_store import get_provider_profile, load_providers, merge_directory_providers, resolve_provider_telegram_user_id, save_order, save_providers, update_provider_presence, update_provider_profile, update_customer_profile



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


def test_unregistered_provider_cannot_go_online(tmp_path):
    store_path = tmp_path / "providers.json"

    with pytest.raises(ValueError):
        update_provider_presence(
            "provider-new",
            {"status": "online", "location": {"lat": 48.63, "lng": 22.27}},
            store_path=store_path,
        )


def test_presence_promotes_linked_verified_customer_shell(tmp_path, monkeypatch):
    from bot.order_store import (
        get_provider_profile,
        load_customer_profiles,
        save_customer_profiles,
        update_provider_presence,
    )

    customer_path = tmp_path / "customers.json"
    provider_path = tmp_path / "providers.json"
    provider_path.write_text("[]", encoding="utf-8")
    monkeypatch.setattr("bot.order_store._default_customer_store_path", lambda: customer_path)
    monkeypatch.setattr("bot.order_store._default_provider_store_path", lambda: provider_path)
    monkeypatch.setenv("POMICH_STORAGE_BACKEND", "json")

    update_customer_profile(
        "tg-55",
        {
            "name": "Партнер",
            "phone": "+380509998877",
            "city": "Ужгород",
            "preferredRole": "provider",
            "linkedProviderId": "provider-tg-55",
            "rolesRegistered": ["customer", "provider"],
        },
        store_path=customer_path,
    )
    profiles = load_customer_profiles(customer_path)
    for profile in profiles:
        if str(profile.get("id")) == "tg-55":
            profile["verificationStatus"] = "verified"
            profile["verification"] = {"phone": True}
    save_customer_profiles(profiles, customer_path)

    with pytest.raises(ValueError, match="complete"):
        update_provider_presence(
            "provider-tg-55",
            {"status": "online", "location": {"lat": 48.63, "lng": 22.27}},
            store_path=provider_path,
        )

    from bot.order_store import update_provider_profile

    update_provider_profile(
        "provider-tg-55",
        {
            "name": "Партнер",
            "phone": "+380509998877",
            "vehicle": "Автодопомога",
            "plate": "AO 5555 CH",
            "specialties": ["tow"],
            "serviceRadiusKm": 15,
        },
        store_path=provider_path,
    )

    online = update_provider_presence(
        "provider-tg-55",
        {"status": "online", "location": {"lat": 48.63, "lng": 22.27}},
        store_path=provider_path,
    )
    assert online["status"] == "online"
    assert online.get("registeredAt")
    loaded = get_provider_profile("provider-tg-55", provider_path)
    assert loaded is not None
    assert loaded["status"] == "online"
    assert loaded.get("plate") == "AO 5555 CH"


def test_phone_login_finds_guest_partner_via_provider_phone(tmp_path):
    """After partner registration, phone login must resolve guest-{id} via provider-{id}."""
    from bot.order_store import (
        find_registered_customer_by_phone,
        resolve_customer_id_for_provider,
        update_provider_profile,
    )

    customer_path = tmp_path / "customers.json"
    provider_path = tmp_path / "providers.json"

    update_customer_profile(
        "guest-vitaliy",
        {"name": "Віталій", "phone": "", "preferredRole": "provider"},
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
            "specialties": ["tow"],
            "serviceRadiusKm": 15,
        },
        store_path=provider_path,
    )

    # Provider save syncs customer on the default customer store; mirror that link here.
    update_customer_profile(
        "guest-vitaliy",
        {
            "name": "Віталій",
            "phone": "+380661007434",
            "linkedProviderId": "provider-guest-vitaliy",
            "preferredRole": "provider",
        },
        store_path=customer_path,
    )

    assert resolve_customer_id_for_provider("provider-guest-vitaliy", customer_path) == "guest-vitaliy"

    found = find_registered_customer_by_phone("+380661007434", store_path=customer_path)
    assert found is not None
    assert found["id"] == "guest-vitaliy"
    assert found.get("linkedProviderId") == "provider-guest-vitaliy"


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


def test_update_own_phone_unchanged_succeeds_with_legacy_guest_duplicate(tmp_path):
    from bot.order_store import load_customer_profiles, save_customer_profiles

    store_path = tmp_path / "customers.json"
    update_customer_profile(
        "tg-829741830",
        {"name": "PowerGear", "phone": "+380635236801", "city": "Ужгород"},
        store_path=store_path,
    )
    profiles = load_customer_profiles(store_path)
    profiles.append(
        {
            "id": "guest-old",
            "name": "PowerGear",
            "phone": "+380635236801",
            "city": "Ужгород",
            "verificationStatus": "verified",
        }
    )
    save_customer_profiles(profiles, store_path)

    updated = update_customer_profile(
        "tg-829741830",
        {
            "name": "PowerGear",
            "phone": "+380635236801",
            "city": "Ужгород",
            "email": "power@example.com",
        },
        store_path=store_path,
    )

    assert updated["phone"] == "+380635236801"
    assert updated["email"] == "power@example.com"


def test_update_own_phone_allowed_when_on_linked_provider_with_tg_duplicate(tmp_path, monkeypatch):
    from bot.order_store import update_provider_profile

    customer_path = tmp_path / "customers.json"
    provider_path = tmp_path / "providers.json"
    monkeypatch.setattr("bot.order_store._default_provider_store_path", lambda: provider_path)

    update_customer_profile(
        "tg-829741830",
        {"name": "PowerGear", "phone": "+380635236801", "city": "Ужгород"},
        store_path=customer_path,
    )
    update_customer_profile(
        "guest-browser",
        {"name": "PowerGear", "city": "Ужгород"},
        store_path=customer_path,
    )
    update_provider_profile(
        "provider-guest-browser",
        {
            "name": "PowerGear",
            "phone": "+380635236801",
            "city": "Ужгород",
            "vehicle": "Volkswagen Crafter",
            "plate": "BX5874HX",
            "specialties": ["tow"],
            "serviceRadiusKm": 15,
            "registeredAt": "2026-08-12T12:00:00Z",
        },
        store_path=provider_path,
    )

    updated = update_customer_profile(
        "guest-browser",
        {"phone": "+380635236801"},
        store_path=customer_path,
    )
    assert updated["phone"] == "+380635236801"


def test_otp_verify_send_allows_own_provider_phone_with_tg_duplicate(tmp_path, monkeypatch):
    from bot import otp_verification
    from bot.order_store import update_provider_profile

    customer_path = tmp_path / "customers.json"
    provider_path = tmp_path / "providers.json"
    otp_path = tmp_path / "otp_codes.json"
    monkeypatch.setattr("bot.order_store._default_provider_store_path", lambda: provider_path)
    monkeypatch.setattr(otp_verification, "_default_otp_store_path", lambda: otp_path)
    monkeypatch.setattr(otp_verification, "_generate_otp_code", lambda: "112233")
    monkeypatch.setattr(otp_verification, "_send_telegram_otp", lambda chat_id, code, **kwargs: 829741830)
    monkeypatch.setenv("POMICH_OTP_SECRET", "test-otp-secret")

    update_customer_profile(
        "tg-829741830",
        {"name": "PowerGear", "phone": "+380635236801", "city": "Ужгород"},
        store_path=customer_path,
    )
    update_customer_profile(
        "guest-browser",
        {"name": "PowerGear", "city": "Ужгород"},
        store_path=customer_path,
    )
    update_provider_profile(
        "provider-guest-browser",
        {
            "name": "PowerGear",
            "phone": "+380635236801",
            "city": "Ужгород",
            "vehicle": "Volkswagen Crafter",
            "plate": "BX5874HX",
            "specialties": ["tow"],
            "serviceRadiusKm": 15,
            "registeredAt": "2026-08-12T12:00:00Z",
        },
        store_path=provider_path,
    )

    sent = otp_verification.send_customer_verification_code(
        "guest-browser",
        "telegram",
        phone="+380635236801",
        customer_store_path=customer_path,
    )
    assert sent["channel"] == "telegram"


def test_sync_provider_verification_from_verified_client(tmp_path, monkeypatch):
    from bot.order_store import (
        is_provider_verified,
        load_customer_profiles,
        save_customer_profiles,
        sync_linked_provider_phone_verification_from_customer,
        update_provider_profile,
    )

    customer_path = tmp_path / "customers.json"
    provider_path = tmp_path / "providers.json"
    monkeypatch.setattr("bot.order_store._default_provider_store_path", lambda: provider_path)

    update_customer_profile(
        "tg-829741830",
        {
            "name": "PowerGear",
            "phone": "+380635236801",
            "city": "Ужгород",
            "linkedProviderId": "provider-tg-829741830",
        },
        store_path=customer_path,
    )
    profiles = load_customer_profiles(customer_path)
    for profile in profiles:
        if str(profile.get("id") or "") != "tg-829741830":
            continue
        profile["verificationStatus"] = "verified"
        verification = profile.get("verification") if isinstance(profile.get("verification"), dict) else {}
        verification["phone"] = True
        profile["verification"] = verification
    save_customer_profiles(profiles, customer_path)
    update_provider_profile(
        "provider-tg-829741830",
        {
            "name": "PowerGear",
            "phone": "+380635236801",
            "city": "Ужгород",
            "vehicle": "Volkswagen Crafter",
            "plate": "BX5874HX",
            "specialties": ["tow"],
            "serviceRadiusKm": 15,
            "registeredAt": "2026-08-12T12:00:00Z",
        },
        store_path=provider_path,
    )

    synced = sync_linked_provider_phone_verification_from_customer(
        "provider-tg-829741830",
        store_path=provider_path,
        customer_store_path=customer_path,
    )
    assert synced is not None
    assert is_provider_verified(synced)


def test_go_online_inherits_verified_customer_phone(tmp_path, monkeypatch):
    from bot.order_store import (
        is_provider_verified,
        load_customer_profiles,
        save_customer_profiles,
        update_provider_presence,
        update_provider_profile,
    )

    customer_path = tmp_path / "customers.json"
    provider_path = tmp_path / "providers.json"
    monkeypatch.setattr("bot.order_store._default_customer_store_path", lambda: customer_path)
    monkeypatch.setattr("bot.order_store._default_provider_store_path", lambda: provider_path)

    update_customer_profile(
        "tg-99",
        {
            "name": "Партнер",
            "phone": "+380501112233",
            "city": "Ужгород",
            "linkedProviderId": "provider-tg-99",
        },
        store_path=customer_path,
    )
    profiles = load_customer_profiles(customer_path)
    for profile in profiles:
        if str(profile.get("id") or "") != "tg-99":
            continue
        profile["verificationStatus"] = "verified"
        verification = profile.get("verification") if isinstance(profile.get("verification"), dict) else {}
        verification["phone"] = True
        profile["verification"] = verification
    save_customer_profiles(profiles, customer_path)

    update_provider_profile(
        "provider-tg-99",
        {
            "name": "Партнер",
            "phone": "+380501112233",
            "city": "Ужгород",
            "vehicle": "Ford Transit",
            "plate": "АА1234ВВ",
            "specialties": ["tow"],
            "serviceRadiusKm": 15,
            "registeredAt": "2026-08-12T12:00:00Z",
        },
        store_path=provider_path,
    )

    online = update_provider_presence(
        "provider-tg-99",
        {"status": "online", "location": {"lat": 48.63, "lng": 22.27}},
        store_path=provider_path,
    )
    assert online["status"] == "online"
    assert is_provider_verified(online)


def test_duplicate_provider_phone_registration_rejected(tmp_path):
    from bot.order_store import update_provider_profile

    provider_path = tmp_path / "providers.json"
    # Empty file so load_providers does not fall back to seeded demo partners.
    provider_path.write_text("[]", encoding="utf-8")
    update_provider_profile(
        "provider-a",
        {
            "name": "Партнер А",
            "phone": "+380931112233",
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
                "phone": "+380931112233",
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

    restored = find_registered_customer_by_phone("+380661007434")
    assert restored is not None
    assert restored["id"] == "guest-vitaliy"

    status = build_user_account_status("guest-vitaliy")
    assert status["providerRegistered"] is True
    assert status["linkedProviderId"] == "provider-guest-vitaliy"


def test_ensure_linked_provider_profile_creates_registered_row_for_verified_customer(tmp_path, monkeypatch):
    from bot.order_store import (
        ensure_linked_provider_profile,
        get_provider_profile,
        build_user_account_status,
    )

    customer_path = tmp_path / "customers.json"
    provider_path = tmp_path / "providers.json"
    monkeypatch.setattr("bot.order_store._default_customer_store_path", lambda: customer_path)
    monkeypatch.setattr("bot.order_store._default_provider_store_path", lambda: provider_path)
    monkeypatch.setenv("POMICH_STORAGE_BACKEND", "json")

    update_customer_profile(
        "tg-829741830",
        {
            "name": "Віталій",
            "phone": "+380661007434",
            "city": "Ужгород",
            "preferredRole": "provider",
            "linkedProviderId": "provider-tg-829741830",
            "rolesRegistered": ["customer", "provider"],
        },
        store_path=customer_path,
    )
    from bot.order_store import load_customer_profiles, save_customer_profiles

    profiles = load_customer_profiles(customer_path)
    for profile in profiles:
        if str(profile.get("id")) == "tg-829741830":
            profile["verificationStatus"] = "verified"
            profile["verification"] = {"phone": True}
    save_customer_profiles(profiles, customer_path)
    assert get_provider_profile("provider-tg-829741830", provider_path) is None

    ensured = ensure_linked_provider_profile("tg-829741830", provider_path, customer_path)
    assert ensured is not None
    assert ensured["id"] == "provider-tg-829741830"
    assert ensured.get("registeredAt")
    assert ensured["name"] == "Віталій"
    assert ensured["phone"] == "+380661007434"
    assert ensured["verificationStatus"] == "verified"

    loaded = get_provider_profile("provider-tg-829741830", provider_path)
    assert loaded is not None
    assert loaded.get("registeredAt")
    # Defaults are monkeypatched — status must see the same provider JSON store.
    status = build_user_account_status("tg-829741830")
    assert status["providerRegistered"] is True
    assert status["linkedProviderId"] == "provider-tg-829741830"


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
    monkeypatch.setattr(otp_verification, "_send_telegram_otp", lambda chat_id, code, **kwargs: None)

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


def test_customer_profile_persists_vehicle(tmp_path):
    store_path = tmp_path / "customers.json"
    updated = update_customer_profile(
        "tg-vehicle-test",
        {"name": "Driver", "phone": "+380671234567", "vehicle": "Toyota Corolla"},
        store_path=store_path,
    )
    assert updated["vehicle"] == "Toyota Corolla"

    from bot.order_store import get_customer_profile

    loaded = get_customer_profile("tg-vehicle-test", store_path=store_path)
    assert loaded["vehicle"] == "Toyota Corolla"


def test_resolve_provider_telegram_user_id_from_linked_customer(tmp_path):
    customer_store = tmp_path / "customers.json"
    update_customer_profile(
        "tg-998877",
        {"name": "Partner", "phone": "+380679998877", "linkedProviderId": "provider-tg-998877"},
        store_path=customer_store,
    )

    assert resolve_provider_telegram_user_id("provider-tg-998877", customer_store_path=customer_store) == "998877"


def test_merge_directory_providers_preserves_other_cities(tmp_path):
    store_path = tmp_path / "providers.json"
    save_providers(
        [
            {"id": "dispatch-1", "name": "Partner", "providerKind": "dispatch", "city": "Ужгород"},
            {"id": "uzh-a", "name": "STO A", "providerKind": "directory", "city": "Ужгород", "location": {"lat": 48.62, "lng": 22.28}},
        ],
        store_path,
    )

    result = merge_directory_providers(
        [{"id": "lviv-a", "name": "STO Lviv", "city": "Львів", "location": {"lat": 49.84, "lng": 24.03}}],
        store_path,
    )

    providers = {item["id"]: item for item in load_providers(store_path)}
    assert result["added"] == 1
    assert "uzh-a" in providers
    assert "lviv-a" in providers
    assert providers["dispatch-1"]["providerKind"] == "dispatch"


def test_switching_preferred_role_to_customer_reuses_partner_profile(tmp_path, monkeypatch):
    customer_path = tmp_path / "customers.json"
    provider_path = tmp_path / "providers.json"
    monkeypatch.setenv("POMICH_CUSTOMER_STORE_PATH", str(customer_path))
    monkeypatch.setenv("POMICH_PROVIDER_STORE_PATH", str(provider_path))

    from bot.order_store import (
        get_customer_profile,
        set_user_preferred_role,
        update_customer_profile,
        update_provider_profile,
    )

    customer_id = "tg-role-switch"
    provider_id = f"provider-{customer_id}"
    update_customer_profile(customer_id, {"preferredRole": "provider", "linkedProviderId": provider_id})
    update_provider_profile(
        provider_id,
        {
            "name": "Іван Партнер",
            "phone": "+380671998877",
            "vehicle": "Ford Transit",
            "plate": "AO 1111 AA",
            "specialties": ["tow"],
            "city": "Ужгород",
        },
        store_path=provider_path,
    )

    status = set_user_preferred_role(customer_id, "customer")
    profile = get_customer_profile(customer_id)

    assert status["clientRegistered"] is True
    assert status["providerRegistered"] is True
    assert "customer" in status["rolesRegistered"]
    assert "provider" in status["rolesRegistered"]
    assert profile["name"] == "Іван Партнер"
    assert "+380671998877" in str(profile.get("phone") or "")


def test_role_switch_claims_guest_phone_and_rebinds_orders(tmp_path, monkeypatch):
    customer_path = tmp_path / "customers.json"
    provider_path = tmp_path / "providers.json"
    order_path = tmp_path / "orders.json"
    provider_path.write_text("[]", encoding="utf-8")
    monkeypatch.setenv("POMICH_CUSTOMER_STORE_PATH", str(customer_path))
    monkeypatch.setenv("POMICH_PROVIDER_STORE_PATH", str(provider_path))
    monkeypatch.setenv("POMICH_ORDER_STORE_PATH", str(order_path))

    from bot.order_store import (
        get_customer_profile,
        list_orders_for_customer,
        save_order,
        set_user_preferred_role,
        update_customer_profile,
        update_provider_profile,
    )

    guest_id = "guest-old-rides"
    customer_id = "tg-history-fix"
    provider_id = f"provider-{customer_id}"
    shared_phone = "+380671556677"
    update_customer_profile(
        guest_id,
        {"name": "Guest", "phone": shared_phone, "city": "Ужгород"},
        store_path=customer_path,
    )
    update_customer_profile(
        customer_id,
        {"preferredRole": "provider", "linkedProviderId": provider_id},
        store_path=customer_path,
    )
    update_provider_profile(
        provider_id,
        {
            "name": "Partner",
            "phone": shared_phone,
            "vehicle": "Van",
            "plate": "AO 2222 BB",
            "specialties": ["tow"],
            "city": "Ужгород",
        },
        store_path=provider_path,
    )
    saved = save_order(
        {"service": "tow", "status": "completed", "customerId": guest_id},
        store_path=order_path,
    )

    status = set_user_preferred_role(customer_id, "customer")
    profile = get_customer_profile(customer_id)
    guest = get_customer_profile(guest_id)

    assert status["clientRegistered"] is True
    assert "380671556677" in "".join(ch for ch in str(profile.get("phone") or "") if ch.isdigit())
    assert not str(guest.get("phone") or "").strip()
    history = list_orders_for_customer(
        customer_id,
        store_path=order_path,
        customer_store_path=customer_path,
    )
    assert any(item.get("id") == saved["id"] for item in history)
    rebound = next(item for item in history if item.get("id") == saved["id"])
    assert rebound.get("customerId") == customer_id


def test_history_aliases_use_linked_provider_phone_when_profile_phoneless(tmp_path, monkeypatch):
    customer_path = tmp_path / "customers.json"
    provider_path = tmp_path / "providers.json"
    order_path = tmp_path / "orders.json"
    provider_path.write_text("[]", encoding="utf-8")
    monkeypatch.setenv("POMICH_CUSTOMER_STORE_PATH", str(customer_path))
    monkeypatch.setenv("POMICH_PROVIDER_STORE_PATH", str(provider_path))

    from bot import order_store
    from bot.order_store import (
        list_orders_for_customer,
        save_order,
        update_customer_profile,
        update_provider_profile,
    )

    monkeypatch.setattr(order_store, "_default_customer_store_path", lambda: customer_path)
    monkeypatch.setattr(order_store, "_default_store_path", lambda: order_path)
    monkeypatch.setattr(order_store, "_default_provider_store_path", lambda: provider_path)

    customer_id = "tg-phoneless"
    provider_id = f"provider-{customer_id}"
    shared_phone = "+380509998877"
    update_customer_profile(
        customer_id,
        {"name": "Partner", "linkedProviderId": provider_id, "rolesRegistered": ["provider", "customer"]},
        store_path=customer_path,
    )
    update_provider_profile(
        provider_id,
        {
            "name": "Partner",
            "phone": shared_phone,
            "vehicle": "Van",
            "plate": "AO 3333 CC",
            "specialties": ["mechanic"],
            "city": "Ужгород",
        },
        store_path=provider_path,
    )
    # Guest row keeps the same phone (legacy duplicate); tg row has no phone persisted.
    profiles = order_store.load_customer_profiles(customer_path)
    profiles.append(
        {
            "id": "guest-legacy",
            "name": "Legacy",
            "phone": shared_phone,
            "city": "Ужгород",
            "verificationStatus": "verified",
            "rolesRegistered": ["customer"],
        }
    )
    order_store.save_customer_profiles(profiles, customer_path)
    saved = save_order(
        {"service": "mechanic", "status": "completed", "customerId": "guest-legacy"},
        store_path=order_path,
    )

    history = list_orders_for_customer(
        customer_id,
        store_path=order_path,
        customer_store_path=customer_path,
    )
    assert any(item.get("id") == saved["id"] for item in history)


def test_guest_cannot_claim_telegram_canonical_phone(tmp_path, monkeypatch):
    customer_path = tmp_path / "customers.json"
    monkeypatch.setenv("POMICH_CUSTOMER_STORE_PATH", str(customer_path))

    from bot import order_store
    from bot.order_store import _claim_conflicting_guest_phone, get_customer_profile

    monkeypatch.setattr(order_store, "_default_customer_store_path", lambda: customer_path)

    shared = "+380671112233"
    order_store.save_customer_profiles(
        [
            {
                "id": "tg-owner",
                "name": "Owner",
                "phone": shared,
                "verificationStatus": "verified",
                "rolesRegistered": ["customer"],
            },
            {"id": "guest-thief", "name": "Guest", "rolesRegistered": ["customer"]},
        ],
        customer_path,
    )

    claimed = _claim_conflicting_guest_phone("guest-thief", shared, customer_path)
    assert claimed is False
    owner = get_customer_profile("tg-owner", customer_path)
    assert "380671112233" in "".join(ch for ch in str(owner.get("phone") or "") if ch.isdigit())
