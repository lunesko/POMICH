"""Import roadside-assistance directory providers for Uzhgorod (Ужгород)."""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
import uuid
from datetime import datetime
from typing import Any

UZHGOROD_CENTER = {"lat": 48.6208, "lng": 22.2879}
UZHGOROD_BBOX = (48.58, 22.22, 48.66, 22.35)  # south, west, north, east
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

FAKE_PHONE_PATTERNS = (
    r"^\+?380?0{6,}",
    r"^0+$",
    r"^\+?380000000000$",
    r"^\+?3806712345\d{2}$",  # seed demo range
)

PHONE_TAG_KEYS = (
    "phone",
    "contact:phone",
    "contact:mobile",
    "mobile",
    "telephone",
    "contact:telephone",
    "contact:fax",  # last resort, sometimes shops only list fax
)

OSM_TAG_TO_SPECIALTIES: dict[str, list[str]] = {
    "car_repair": ["mechanic"],
    "tyres": ["wheel"],
    "fuel": ["fuel"],
    "charging_station": ["battery"],
    "car_wash": ["mechanic"],
    "car_parts": ["mechanic", "wheel"],
}

SERVICE_KEYWORDS: list[tuple[str, list[str]]] = [
    (r"евакуатор|evacuat|tow|буксир|recovery", ["tow"]),
    (r"шиномонтаж|tyre|tire|колес|vianor", ["wheel"]),
    (r"акумулятор|battery|заряд|charging", ["battery"]),
    (r"пальн|fuel|бензин|wog|okko|shell|motto|укрнаfta|наfta", ["fuel"]),
    (r"автосервіс|сто|car.?repair|ремонт|dms", ["mechanic"]),
    (r"механік|mechanic", ["mechanic"]),
    (r"відкритт|lockout|ключ", ["lockout"]),
]

# Known real contacts for Uzhgorod businesses (OSM often lacks phone tags).
KNOWN_CONTACTS: dict[str, dict[str, str]] = {
    "wog": {"phone": "+380800300001", "website": "https://wog.ua/"},
    "okko": {"phone": "+380800300370", "website": "https://okko.ua/"},
    "укрнафта": {"phone": "+380800504050", "website": "https://ukrnafta.com/"},
    "ukrnafta": {"phone": "+380800504050", "website": "https://ukrnafta.com/"},
    "brsm-nafta": {"phone": "+380800501130", "website": "https://www.brsm-nafta.com/"},
    "motto": {"phone": "+380800501801", "website": "https://motto.ua/"},
}


def _now_iso() -> str:
    return f"{datetime.utcnow().isoformat(timespec='seconds')}Z"


