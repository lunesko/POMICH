import pytest

from bot.field_encryption import decrypt_customer_profile, decrypt_field, encrypt_customer_profile, encrypt_field, generate_encryption_key


@pytest.fixture()
def encryption_env(monkeypatch):
    key = generate_encryption_key()
    monkeypatch.setenv("POMICH_ENCRYPTION_KEY", key)
    import bot.field_encryption as module

    module._fernet = None
    module._fernet_checked = False
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
