"""Query provider_presence table on production."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ssh_common import run, ssh_connect


def main() -> int:
    ssh = ssh_connect()
    try:
        cmd = r"""docker exec pomich-postgres psql -U pomich -d pomich -c "
SELECT provider_id, status, last_seen_at, last_location_at, lat, lng
FROM provider_presence
WHERE provider_id LIKE 'provider-%'
ORDER BY provider_id;
"
"""
        rc, out, err = run(ssh, cmd)
        print(out or err)
        return 0
    finally:
        ssh.close()


if __name__ == "__main__":
    raise SystemExit(main())
