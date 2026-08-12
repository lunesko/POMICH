"""Check Vitaliy verification status on production."""
from __future__ import annotations

import json

from ssh_common import run, ssh_connect


def main() -> int:
    ssh = ssh_connect()
    try:
        cmd = r"""docker exec pomich-app python3 -c "
import json
from bot.runtime_store import load_collection
from bot.order_store import get_customer_profile, _customer_profile_phone_digits

for cid in ['tg-829741830']:
    p = get_customer_profile(cid)
    print('PROFILE', cid)
    print(json.dumps({
        'id': p.get('id'),
        'name': p.get('name'),
        'phone': p.get('phone'),
        'verificationStatus': p.get('verificationStatus'),
        'verification': p.get('verification'),
    }, ensure_ascii=False, indent=2))

found, profiles = load_collection('customers')
target = _customer_profile_phone_digits(get_customer_profile('tg-829741830'))
print('TARGET_PHONE_DIGITS', target)
for p in profiles or []:
    if _customer_profile_phone_digits(p) == target:
        print('SAME_PHONE', p.get('id'), p.get('verificationStatus'), p.get('name'))
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
