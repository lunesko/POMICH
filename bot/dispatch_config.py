"""Alpha Priority-2 dispatch tuning: per-service radii and offer waves."""

from __future__ import annotations

import os
from typing import List

# Romchik P2 — initial search radius by service (km).
SERVICE_INITIAL_RADIUS_KM: dict[str, int] = {
    "battery": 10,
    "wheel": 10,
    "fuel": 15,
    "lockout": 15,
    "tow": 30,
    "mechanic": 20,
}

DEFAULT_SERVICE_INITIAL_RADIUS_KM = int(os.getenv("DISPATCH_DEFAULT_INITIAL_RADIUS_KM", "20") or "20")

# Wave 1: nearest N; after wait, wave 2 adds next M (still searching only).
DISPATCH_WAVE1_SIZE = int(os.getenv("DISPATCH_WAVE1_SIZE", "3") or "3")
DISPATCH_WAVE2_SIZE = int(os.getenv("DISPATCH_WAVE2_SIZE", "5") or "5")
DISPATCH_WAVE_WAIT_SECONDS = int(os.getenv("DISPATCH_WAVE_WAIT_SECONDS", "15") or "15")

# Absolute concurrent pending offers ceiling across all waves.
DISPATCH_MAX_CONCURRENT_OFFERS = int(os.getenv("DISPATCH_MAX_CONCURRENT_OFFERS", "8") or "8")


def initial_radius_km_for_service(service: str | None) -> int:
    key = str(service or "").strip().lower()
    return int(SERVICE_INITIAL_RADIUS_KM.get(key, DEFAULT_SERVICE_INITIAL_RADIUS_KM))


def search_radius_steps_for_service(service: str | None) -> List[int]:
    """Build expanding km steps from the service initial radius.

    Example tow (30): 30 → 45 → 60 → 100
    Example wheel (10): 10 → 15 → 25 → 50
    """
    initial = initial_radius_km_for_service(service)
    env_steps = [
        int(value)
        for value in os.getenv("SEARCH_RADIUS_STEPS_KM", "").split(",")
        if value.strip().isdigit()
    ]
    if env_steps:
        # Keep env override but never start below the service initial radius.
        steps = sorted({max(initial, step) for step in env_steps})
        if steps[0] > initial:
            steps = [initial, *steps]
        return steps

    return sorted(
        {
            initial,
            max(initial, int(round(initial * 1.5))),
            max(initial * 2, initial + 10),
            max(initial * 4, 50) if initial < 25 else max(initial * 3, 100),
        }
    )


def wave_batch_size(wave: int) -> int:
    if wave <= 1:
        return max(1, DISPATCH_WAVE1_SIZE)
    return max(1, DISPATCH_WAVE2_SIZE)
