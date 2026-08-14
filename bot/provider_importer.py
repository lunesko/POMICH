"""Import roadside-assistance directory providers from OSM for Ukraine settlements."""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from typing import Any

from bot.occupied_territories import filter_non_occupied_providers, is_occupied_coordinates
from bot.settlements import (
    load_settlements,
    settlement_bbox,
    settlement_by_id,
    settlement_by_name,
    settlement_center,
)

UZHGOROD_CENTER = {"lat": 48.6208, "lng": 22.2879}
UZHGOROD_BBOX = (48.58, 22.22, 48.66, 22.35)  # south, west, north, east
OVERPASS_URLS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)
# Split city queries when area is large or Overpass returns OOM/timeout.
MAX_BBOX_SPAN_DEG = 0.12  # ~13 km; larger bboxes are queried as a grid
OVERPASS_RETRIES = 3
OVERPASS_BACKOFF_SECONDS = 4.0

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
    "contact:fax",
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

KNOWN_CONTACTS: dict[str, dict[str, str]] = {
    "wog": {"phone": "+380800300001", "website": "https://wog.ua/"},
    "okko": {"phone": "+380800300370", "website": "https://okko.ua/"},
    "укрнафта": {"phone": "+380800504050", "website": "https://ukrnafta.com/"},
    "ukrnafta": {"phone": "+380800504050", "website": "https://ukrnafta.com/"},
    "brsm-nafta": {"phone": "+380800501130", "website": "https://www.brsm-nafta.com/"},
    "motto": {"phone": "+380800501801", "website": "https://motto.ua/"},
}


def _now_iso() -> str:
    return f"{datetime.now(timezone.utc).replace(tzinfo=None).isoformat(timespec='seconds')}Z"


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
    value = str(raw or "").strip()
    if not value:
        return ""
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
    haystack = f"{name} {tags.get('brand', '')} {tags.get('operator', '')} {tags.get('website', '')}".lower()
    for key, contact in KNOWN_CONTACTS.items():
        if key in haystack:
            return contact
    return {}


def _address_from_tags(tags: dict[str, Any], *, city: str) -> str:
    street = str(tags.get("addr:street") or "").strip()
    housenumber = str(tags.get("addr:housenumber") or "").strip()
    addr_city = str(tags.get("addr:city") or city).strip()
    street_line = " ".join(part for part in (street, housenumber) if part).strip()
    if street_line:
        return f"{street_line}, {addr_city}"
    addr_full = str(tags.get("addr:full") or "").strip()
    if addr_full:
        return addr_full
    name = str(tags.get("name") or "").strip()
    if name:
        return f"{name}, {city}"
    return f"{city}, Україна"


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
    city: str,
    oblast: str = "",
    settlement_id: str = "",
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
        "city": city,
        "contactStatus": contact_status,
        "verificationStatus": "verified",
        "registeredAt": now,
        "profileUpdatedAt": now,
        "lastSeenAt": now,
        "lastLocationAt": now,
        "updatedAt": now,
    }
    if oblast:
        record["oblast"] = oblast
    if settlement_id:
        record["settlementId"] = settlement_id
    if normalized_phone:
        record["phone"] = normalized_phone
    if website:
        record["website"] = website
    if opening_hours:
        record["openingHours"] = opening_hours
    return record


def seed_uzhgorod_providers() -> list[dict[str, Any]]:
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
                city="Ужгород",
                oblast="Закарпатська",
                settlement_id="uzhhorod",
                vehicle=vehicle,
            )
        )
    return records


def _overpass_query(bbox: tuple[float, float, float, float]) -> str:
    south, west, north, east = bbox
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


def _bbox_span(bbox: tuple[float, float, float, float]) -> tuple[float, float]:
    south, west, north, east = bbox
    return (max(0.0, north - south), max(0.0, east - west))


def _split_bbox(
    bbox: tuple[float, float, float, float],
    *,
    rows: int = 2,
    cols: int = 2,
) -> list[tuple[float, float, float, float]]:
    south, west, north, east = bbox
    rows = max(1, rows)
    cols = max(1, cols)
    lat_step = (north - south) / rows
    lng_step = (east - west) / cols
    chunks: list[tuple[float, float, float, float]] = []
    for row in range(rows):
        for col in range(cols):
            chunk_south = south + row * lat_step
            chunk_west = west + col * lng_step
            chunk_north = north if row == rows - 1 else chunk_south + lat_step
            chunk_east = east if col == cols - 1 else chunk_west + lng_step
            chunks.append((chunk_south, chunk_west, chunk_north, chunk_east))
    return chunks


def _needs_bbox_split(bbox: tuple[float, float, float, float]) -> bool:
    lat_span, lng_span = _bbox_span(bbox)
    return lat_span > MAX_BBOX_SPAN_DEG or lng_span > MAX_BBOX_SPAN_DEG


