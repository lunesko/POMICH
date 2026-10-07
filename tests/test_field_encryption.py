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
    plaintext = "+380991234876"
    encrypted = encrypt_field(plaintext)
    assert encrypted.startswith("enc:v1:")
    assert encrypted != plaintext
    assert decrypt_field(encrypted) == plaintext


def test_customer_profile_encryption(encryption_env):
    profile = {
        "id": "tg-42",
        "name": "Олексій",
        "phone": "+380991234876",
        "email": "test@example.com",
        "city": "Київ",
    }
    stored = encrypt_customer_profile(profile)
    assert stored["phone"].startswith("enc:v1:")
    restored = decrypt_customer_profile(stored)
    assert restored["phone"] == profile["phone"]
    assert restored["name"] == profile["name"]


@pytest.mark.parametrize("key_state", ["wrong", "missing", "invalid"])
def test_unreadable_pii_blocks_profile_save(encryption_env, monkeypatch, tmp_path, key_state):
    from bot import order_store
    from bot.field_encryption import FieldEncryptionError
    path = tmp_path / "customers.json"
    order_store.update_customer_profile("c1", {"name": "Roman", "phone": "+380991234876"}, path)
    original = path.read_bytes()
    if key_state == "missing":
        monkeypatch.delenv("POMICH_ENCRYPTION_KEY")
    else:
        monkeypatch.setenv("POMICH_ENCRYPTION_KEY", generate_encryption_key() if key_state == "wrong" else "invalid")
    with pytest.raises(FieldEncryptionError):
        order_store.update_customer_profile("c1", {"city": "Kyiv"}, path)
    assert path.read_bytes() == original
    monkeypatch.setenv("POMICH_ENCRYPTION_KEY", encryption_env)
    assert order_store.get_customer_profile("c1", path)["phone"] == "+380991234876"


def test_corrupt_ciphertext_raises(encryption_env):
    from bot.field_encryption import FieldEncryptionError
    with pytest.raises(FieldEncryptionError):
        decrypt_field("enc:v1:broken")


def test_invalid_key_cannot_write_plaintext(monkeypatch):
    from bot.field_encryption import FieldEncryptionError
    monkeypatch.setenv("POMICH_ENCRYPTION_KEY", "invalid")
    with pytest.raises(FieldEncryptionError):
        encrypt_field("+380991234876")
