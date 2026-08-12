"""Query PostgreSQL orders/providers on production."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ssh_common import run, ssh_connect


def main() -> int:
    ssh = ssh_connect()
    try:
        db_cmd = r"""docker exec pomich-postgres psql -U pomich -d pomich -t -A -F'|' -c "
SELECT id, status, customer_lat, customer_lng, service, created_at
FROM orders
ORDER BY created_at DESC
LIMIT 10;
"
"""
        rc, out, err = run(ssh, db_cmd)
        print("=== postgres recent orders ===")
        print(out or err)

        provider_cmd = r"""docker exec pomich-postgres psql -U pomich -d pomich -t -A -F'|' -c "
SELECT p.id, pp.status, pp.last_seen_at, pp.lat, pp.lng, p.verification_status
FROM providers p
JOIN provider_presence pp ON p.id = pp.provider_id
WHERE pp.status IN ('online','busy')
ORDER BY pp.last_seen_at DESC
LIMIT 10;
"
"""
        rc, out, err = run(ssh, provider_cmd)
        print("\n=== postgres online providers ===")
        print(out or err)

        payload_cmd = r"""docker exec pomich-postgres psql -U pomich -d pomich -t -c "
SELECT payload->>'customerCoordinates', payload->>'customerLocation', payload->>'dispatchState'
FROM orders
ORDER BY created_at DESC
LIMIT 5;
"
"""
        rc, out, err = run(ssh, payload_cmd)
        print("\n=== order payload coords ===")
        print(out or err)

        health_cmd = "curl -sf http://127.0.0.1:8000/api/health; echo; docker ps --filter name=pomich-app --format '{{.Status}}'"
        rc, out, err = run(ssh, health_cmd)
        print("\n=== app health ===")
        print(out or err)

        return 0
    finally:
        ssh.close()


if __name__ == "__main__":
    raise SystemExit(main())