def _is_overpass_capacity_error(exc: BaseException) -> bool:
    text = str(exc).lower()
    return any(
        token in text
        for token in (
            "oom",
            "out of memory",
            "timeout",
            "too many requests",
            "rate_limited",
            "429",
            "504",
            "503",
            "gateway",
            "remark",
        )
    )


def _fetch_overpass_payload(bbox: tuple[float, float, float, float], *, user_agent_suffix: str) -> dict[str, Any]:
    body = _overpass_query(bbox).encode("utf-8")
    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": f"POMICH/1.0 ({user_agent_suffix})",
    }
    last_error: Exception | None = None
    for attempt in range(OVERPASS_RETRIES):
        for overpass_url in OVERPASS_URLS:
            request = urllib.request.Request(overpass_url, data=body, headers=headers, method="POST")
            try:
                with urllib.request.urlopen(request, timeout=120) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                remark = str(payload.get("remark") or "").lower()
                if any(token in remark for token in ("runtime error", "out of memory", "timeout")):
                    raise urllib.error.URLError(f"overpass remark: {payload.get('remark')}")
                return payload
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError, ValueError) as exc:
                last_error = exc
                continue
        if attempt + 1 < OVERPASS_RETRIES:
            time.sleep(OVERPASS_BACKOFF_SECONDS * (attempt + 1))
    if last_error:
        raise last_error
    raise urllib.error.URLError("no Overpass endpoints configured")


def _providers_from_payload(
    payload: dict[str, Any],
    *,
    city: str,
    settlement_id: str,
    oblast: str,
    seen: set[str],
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    id_prefix = settlement_id or _slug(city)
    for element in payload.get("elements", []):
        tags = element.get("tags") or {}
        name = str(tags.get("name") or tags.get("operator") or tags.get("brand") or "").strip()
        if not name:
            continue
        lat = element.get("lat") or (element.get("center") or {}).get("lat")
        lng = element.get("lon") or (element.get("center") or {}).get("lon")
        if lat is None or lng is None:
            continue
        lat_f = float(lat)
        lng_f = float(lng)
        if is_occupied_coordinates(lat_f, lng_f):
            continue
        dedupe_key = f"{name.lower()}:{round(lat_f, 4)}:{round(lng_f, 4)}"
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
        provider_id = f"{id_prefix}-osm-{element.get('type', 'node')}-{element.get('id', uuid.uuid4().hex[:8])}"
        records.append(
            _normalize_provider_record(
                provider_id=provider_id,
                name=name,
                phone=phone,
                address=_address_from_tags(tags, city=city),
                lat=lat_f,
                lng=lng_f,
                specialties=specialties,
                source="osm",
                city=city,
                oblast=oblast,
                settlement_id=settlement_id,
                website=website,
                opening_hours=opening_hours,
            )
        )
    return records


def fetch_overpass_providers(
    bbox: tuple[float, float, float, float],
    *,
    city: str,
    settlement_id: str,
    oblast: str = "",
    user_agent_suffix: str = "provider-import",
    _depth: int = 0,
) -> list[dict[str, Any]]:
    """Fetch OSM providers for a bbox, auto-splitting large/failing queries."""
    seen: set[str] = set()
    if _needs_bbox_split(bbox) and _depth < 3:
        records: list[dict[str, Any]] = []
        for chunk in _split_bbox(bbox, rows=2, cols=2):
            chunk_records = fetch_overpass_providers(
                chunk,
                city=city,
                settlement_id=settlement_id,
                oblast=oblast,
                user_agent_suffix=user_agent_suffix,
                _depth=_depth + 1,
            )
            for item in chunk_records:
                key = f"{item['name'].lower()}:{item['location']['lat']:.4f}:{item['location']['lng']:.4f}"
                if key in seen:
                    continue
                seen.add(key)
                records.append(item)
            time.sleep(1.0)
        return records

    try:
        payload = _fetch_overpass_payload(bbox, user_agent_suffix=user_agent_suffix)
        return _providers_from_payload(
            payload,
            city=city,
            settlement_id=settlement_id,
            oblast=oblast,
            seen=seen,
        )
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError, ValueError) as exc:
        if _depth < 3 and _is_overpass_capacity_error(exc):
            records = []
            for chunk in _split_bbox(bbox, rows=2, cols=2):
                chunk_records = fetch_overpass_providers(
                    chunk,
                    city=city,
                    settlement_id=settlement_id,
                    oblast=oblast,
                    user_agent_suffix=user_agent_suffix,
                    _depth=_depth + 1,
                )
                for item in chunk_records:
                    key = f"{item['name'].lower()}:{item['location']['lat']:.4f}:{item['location']['lng']:.4f}"
                    if key in seen:
                        continue
                    seen.add(key)
                    records.append(item)
                time.sleep(1.5)
            return records
        raise


