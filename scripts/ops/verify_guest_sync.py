"""Verify guest profile inherits Vitaliy verification on production."""
from __future__ import annotations

import json

from ssh_common import run, ssh_connect


def main() -> int:
    ssh = ssh_connect()
    try:
        cmd = r"""docker exec pomich-app python3 -c "
import json
from bot.order_store import get_customer_profile, update_customer_profile

for gid in ['guest-7593e34565354ec485b30193320d81a0', 'guest-1b2cc55bbd8845ada09f9bc682764b9a']:
    p = get_customer_profile(gid)
    print('GUEST', gid, p.get('verificationStatus'), p.get('phone'))

# simulate fresh guest save with Vitaliy phone
fresh = update_customer_profile('guest-verify-test', {'name': 'Vitaliy', 'phone': '+380661007434'})
print('FRESH_GUEST', fresh.get('id'), fresh.get('verificationStatus'))
"
"""
        rc, out, err = run(ssh, cmd, timeout=120)
        print(out)
        if err:
            print("STDERR:", err)
        return rc
    finally:
        ssh.close()


if __name__ == "__main__":
    raise SystemExit(main())
