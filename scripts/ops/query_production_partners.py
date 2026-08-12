"""Query dispatch partners on production."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ssh_common import run, ssh_connect


def main() -> int:
    ssh = ssh_connect()
    try:
        queries = {
            "dispatch_partners": r"""docker exec pomich-postgres psql -U pomich -d pomich -c "
SELECT p.id, left(p.name,20) as name, pp.status, pp.last_seen_at, pp.last_location_at,
       p.verification_status, p.payload->>'registeredAt' IS NOT NULL as registered,
       p.capabilities
FROM providers p
LEFT JOIN provider_presence pp ON p.id = pp.provider_id
WHERE p.id LIKE 'provider-%' OR (p.payload->>'providerKind') = 'dispatch'
ORDER BY pp.last_seen_at DESC NULLS LAST;
"
""",
            "pending_offers": r"""docker exec pomich-postgres psql -U pomich -d pomich -c "
SELECT id, order_id, provider_id, status, created_at FROM dispatch_offers ORDER BY created_at DESC LIMIT 10;
"
""",
            "api_providers": "curl -sf http://127.0.0.1:8000/api/providers | python3 -m json.tool | head -80",
        }
        for name, cmd in queries.items():
            rc, out, err = run(ssh, cmd)
            print(f"\n=== {name} ===")
            print(out[:4000] if out else err)
        return 0
    finally:
        ssh.close()


if __name__ == "__main__":
    raise SystemExit(main())