def import_settlement_providers(
    settlement: dict[str, Any],
    *,
    prefer_osm: bool = True,
    use_seed: bool = False,
) -> dict[str, Any]:
    settlement_id = str(settlement.get("id") or "")
    city = str(settlement.get("name") or "")
    oblast = str(settlement.get("oblast") or "")
    bbox = settlement_bbox(settlement) or UZHGOROD_BBOX
    center = settlement_center(settlement) or UZHGOROD_CENTER

    imported: list[dict[str, Any]] = []
    osm_count = 0
    seed_count = 0
    source = "seed" if use_seed and not prefer_osm else "osm"

    if prefer_osm:
        try:
            osm_records = fetch_overpass_providers(
                bbox,
                city=city,
                settlement_id=settlement_id,
                oblast=oblast,
                user_agent_suffix=f"{settlement_id}-import",
            )
            imported.extend(osm_records)
            osm_count = len(osm_records)
            if osm_records:
                source = "osm"
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError, ValueError):
            osm_count = 0

    seed_fallback = use_seed or (settlement_id == "uzhhorod" and prefer_osm and osm_count == 0)
    if seed_fallback and settlement_id == "uzhhorod":
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

    with_phone = sum(1 for item in imported if item.get("phone"))
    directory_only = len(imported) - with_phone

    return {
        "settlementId": settlement_id,
        "city": city,
        "oblast": oblast,
        "source": source,
        "providers": filter_non_occupied_providers(imported),
        "counts": {
            "osm": osm_count,
            "seed": seed_count,
            "total": len(imported),
            "withPhone": with_phone,
            "directoryOnly": directory_only,
        },
        "center": center,
        "bbox": list(bbox),
    }


def import_uzhgorod_providers(*, prefer_osm: bool = True, use_seed: bool = False) -> dict[str, Any]:
    """Backward-compatible Uzhgorod import."""
    settlement = settlement_by_id("uzhhorod") or settlement_by_name("Ужгород") or {
        "id": "uzhhorod",
        "name": "Ужгород",
        "oblast": "Закарпатська",
        "center": UZHGOROD_CENTER,
        "bbox": list(UZHGOROD_BBOX),
    }
    result = import_settlement_providers(settlement, prefer_osm=prefer_osm, use_seed=use_seed)
    return {
        "source": result["source"],
        "providers": result["providers"],
        "counts": result["counts"],
        "center": result["center"],
    }


def import_ukraine_providers(
    *,
    settlement_ids: list[str] | None = None,
    oblast: str | None = None,
    prefer_osm: bool = True,
    use_seed: bool = False,
    delay_seconds: float = 2.0,
) -> dict[str, Any]:
    """Batch import directory providers for one or more settlements."""
    all_settlements = load_settlements()
    if settlement_ids:
        selected = [item for item in all_settlements if str(item.get("id") or "") in settlement_ids]
    elif oblast:
        needle = str(oblast).strip().casefold()
        selected = [item for item in all_settlements if str(item.get("oblast") or "").strip().casefold() == needle]
    else:
        selected = list(all_settlements)

    combined: list[dict[str, Any]] = []
    per_settlement: list[dict[str, Any]] = []
    total_selected = len(selected)

    def _status(**kwargs: Any) -> None:
        try:
            from scripts.ops.import_monitor_status import write_import_status

            write_import_status(**kwargs)
        except Exception:
            pass

    _status(
        phase="running",
        total=total_selected,
        completed=0,
        message=f"Starting import of {total_selected} settlements",
    )

    for index, settlement in enumerate(selected):
        if index > 0 and delay_seconds > 0:
            time.sleep(delay_seconds)
        _status(
            phase="running",
            current_city=str(settlement.get("name") or ""),
            current_oblast=str(settlement.get("oblast") or ""),
            current_settlement_id=str(settlement.get("id") or ""),
            completed=index,
            total=total_selected,
            providers_stored=len(combined),
            message=f"Importing {settlement.get('name') or settlement.get('id')}",
        )
        result = import_settlement_providers(settlement, prefer_osm=prefer_osm, use_seed=use_seed and str(settlement.get("id")) == "uzhhorod")
        combined.extend(result["providers"])
        per_settlement.append(
            {
                "settlementId": result["settlementId"],
                "city": result["city"],
                "counts": result["counts"],
                "source": result["source"],
            }
        )

    with_phone = sum(1 for item in combined if item.get("phone"))
    _status(
        phase="done",
        completed=total_selected,
        total=total_selected,
        providers_stored=len(combined),
        message=f"Finished {total_selected} settlements, {len(combined)} providers",
    )
    return {
        "settlements": len(selected),
        "providers": filter_non_occupied_providers(combined),
        "perSettlement": per_settlement,
        "counts": {
            "total": len(combined),
            "withPhone": with_phone,
            "directoryOnly": len(combined) - with_phone,
        },
    }
