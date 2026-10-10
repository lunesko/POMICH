"""Exit non-zero when protected operational metrics contain an active alert."""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request


def main() -> int:
    url = os.getenv("POMICH_INTERNAL_METRICS_URL", "http://127.0.0.1:8000/internal/metrics")
    token = (os.getenv("POMICH_INTERNAL_TOKEN") or "").strip()
    if not token:
        print("POMICH_INTERNAL_TOKEN is required", file=sys.stderr)
        return 2
    request = urllib.request.Request(url, headers={"X-POMICH-Internal-Token": token})
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            payload = json.load(response)
    except (OSError, urllib.error.HTTPError, ValueError) as exc:
        print(f"metrics unavailable: {type(exc).__name__}", file=sys.stderr)
        return 2
    alerts = payload.get("alerts")
    if not isinstance(alerts, dict):
        print("metrics response does not contain alerts", file=sys.stderr)
        return 2
    active = sorted(name for name, value in alerts.items() if value)
    if active:
        print("active alerts: " + ", ".join(active), file=sys.stderr)
        return 1
    print("operational metrics ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
