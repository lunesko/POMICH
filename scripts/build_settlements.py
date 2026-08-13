#!/usr/bin/env python3
"""Build/expand data/settlements.json from OSM place nodes (city/town/village)."""

from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from bot.occupied_territories import is_occupied_coordinates  # noqa: E402

SETTLEMENTS_PATH = ROOT / "data" / "settlements.json"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Free Ukraine (approximate) — individual places still filtered by occupied bboxes.
FREE_UA_BBOX = (44.35, 22.10, 52.40, 40.20)  # south, west, north, east

OBLAST_BY_REGION: dict[str, str] = {
    "zakarpattia": "Закарпатська",
    "volyn": "Волинська",
    "lviv": "Львівська",
    "ternopil": "Тернопільська",
    "ivano-frankivsk": "Івано-Франківська",
    "chernivtsi": "Чернівецька",
    "rivne": "Рівненська",
    "zhytomyr": "Житомирська",
    "vinnytsia": "Вінницька",
    "khmelnytskyi": "Хмельницька",
    "cherkasy": "Черкаська",
    "kirovohrad": "Кіровоградська",
    "poltava": "Полтавська",
    "sumy": "Сумська",
    "chernihiv": "Чернігівська",
    "kyiv": "Київська",
    "kyiv-city": "Київ",
    "kharkiv": "Харківська",
    "donetsk": "Донецька",
    "luhansk": "Луганська",
    "dnipropetrovsk": "Дніпропетровська",
    "zaporizhzhia": "Запорізька",
    "mykolaiv": "Миколаївська",
    "kherson": "Херсонська",
    "odesa": "Одеська",
    "crimea": "АР Крим",
}


def _slug(value: str) -> str:
    translit = {
        "а": "a", "б": "b", "в": "v", "г": "h", "ґ": "g", "д": "d", "е": "e", "є": "ye",
        "ж": "zh", "з": "z", "и": "y", "і": "i", "ї": "yi", "й": "y", "к": "k", "л": "l",
        "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
        "ф": "f", "х": "kh", "ц": "ts", "ч": "ch", "ш": "sh", "щ": "shch", "ь": "", "ю": "yu", "я": "ya",
        "'": "", "’": "", "`": "",
    }
    lowered = value.lower().strip()
    chars = []
    for ch in lowered:
        if ch in translit:
            chars.append(translit[ch])
        elif re.match(r"[a-z0-9]", ch):
            chars.append(ch)
        elif ch in (" ", "-", "_"):
            chars.append("-")
    slug = re.sub(r"-+", "-", "".join(chars)).strip("-")
    return slug or "settlement"


def _bbox_around(lat: float, lng: float, *, delta: float) -> list[float]:
    return [lat - delta, lng - delta, lat + delta, lng + delta]


def _place_type(tags: dict) -> str:
    place = str(tags.get("place") or "town").lower()
    if place in ("city", "town", "village", "hamlet"):
        return place
    return "town"


def _oblast_from_tags(tags: dict) -> str:
    for key in ("addr:region", "is_in:region", "region", "addr:state"):
        value = str(tags.get(key) or "").strip()
        if value:
            if "обл" in value.lower():
                return value.replace(" область", "ська").replace(" oblast", "ська")
            if value in OBLAST_BY_REGION.values() or value == "Київ":
                return value
    is_in = str(tags.get("is_in") or "")
    for oblast in OBLAST_BY_REGION.values():
        if oblast.casefold() in is_in.casefold():
            return oblast
    return ""


def fetch_osm_places() -> list[dict]:
    south, west, north, east = FREE_UA_BBOX
    query = f"""
[out:json][timeout:180];
(
  node["place"~"city|town|village"]({south},{west},{north},{east});
);
out tags;
"""
    request = urllib.request.Request(
        OVERPASS_URL,
        data=query.encode("utf-8"),
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "POMICH/1.0 (settlement-build)",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=200) as response:
        payload = json.loads(response.read().decode("utf-8"))

    places: list[dict] = []
    for element in payload.get("elements", []):
        tags = element.get("tags") or {}
        name = str(tags.get("name:uk") or tags.get("name") or "").strip()
        if not name:
            continue
        lat = element.get("lat")
        lng = element.get("lon")
        if lat is None or lng is None:
            continue
        lat_f = float(lat)
        lng_f = float(lng)
        if is_occupied_coordinates(lat_f, lng_f):
            continue
        place_type = _place_type(tags)
        # Skip tiny hamlets — keep city/town and larger villages
        population_raw = tags.get("population")
        try:
            population = int(str(population_raw).replace(" ", "")) if population_raw else 0
        except ValueError:
            population = 0
        if place_type == "village" and population and population < 800:
            continue
        delta = 0.06 if place_type == "city" else 0.04 if place_type == "town" else 0.025
        places.append(
            {
                "id": _slug(name),
                "name": name,
                "oblast": _oblast_from_tags(tags),
                "type": place_type,
                "center": {"lat": round(lat_f, 6), "lng": round(lng_f, 6)},
                "bbox": [round(v, 4) for v in _bbox_around(lat_f, lng_f, delta=delta)],
                "population": population or None,
            }
        )
    return places


def merge_settlements(existing: list[dict], incoming: list[dict]) -> list[dict]:
    by_id: dict[str, dict] = {}
    for item in existing:
        sid = str(item.get("id") or "").strip()
        if sid:
            by_id[sid] = item
    for item in incoming:
        sid = str(item.get("id") or "").strip()
        if not sid:
            continue
        if sid in by_id:
            prev = by_id[sid]
            merged = {**prev, **{k: v for k, v in item.items() if v}}
            if prev.get("oblast") and not merged.get("oblast"):
                merged["oblast"] = prev["oblast"]
            by_id[sid] = merged
        else:
            by_id[sid] = item
    return sorted(by_id.values(), key=lambda x: (str(x.get("oblast") or ""), str(x.get("name") or "")))


def main() -> int:
    existing: list[dict] = []
    if SETTLEMENTS_PATH.exists():
        payload = json.loads(SETTLEMENTS_PATH.read_text(encoding="utf-8"))
        existing = payload.get("settlements") if isinstance(payload, dict) else payload
        if not isinstance(existing, list):
            existing = []

    print(f"Existing settlements: {len(existing)}")
    print("Fetching OSM places for free Ukraine...")
    try:
        osm_places = fetch_osm_places()
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as exc:
        print(f"OSM fetch failed: {exc}")
        return 1

    merged = merge_settlements(existing, osm_places)
    # Drop entries without oblast if we can't infer — keep manual oblast centers
    with_oblast = [item for item in merged if item.get("oblast")]
    without_oblast = len(merged) - len(with_oblast)
    if without_oblast:
        print(f"Keeping {without_oblast} settlements without oblast tag from manual seed")

    output = {
        "version": 2,
        "description": "Ukraine settlements for directory parsing. Occupied coords excluded at import.",
        "settlements": merged,
    }
    SETTLEMENTS_PATH.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    oblasts = sorted({str(x.get("oblast") or "") for x in merged if x.get("oblast")})
    print(f"OSM places fetched: {len(osm_places)}")
    print(f"Merged settlements: {len(merged)}")
    print(f"Oblasts covered: {len(oblasts)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
