"""Shared orders test builders."""
from datetime import datetime, timezone

def _provider(provider_id, lat, lng, specialties=None, status="online", radius=50, assigned_order_id=None, last_seen_at=None):
    now = datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec="seconds")
    payload = {
        "id": provider_id,
        "name": provider_id,
        "rating": 4.8,
        "vehicle": "Service van",
        "plate": "AO 1248 CH",
        "phone": "+380000000000",
        "telegram": "pomich_help_bot",
        "status": status,
        "etaMinutes": 10,
        "location": {"lat": lat, "lng": lng},
        "specialties": specialties or ["tow"],
        "serviceRadiusKm": radius,
        "verificationStatus": "verified",
        "verification": {
            "identityDocument": True,
            "driverLicense": True,
            "vehicleRegistration": True,
            "serviceProof": True,
            "selfieCheck": True,
            "backgroundCheck": "passed",
        },
        "registeredAt": now,
        "profileUpdatedAt": now,
        "lastSeenAt": last_seen_at or now,
        "lastLocationAt": last_seen_at or now,
        "updatedAt": last_seen_at or now,
    }
    if assigned_order_id:
        payload["assignedOrderId"] = assigned_order_id
    return payload
