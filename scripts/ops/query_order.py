"""Query a specific production order and related dispatch state."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ssh_common import run, ssh_connect


def main() -> int:
    order_id = sys.argv[1] if len(sys.argv) > 1 else "PM-20260813092707776049"
    ssh = ssh_connect()
    try:
        queries = {
            "order": f"""docker exec pomich-postgres psql -U pomich -d pomich -c "
SELECT id, status, customer_lat, customer_lng, service,
       payload->>'dispatchState' as dispatch_state,
       payload->'dispatchInfo' as dispatch_info
FROM orders WHERE id='{order_id}';
"
""",
            "offers": f"""docker exec pomich-postgres psql -U pomich -d pomich -c "
SELECT id, provider_id, status, created_at, expires_at
FROM dispatch_offers WHERE order_id='{order_id}';
"
""",
            "online_providers": """docker exec pomich-postgres psql -U pomich -d pomich -c "
SELECT p.id, left(p.name,25), pp.status, pp.lat, pp.lng,
       pp.last_seen_at, pp.last_location_at, p.verification_status, p.capabilities
FROM providers p
JOIN provider_presence pp ON p.id=pp.provider_id
WHERE pp.status='online'
ORDER BY pp.last_seen_at DESC LIMIT 10;
"
""",
            "api_order": f"curl -sf http://127.0.0.1:8000/api/orders/{order_id} | python3 -m json.tool 2>/dev/null | head -80",
        }
        for name, cmd in queries.items():
            rc, out, err = run(ssh, cmd)
            print(f"\n=== {name} ===")
            print(out or err)
        return 0
    finally:
        ssh.close()


if __name__ == "__main__":
    raise SystemExit(main())
