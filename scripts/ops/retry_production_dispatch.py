"""Retry dispatch for production order."""

from __future__ import annotations

import json
import subprocess
import urllib.request


def main() -> int:
    order_id = "PM-20260812135437977284"
    req = urllib.request.Request(
        f"http://127.0.0.1:8000/api/orders/{order_id}/dispatch/retry",
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req) as resp:
        order = json.loads(resp.read())
    print("dispatchState", order.get("dispatchState"))
    print("offersSent", (order.get("dispatchInfo") or {}).get("offersSent"))
    print("eligible", (order.get("dispatchInfo") or {}).get("eligibleProviders"))

    offers_cmd = "docker exec pomich-postgres psql -U pomich -d pomich -t -c \"SELECT id, provider_id, status FROM dispatch_offers WHERE order_id='PM-20260812135437977284';\""
    print(subprocess.check_output(offers_cmd, shell=True, text=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
