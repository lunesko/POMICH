"""Retry dispatch for searching orders on production."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ssh_common import run, ssh_connect


def main() -> int:
    ssh = ssh_connect()
    try:
        cmd = r"""python3 - <<'PY'
import json
import urllib.request

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

offers_cmd = """docker exec pomich-postgres psql -U pomich -d pomich -t -c "SELECT id, provider_id, status FROM dispatch_offers WHERE order_id='PM-20260812135437977284';" """
import subprocess
print(subprocess.check_output(offers_cmd, shell=True, text=True))
PY"""
        rc, out, err = run(ssh, cmd)
        print(out or err)
        return 0
    finally:
        ssh.close()


if __name__ == "__main__":
    raise SystemExit(main())
