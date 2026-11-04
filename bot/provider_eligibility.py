"""Shared trust policy for presence, dispatch and offer acceptance."""


def provider_can_take_orders(provider: dict) -> bool:
    if str(provider.get("accountStatus") or "active").lower() == "disabled":
        return False
    status = str(provider.get("verificationStatus") or "unverified").lower()
    if status == "rejected":
        return False
    verification = provider.get("verification") or {}
    return status == "verified" or (isinstance(verification, dict) and verification.get("phone") is True)
