"""Query production customer profiles for debugging."""
from __future__ import annotations

import json

from ssh_common import run, ssh_connect


def main() -> int:
    ssh = ssh_connect()
    try:
        cmd = r"""docker exec pomich-app python3 -c "
import json
from bot.runtime_store import load_collection

found, profiles = load_collection('customers')
print('found', found, 'count', len(profiles) if profiles else 0)
if not profiles:
    raise SystemExit(0)
needles = ['roman', 'витал', 'vital', '935718207', '661007434']
for p in profiles:
    blob = json.dumps(p, ensure_ascii=False).lower()
    if any(n in blob for n in needles):
        print('MATCH', json.dumps({
            'id': p.get('id'),
            'name': p.get('name'),
            'phone': p.get('phone'),
            'telegram': p.get('telegram'),
            'customerIdentity': p.get('customerIdentity'),
        }, ensure_ascii=False))
tg = [p for p in profiles if str(p.get('id', '')).startswith('tg-')]
print('TG profiles:', len(tg))
for p in sorted(tg, key=lambda x: str(x.get('updatedAt') or ''), reverse=True)[:10]:
    print('TG', p.get('id'), '|', p.get('name'), '|', p.get('phone'))
guest = [p for p in profiles if str(p.get('id', '')).startswith('guest-')]
print('Guest profiles:', len(guest))
for p in guest[:10]:
    print('GUEST', p.get('id'), '|', p.get('name'), '|', p.get('phone'))
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
