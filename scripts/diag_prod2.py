#!/usr/bin/env python3
import os
import json
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

def run(cmd, timeout=120):
    print(">", cmd)
    i, o, e = client.exec_command(cmd, timeout=timeout)
    out = o.read().decode()
    err = e.read().decode()
    if out: print(out)
    if err: print("ERR:", err)
    return out

run("docker ps --filter name=pomich")
run("curl -sf http://127.0.0.1:8000/api/health || echo DOWN")
run("grep STORAGE /opt/pomich/.env.production || true")
run("grep DATABASE /opt/pomich/.env.production || true")
run("python3 -c \"import json; print('json providers', len(json.load(open('/opt/pomich/data/providers.json'))))\"")
run(
    "cd /opt/pomich && docker compose -f docker-compose.production.yml --env-file .env.production exec -T pomich-app "
    "python3 -c \"from bot.order_store import load_providers; p=load_providers(); print('sql providers', len(p)); "
    "from collections import Counter; c=Counter(x.get('city') for x in p); print('top cities', c.most_common(10))\""
)
run("curl -sf 'http://127.0.0.1:8000/api/map/providers?scope=all' | python3 -c \"import sys,json; p=json.load(sys.stdin); print('api', len(p))\" || echo API_FAIL")
client.close()
