import pytest

from bot.api_deps import runtime_config_errors
from bot.field_encryption import (
    FieldEncryptionError,
    decrypt_customer_profile,
    decrypt_field,
    encrypt_customer_profile,
    encrypt_field,
    generate_encryption_key,
    require_valid_fernet_key,
)


@pytest.fixture()
def encryption_env(monkeypatch):
    key = generate_encryption_key()
    monkeypatch.setenv("POMICH_ENCRYPTION_KEY", key)
    import bot.field_encryption as module

    module._fernet = None
    module._fernet_checked = False
    module._fernet_key = None
    return key


def test_encrypt_decrypt_roundtrip(encryption_env):
    plaintext = "+380671112233"
    encrypted = encrypt_field(plaintext)
    assert encrypted.startswith("enc:v1:")
    assert encrypted != plaintext
    assert decrypt_field(encrypted) == plaintext


def test_customer_profile_encryption(encryption_env):
    profile = {
        "id": "tg-42",
        "name": "Олексій",
        "phone": "+380671112233",
        "email": "test@example.com",
        "city": "Київ",
    }
    stored = encrypt_customer_profile(profile)
    assert stored["phone"].startswith("enc:v1:")
    restored = decrypt_customer_profile(stored)
    assert restored["phone"] == profile["phone"]
    assert restored["name"] == profile["name"]


def test_decrypt_failure_preserves_ciphertext(encryption_env, monkeypatch):
    encrypted = encrypt_field("+380671112233")
    # Force a different key so decrypt fails.
    other = generate_encryption_key()
    monkeypatch.setenv("POMICH_ENCRYPTION_KEY", other)
    import bot.field_encryption as module

    module._fernet = None
    module._fernet_checked = False
    module._fernet_key = None
    assert decrypt_field(encrypted) == encrypted
    # Re-encrypt must not wipe the ciphertext with an empty value.
    stored = encrypt_customer_profile({"id": "tg-1", "phone": encrypted})
    assert stored["phone"] == encrypted


def test_invalid_fernet_key_fails_closed(monkeypatch):
    import bot.field_encryption as module

    monkeypatch.setenv("POMICH_ENCRYPTION_KEY", "not-a-valid-fernet-key")
    module._fernet = None
    module._fernet_checked = False
    module._fernet_key = None
    with pytest.raises(FieldEncryptionError):
        require_valid_fernet_key()
    with pytest.raises(FieldEncryptionError):
        encrypt_field("+380671112233")


def test_production_rejects_invalid_encryption_key(monkeypatch):
    monkeypatch.setenv("POMICH_RUNTIME", "production")
    monkeypatch.setenv("POMICH_ADMIN_TOKEN", "prod-admin-token-value-xxxxxxxx")
    monkeypatch.setenv("POMICH_PROVIDER_TOKEN", "prod-provider-token-value-xxxx")
    monkeypatch.setenv("POMICH_CUSTOMER_SESSION_SECRET", "prod-customer-session-secret-xx")
    monkeypatch.setenv("POMICH_ENCRYPTION_KEY", "not-a-valid-fernet-key")
    monkeypatch.setenv("POMICH_ALLOW_JSON_STORE_IN_PRODUCTION", "true")
    monkeypatch.setenv("POMICH_CORS_ORIGINS", "https://pomich.help")
    errors = runtime_config_errors()
    assert any("valid Fernet key" in item for item in errors)
