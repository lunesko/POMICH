"""Query recent orders and provider status on production."""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ssh_common import REMOTE_DIR, run, ssh_connect


def main() -> int:
    ssh = ssh_connect()
    try:
        checks = [
            ("docker_ps", "docker ps -a --format '{{.Names}}|{{.Status}}'"),
            ("processes", "ps aux | grep -E 'uvicorn|gunicorn|pomich' | grep -v grep | head -10"),
            ("port_8000", "ss -tlnp | grep 8000 || netstat -tlnp 2>/dev/null | grep 8000 || echo NO_8000"),
            ("data_dir", f"ls -la {REMOTE_DIR}/data/ 2>/dev/null | head -25"),
            ("env_store", f"grep -E 'POMICH.*STORE|DATABASE|POSTGRES' {REMOTE_DIR}/.env.production 2>/dev/null | head -15"),
        ]
        for name, cmd in checks:
            rc, out, err = run(ssh, cmd)
            print(f"\n=== {name} ===")
            print(out or err or "(empty)")

        order_cmd = (
            f"python3 - <<'PY'\n"
            f"import json\n"
            f"from pathlib import Path\n"
            f"p = Path('{REMOTE_DIR}/data/orders.json')\n"
            f"if not p.exists():\n"
            f"    print('NO_ORDERS_FILE')\n"
            f"else:\n"
            f"    orders = json.loads(p.read_text())\n"
            f"    print('total_orders', len(orders))\n"
            f"    for o in orders[-8:]:\n"
            f"        coords = o.get('customerCoordinates')\n"
            f"        print('---')\n"
            f"        print('id', o.get('id'))\n"
            f"        print('status', o.get('status'))\n"
            f"        print('dispatchState', o.get('dispatchState'))\n"
            f"        print('service', o.get('service'))\n"
            f"        print('location', (o.get('customerLocation') or '')[:60])\n"
            f"        print('coords', coords)\n"
            f"        di = o.get('dispatchInfo') or {{}}\n"
            f"        print('offersSent', di.get('offersSent'), 'eligible', di.get('eligibleProviders'))\n"
            f"PY"
        )
        rc, out, err = run(ssh, order_cmd)
        print("\n=== recent_orders ===")
        print(out or err)

        provider_cmd = (
            f"python3 - <<'PY'\n"
            f"import json\n"
            f"from pathlib import Path\n"
            f"p = Path('{REMOTE_DIR}/data/providers.json')\n"
            f"if not p.exists():\n"
            f"    print('NO_PROVIDERS_FILE')\n"
            f"else:\n"
            f"    providers = json.loads(p.read_text())\n"
            f"    print('total_providers', len(providers))\n"
            f"    online = [x for x in providers if x.get('status') in ('online','busy')]\n"
            f"    print('online_or_busy', len(online))\n"
            f"    for p in providers:\n"
            f"        print('---')\n"
            f"        print('id', p.get('id'))\n"
            f"        print('name', (p.get('name') or '')[:40])\n"
            f"        print('status', p.get('status'), 'stale', p.get('stale'))\n"
            f"        print('verificationStatus', p.get('verificationStatus'))\n"
            f"        print('phone_verified', (p.get('verification') or {{}}).get('phone'))\n"
            f"        print('city', p.get('city'))\n"
            f"        print('location', p.get('location'))\n"
            f"        print('radius', p.get('serviceRadiusKm'))\n"
            f"        print('specialties', p.get('specialties'))\n"
            f"        print('lastSeenAt', p.get('lastSeenAt'))\n"
            f"PY"
        )
        rc, out, err = run(ssh, provider_cmd)
        print("\n=== providers ===")
        print(out or err)

        offers_cmd = (
            f"python3 - <<'PY'\n"
            f"import json\n"
            f"from pathlib import Path\n"
            f"p = Path('{REMOTE_DIR}/data/offers.json')\n"
            f"if not p.exists():\n"
            f"    print('NO_OFFERS_FILE')\n"
            f"else:\n"
            f"    offers = json.loads(p.read_text())\n"
            f"    print('total_offers', len(offers))\n"
            f"    pending = [o for o in offers if o.get('status')=='pending']\n"
            f"    print('pending', len(pending))\n"
            f"    for o in offers[-10:]:\n"
            f"        print(o.get('id'), o.get('orderId'), o.get('providerId'), o.get('status'))\n"
            f"PY"
        )
        rc, out, err = run(ssh, offers_cmd)
        print("\n=== offers ===")
        print(out or err)

        return 0
    finally:
        ssh.close()


if __name__ == "__main__":
    raise SystemExit(main())
