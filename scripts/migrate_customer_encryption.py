import os

from bot.field_encryption import decrypt_field, encrypt_field, generate_encryption_key
from bot.order_store import get_customer_profile, load_customer_profiles, save_customer_profiles, update_customer_profile


def migrate_customer_encryption(store_path=None) -> int:
    profiles = load_customer_profiles(store_path)
    migrated = 0
    for profile in profiles:
        customer_id = str(profile.get("id") or "")
        if not customer_id:
            continue
        raw = get_customer_profile(customer_id, store_path)
        phone = str(raw.get("phone") or "")
        if phone and not phone.startswith("enc:v1:"):
            update_customer_profile(customer_id, {"phone": phone, "name": raw.get("name"), "email": raw.get("email"), "city": raw.get("city"), "bio": raw.get("bio")}, store_path)
            migrated += 1
    return migrated


if __name__ == "__main__":
    if not os.getenv("POMICH_ENCRYPTION_KEY"):
        print("Set POMICH_ENCRYPTION_KEY before running migration.")
        print("Suggested key:", generate_encryption_key())
        raise SystemExit(1)
    count = migrate_customer_encryption()
    print(f"Migrated {count} customer profile(s) to encrypted storage.")
