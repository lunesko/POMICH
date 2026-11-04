"""Bounded OSRM integration; estimates always distinguish roads from straight lines."""
from __future__ import annotations

import math
import os
import threading
import time
from collections import OrderedDict
from typing import Literal

import httpx
from pydantic import BaseModel, Field

_CACHE: OrderedDict = OrderedDict()
_LOCK = threading.Lock()
_SLOTS = threading.BoundedSemaphore(4)


class RouteResponse(BaseModel):
    coordinates: list[tuple[float, float]] = Field(default_factory=list)
    distanceMeters: float | None = None
    durationSeconds: float | None = None
    source: Literal["osrm", "unavailable"]


def distance_km(a: dict, b: dict) -> float:
    lat = math.radians(float(b["lat"]) - float(a["lat"]))
    lng = math.radians(float(b["lng"]) - float(a["lng"]))
    term = math.sin(lat / 2) ** 2 + math.cos(math.radians(a["lat"])) * math.cos(math.radians(b["lat"])) * math.sin(lng / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(min(1, max(0, term))))


def _base() -> str:
    return os.getenv("POMICH_OSRM_URL", "").strip().rstrip("/")


def _request(path: str, params: dict) -> dict | None:
    base = _base()
    if not base:
        return None
    key = (base, path, tuple(sorted(params.items())))
    with _LOCK:
        entry = _CACHE.get(key)
        if entry and entry[0] > time.monotonic():
            _CACHE.move_to_end(key)
            return entry[1]
    # Do not let a slow routing server exhaust API/worker threads.
    if not _SLOTS.acquire(blocking=False):
        return None
    result = None
    try:
        with httpx.Client(timeout=httpx.Timeout(2.0, connect=0.5), follow_redirects=False) as client:
            response = client.get(base + path, params=params)
            response.raise_for_status()
            if len(response.content) <= 2_000_000:
                data = response.json()
                if isinstance(data, dict) and data.get("code") == "Ok":
                    result = data
    except (httpx.HTTPError, ValueError):
        pass
    finally:
        _SLOTS.release()
    with _LOCK:
        _CACHE[key] = (time.monotonic() + (30 if result is not None else 5), result)
        _CACHE.move_to_end(key)
        while len(_CACHE) > 512:
            _CACHE.popitem(last=False)
    return result


def _coord(point: dict) -> str:
    return f"{float(point['lng']):.5f},{float(point['lat']):.5f}"


def _number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0


def estimate(from_point: dict, to_point: dict) -> dict:
    straight = distance_km(from_point, to_point)
    data = _request(f"/route/v1/driving/{_coord(from_point)};{_coord(to_point)}", {"overview": "false"})
    routes = data.get("routes") if data else None
    route = routes[0] if isinstance(routes, list) and routes and isinstance(routes[0], dict) else {}
    if _number(route.get("duration")) and _number(route.get("distance")):
        return {"distanceKm": round(straight, 2), "roadDistanceKm": round(route["distance"] / 1000, 2),
            "etaMinutes": max(1, math.ceil(route["duration"] / 60)), "etaSource": "osrm"}
    return {"distanceKm": round(straight, 2), "roadDistanceKm": None,
        "etaMinutes": max(1, math.ceil(straight * 4)), "etaSource": "approximate"}


def rank_candidates(candidates: list[dict], pickup: dict) -> list[dict]:
    """One matrix call for a geographically bounded shortlist, never one call per driver."""
    if not candidates:
        return []
    points = [candidate["location"] for candidate in candidates]
    coordinates = ";".join(_coord(point) for point in [*points, pickup])
    data = _request(f"/table/v1/driving/{coordinates}", {
        "sources": ";".join(str(index) for index in range(len(points))),
        "destinations": str(len(points)), "annotations": "duration,distance"})
    durations, distances = (data.get("durations"), data.get("distances")) if data else (None, None)
    matrix_valid = (isinstance(durations, list) and isinstance(distances, list)
        and len(durations) == len(points) and len(distances) == len(points)
        and all(isinstance(row, list) and len(row) == 1 for row in [*durations, *distances]))
    ranked = []
    for index, candidate in enumerate(candidates):
        item = dict(candidate)
        item.update(etaMinutes=max(1, math.ceil(float(item["distanceKm"]) * 4)), etaSource="approximate", roadDistanceKm=None)
        if matrix_valid:
            duration, distance = durations[index][0], distances[index][0]
            if duration is None or distance is None:
                continue  # OSRM explicitly reports no drivable route.
            if _number(duration) and _number(distance):
                item.update(etaMinutes=max(1, math.ceil(duration / 60)), etaSource="osrm", roadDistanceKm=round(distance / 1000, 2))
        ranked.append(item)
    # Avoid interleaving road ETA with a potentially optimistic straight-line
    # fallback when a matrix response is malformed/partial.
    if ranked and all(item["etaSource"] == "osrm" for item in ranked):
        return sorted(ranked, key=lambda item: (item["etaMinutes"], item["distanceKm"], str(item["id"])))
    return sorted(ranked, key=lambda item: (item["distanceKm"], str(item["id"])))


def route_geometry(from_point: dict, to_point: dict) -> RouteResponse:
    data = _request(f"/route/v1/driving/{_coord(from_point)};{_coord(to_point)}",
        {"overview": "full", "geometries": "geojson"})
    try:
        route = data["routes"][0]
        coordinates = route["geometry"]["coordinates"]
        if (not _number(route["distance"]) or not _number(route["duration"]) or not coordinates
                or not all(len(point) >= 2 and math.isfinite(point[0]) and math.isfinite(point[1])
                    and -180 <= point[0] <= 180 and -90 <= point[1] <= 90 for point in coordinates)):
            raise ValueError("invalid route")
        return RouteResponse(coordinates=[(lat, lng) for lng, lat, *_ in coordinates],
            distanceMeters=route["distance"], durationSeconds=route["duration"], source="osrm")
    except (KeyError, IndexError, TypeError, ValueError):
        return RouteResponse(source="unavailable")
