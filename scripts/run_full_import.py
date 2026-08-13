#!/usr/bin/env python3
import os
import json
import time
import paramiko
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
password = os.environ.get("POMICH_SSH_PASSWORD", "")
if not password:
    for line in (ROOT / ".env.deploy").read_text(encoding="utf-8").splitlines():
        if line.startswith("POMICH_SSH_PASSWORD="):
            password = line.split("=", 1)[1].strip().strip('"').strip("'")

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect("157.173.101.252", username="root", password=password, timeout=20)

def run(cmd, timeout=7200):
    print(">", cmd)
    started = time.time()
    i, o, e = client.exec_command(cmd, timeout=timeout)
    out = o.read().decode()
    err = e.read().decode()
    rc = o.channel.recv_exit_status()
    print(f"  exit={rc} elapsed={time.time()-started:.1f}s")
    if out:
        print(out[-8000:])
    if err:
        print("ERR:", err[-2000:])
    return rc, out, err

run("cd /opt/pomich && docker compose -f docker-compose.production.yml --env-file .env.production exec -T pomich-app python3 -c \"from bot.order_store import load_providers; print('before sql', len(load_providers()))\"")
rc, out, err = run(
    "cd /opt/pomich && docker compose -f docker-compose.production.yml --env-file .env.production exec -T pomich-app "
    "python3 scripts/import_ukraine_providers.py --all --merge --delay 2.0 > /opt/pomich/import.log 2>&1; echo DONE; tail -80 /opt/pomich/import.log",
    timeout=7200,
)
run("grep -E 'Stored:|total=' /opt/pomich/import.log | tail -5")
run("cd /opt/pomich && docker compose -f docker-compose.production.yml --env-file .env.production exec -T pomich-app python3 -c \"from bot.order_store import load_providers; from collections import Counter; p=load_providers(); print('after sql', len(p)); print(Counter(x.get('source') for x in p)); print(Counter(x.get('city') for x in p).most_common(15))\"")
run("curl -sf 'http://127.0.0.1:8000/api/map/providers?scope=all' | python3 -c \"import sys,json; p=json.load(sys.stdin); print('api', len(p))\"")
client.close()