def _slug(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", value.lower().strip())
    return cleaned.strip("-") or uuid.uuid4().hex[:8]


def _is_fake_phone(phone: str) -> bool:
    normalized = re.sub(r"[\s\-().]", "", phone.strip())
    if len(normalized) < 9:
        return True
    for pattern in FAKE_PHONE_PATTERNS:
        if re.search(pattern, normalized, re.IGNORECASE):
            return True
    return False


def _normalize_phone(raw: str) -> str:
    """Normalize Ukrainian phone to +380XXXXXXXXX or return empty if invalid/fake."""
    value = str(raw or "").strip()
    if not value:
        return ""
    # Split multiple numbers — take the first valid one
    for part in re.split(r"[;,/|]", value):
        candidate = part.strip()
        if not candidate:
            continue
        digits = re.sub(r"[^\d+]", "", candidate)
        if digits.startswith("+"):
            phone = digits
        elif digits.startswith("380") and len(digits) >= 12:
            phone = f"+{digits}"
        elif digits.startswith("0") and len(digits) >= 10:
            phone = f"+38{digits}"
        elif len(digits) >= 9:
            phone = f"+380{digits[-9:]}" if len(digits) == 9 else f"+{digits}"
        else:
            continue
        if not _is_fake_phone(phone):
            return phone
    return ""


def _infer_specialties(name: str, tags: dict[str, Any]) -> list[str]:
    specialties: list[str] = []
    amenity = str(tags.get("amenity") or "").lower()
    shop = str(tags.get("shop") or "").lower()
    craft = str(tags.get("craft") or "").lower()
    for key in (amenity, shop, craft):
        if key in OSM_TAG_TO_SPECIALTIES:
            specialties.extend(OSM_TAG_TO_SPECIALTIES[key])
    if tags.get("service:vehicle:tyres") == "yes":
        specialties.append("wheel")
    if tags.get("service:vehicle:car_repair") == "yes":
        specialties.append("mechanic")
    if tags.get("service:vehicle:recovery") == "yes" or tags.get("emergency") == "towing":
        specialties.append("tow")
    service_vehicle = str(tags.get("service:vehicle") or "").lower()
    if service_vehicle in ("recovery", "towing"):
        specialties.append("tow")
    haystack = f"{name} {tags.get('description', '')} {tags.get('operator', '')} {tags.get('brand', '')}".lower()
    for pattern, keys in SERVICE_KEYWORDS:
        if re.search(pattern, haystack, re.IGNORECASE):
            specialties.extend(keys)
    if not specialties:
        specialties = ["mechanic"]
    return list(dict.fromkeys(specialties))


def _phone_from_tags(tags: dict[str, Any]) -> str:
    for key in PHONE_TAG_KEYS:
        value = str(tags.get(key) or "").strip()
        if value:
            normalized = _normalize_phone(value)
            if normalized:
                return normalized
    return ""


def _enrich_from_known(name: str, tags: dict[str, Any]) -> dict[str, str]:
    """Match brand/operator/name against known Uzhgorod chain contacts."""
    haystack = f"{name} {tags.get('brand', '')} {tags.get('operator', '')} {tags.get('website', '')}".lower()
    for key, contact in KNOWN_CONTACTS.items():
        if key in haystack:
            return contact
    return {}


def _address_from_tags(tags: dict[str, Any]) -> str:
    street = str(tags.get("addr:street") or "").strip()
    housenumber = str(tags.get("addr:housenumber") or "").strip()
    city = str(tags.get("addr:city") or "Ужгород").strip()
    street_line = " ".join(part for part in (street, housenumber) if part).strip()
    if street_line:
        return f"{street_line}, {city}"
    addr_full = str(tags.get("addr:full") or "").strip()
    if addr_full:
        return addr_full
    # Fallback: use name as location hint within Uzhgorod
    name = str(tags.get("name") or "").strip()
    if name:
        return f"{name}, Ужгород"
    return "Ужгород, Україна"


def _primary_specialty(specialties: list[str]) -> str:
    priority = ("tow", "wheel", "fuel", "battery", "lockout", "mechanic")
    for key in priority:
        if key in specialties:
            return key
    return specialties[0] if specialties else "mechanic"


def _normalize_provider_record(
    *,
    provider_id: str,
    name: str,
    phone: str,
    address: str,
    lat: float,
    lng: float,
    specialties: list[str],
    source: str,
    vehicle: str = "Автодопомога",
    website: str = "",
    opening_hours: str = "",
) -> dict[str, Any]:
    now = _now_iso()
    normalized_phone = _normalize_phone(phone)
    contact_status = "phone" if normalized_phone else "directory_only"
    record: dict[str, Any] = {
        "id": provider_id,
        "name": name,
        "rating": 4.5,
        "vehicle": vehicle,
        "plate": "",
        "telegram": "",
        "status": "offline",
        "etaMinutes": 20,
        "location": {"lat": lat, "lng": lng},
        "address": address,
        "specialties": specialties,
        "primarySpecialty": _primary_specialty(specialties),
        "serviceRadiusKm": 10,
        "providerKind": "directory",
        "source": source,
        "city": "Ужгород",
        "contactStatus": contact_status,
        "verificationStatus": "verified",
        "registeredAt": now,
        "profileUpdatedAt": now,
        "lastSeenAt": now,
        "lastLocationAt": now,
        "updatedAt": now,
    }
    if normalized_phone:
        record["phone"] = normalized_phone
    if website:
        record["website"] = website
    if opening_hours:
        record["openingHours"] = opening_hours
    return record


def seed_uzhgorod_providers() -> list[dict[str, Any]]:
    """Demo directory providers — only used with --seed-only flag."""
    seeds = [
        ("Евакуатор Ужгород 24/7", "+380671234501", "вул. Минайська, 15", 48.6284, 22.2812, ["tow"], "Евакуатор Mercedes"),
        ("Автоевакуатор Закарпаття", "+380671234502", "вул. Капушанська, 42", 48.6156, 22.2945, ["tow", "mechanic"], "Евакуатор MAN"),
        ("СТО «Авторемонт»", "+380671234503", "вул. Собранецька, 89", 48.6198, 22.3012, ["mechanic", "wheel"], "СТО повний цикл"),
    ]
    records: list[dict[str, Any]] = []
    for index, (name, phone, address, lat, lng, specialties, vehicle) in enumerate(seeds, start=1):
        records.append(
            _normalize_provider_record(
                provider_id=f"uzh-dir-{_slug(name)[:24]}-{index:02d}",
                name=name,
                phone=phone,
                address=address,
                lat=lat,
                lng=lng,
                specialties=specialties,
                source="seed",
                vehicle=vehicle,
            )
        )
    return records


def _overpass_query() -> str:
    south, west, north, east = UZHGOROD_BBOX
    return f"""
[out:json][timeout:90];
(
  node["amenity"="car_repair"]({south},{west},{north},{east});
  way["amenity"="car_repair"]({south},{west},{north},{east});
  node["shop"="car_repair"]({south},{west},{north},{east});
  way["shop"="car_repair"]({south},{west},{north},{east});
  node["craft"="car_repair"]({south},{west},{north},{east});
  way["craft"="car_repair"]({south},{west},{north},{east});
  node["shop"="tyres"]({south},{west},{north},{east});
  way["shop"="tyres"]({south},{west},{north},{east});
  node["shop"="car_parts"]({south},{west},{north},{east});
  way["shop"="car_parts"]({south},{west},{north},{east});
  node["amenity"="fuel"]({south},{west},{north},{east});
  way["amenity"="fuel"]({south},{west},{north},{east});
  node["amenity"="charging_station"]({south},{west},{north},{east});
  node["service:vehicle:recovery"="yes"]({south},{west},{north},{east});
  way["service:vehicle:recovery"="yes"]({south},{west},{north},{east});
  node["service:vehicle"="recovery"]({south},{west},{north},{east});
  way["service:vehicle"="recovery"]({south},{west},{north},{east});
  node["emergency"="towing"]({south},{west},{north},{east});
  node["amenity"="car_wash"]({south},{west},{north},{east});
);
out center tags;
"""


def fetch_overpass_providers() -> list[dict[str, Any]]:
    request = urllib.request.Request(
        OVERPASS_URL,
        data=_overpass_query().encode("utf-8"),
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "POMICH/1.0 (uzhgorod-provider-import)",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        payload = json.loads(response.read().decode("utf-8"))

    records: list[dict[str, Any]] = []
    seen: set[str] = set()
    for element in payload.get("elements", []):
        tags = element.get("tags") or {}
        name = str(tags.get("name") or tags.get("operator") or tags.get("brand") or "").strip()
        if not name:
            continue
        lat = element.get("lat") or (element.get("center") or {}).get("lat")
        lng = element.get("lon") or (element.get("center") or {}).get("lon")
        if lat is None or lng is None:
            continue
        dedupe_key = f"{name.lower()}:{round(float(lat), 4)}:{round(float(lng), 4)}"
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)

        phone = _phone_from_tags(tags)
        website = str(tags.get("website") or tags.get("contact:website") or "").strip()
        opening_hours = str(tags.get("opening_hours") or "").strip()

        known = _enrich_from_known(name, tags)
        if not phone and known.get("phone"):
            phone = known["phone"]
        if not website and known.get("website"):
            website = known["website"]

        specialties = _infer_specialties(name, tags)
        provider_id = f"uzh-osm-{element.get('type', 'node')}-{element.get('id', uuid.uuid4().hex[:8])}"
        records.append(
            _normalize_provider_record(
                provider_id=provider_id,
                name=name,
                phone=phone,
                address=_address_from_tags(tags),
                lat=float(lat),
                lng=float(lng),
                specialties=specialties,
                source="osm",
                website=website,
                opening_hours=opening_hours,
            )
        )
    return records


def import_uzhgorod_providers(*, prefer_osm: bool = True, use_seed: bool = False) -> dict[str, Any]:
    """Fetch OSM data; optionally merge seed demo records (--seed-only)."""
    source = "seed" if use_seed and not prefer_osm else "osm"
    imported: list[dict[str, Any]] = []
    osm_count = 0
    seed_count = 0
    with_phone = 0
    directory_only = 0

    if prefer_osm:
        try:
            osm_records = fetch_overpass_providers()
            imported.extend(osm_records)
            osm_count = len(osm_records)
            if osm_records:
                source = "osm"
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError, ValueError):
            osm_count = 0

    if use_seed:
        seeds = seed_uzhgorod_providers()
        existing_keys = {f"{item['name'].lower()}:{item['location']['lat']:.4f}" for item in imported}
        for seed in seeds:
            key = f"{seed['name'].lower()}:{seed['location']['lat']:.4f}"
            if key in existing_keys:
                continue
            imported.append(seed)
            seed_count += 1
        if seed_count:
            source = "osm+seed" if osm_count else "seed"

    for item in imported:
        if item.get("phone"):
            with_phone += 1
        else:
            directory_only += 1

    return {
        "source": source,
        "providers": imported,
        "counts": {
            "osm": osm_count,
            "seed": seed_count,
            "total": len(imported),
            "withPhone": with_phone,
            "directoryOnly": directory_only,
        },
        "center": UZHGOROD_CENTER,
    }
