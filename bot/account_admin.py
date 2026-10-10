"""Administrative account changes, including durable session revocation."""
from typing import Any, Dict, Optional
from pathlib import Path
from bot import order_store as store


def admin_update_customer_profile(customer_id: str, data: Dict[str, Any], store_path: Optional[Path]=None) -> Dict[str, Any]:
    if str(data.get('accountStatus') or '').lower() == 'disabled':
        from bot.session_registry import revoke_subject
        revoke_subject('customer', str(customer_id))
    with store.STORE_LOCK:
        path = store_path or store._default_customer_store_path()
        profiles = store.load_customer_profiles(path)
        now = store._now_iso()
        updated: Optional[Dict[str, Any]] = None
        editable_fields = ['name', 'phone', 'email', 'telegram', 'city', 'avatarUrl', 'bio', 'accountStatus']
        for (index, profile) in enumerate(profiles):
            if str(profile.get('id')) != str(customer_id):
                continue
            payload = store._normalize_customer_profile(profile)
            for field in editable_fields:
                if data.get(field) is not None:
                    payload[field] = str(data.get(field) or '').strip()
            if data.get('verificationStatus') is not None:
                status = store.normalize_verification_status(data.get('verificationStatus'), payload.get('verificationStatus'))
                if status in store.VERIFICATION_STATUSES:
                    payload['verificationStatus'] = status
                    payload['trustedBadges'] = store._verification_badges(status, 'customer')
            payload['updatedAt'] = now
            payload['profileCompleteness'] = store._customer_profile_completeness(payload)
            profiles[index] = payload
            updated = payload
            break
        if updated is None:
            raise ValueError('customer profile not found')
        store.save_customer_profiles(profiles, path)
        return store.prepare_customer_profile_for_admin(updated)


def admin_update_provider_profile(provider_id: str, data: Dict[str, Any], store_path: Optional[Path]=None) -> Dict[str, Any]:
    if str(data.get('accountStatus') or '').lower() == 'disabled':
        from bot.session_registry import revoke_subject
        revoke_subject('provider', str(provider_id))
    providers = store.load_providers(store_path)
    now = store._now_iso()
    updated: Optional[Dict[str, Any]] = None
    for (index, provider) in enumerate(providers):
        if str(provider.get('id')) != str(provider_id):
            continue
        provider.pop('stale', None)
        provider = store._normalize_provider_trust(provider)
        for field in ('name', 'phone', 'telegram', 'vehicle', 'vehicleMake', 'vehicleModel', 'plate', 'city', 'address', 'website', 'openingHours', 'accountStatus'):
            if data.get(field) is not None:
                provider[field] = str(data.get(field) or '').strip()
        if data.get('specialties') is not None:
            specialties = store._clean_provider_specialties(data.get('specialties'))
            if specialties:
                provider['specialties'] = specialties
        if data.get('serviceRadiusKm') is not None:
            try:
                radius = int(data.get('serviceRadiusKm') or provider.get('serviceRadiusKm') or 15)
            except (TypeError, ValueError):
                radius = 15
            provider['serviceRadiusKm'] = max(1, min(radius, 100))
        if data.get('status') in store.PROVIDER_STATUSES:
            provider['status'] = str(data.get('status'))
        if data.get('verificationStatus') is not None:
            status = store.normalize_verification_status(data.get('verificationStatus'), provider.get('verificationStatus'))
            if status in store.VERIFICATION_STATUSES:
                provider['verificationStatus'] = status
                provider['trustedBadges'] = store._verification_badges(status, 'provider')
        if isinstance(data.get('location'), dict):
            provider['location'] = data['location']
            provider['lastLocationAt'] = now
        provider['profileUpdatedAt'] = now
        provider['updatedAt'] = now
        providers[index] = provider
        updated = provider
        break
    if updated is None:
        raise ValueError('provider profile not found')
    store.save_providers(providers, store_path)
    return dict(updated)


def admin_delete_provider(provider_id: str, store_path: Optional[Path]=None) -> Dict[str, Any]:
    from bot.session_registry import revoke_subject
    revoke_subject('provider', str(provider_id))
    with store.STORE_LOCK:
        path = store_path or store._default_provider_store_path()
        providers = store.load_providers(path)
        remaining = [provider for provider in providers if str(provider.get('id')) != str(provider_id)]
        if len(remaining) == len(providers):
            raise ValueError('provider profile not found')
        store.save_providers(remaining, path)
        return {'deleted': True, 'providerId': str(provider_id)}
