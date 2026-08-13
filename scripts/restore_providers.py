#!/usr/bin/env python3
import os
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

def run(cmd, timeout=300):
    print(">", cmd)
    i, o, e = client.exec_command(cmd, timeout=timeout)
    out = o.read().decode()
    err = e.read().decode()
    if out: print(out[-10000:])
    if err: print("ERR:", err[-3000:])

run("ls -la /opt/pomich/data/providers.json")
run("python3 -c \"import json; p=json.load(open('/opt/pomich/data/providers.json')); print(len(p)); from collections import Counter; print(Counter(x.get('source') for x in p)); print(Counter(x.get('city') for x in p).most_common(8))\"")
run(
    "cd /opt/pomich && docker compose -f docker-compose.production.yml --env-file .env.production exec -T pomich-app "
    "python3 -c \"import json; from bot.order_store import merge_directory_providers; "
    "p=json.load(open('/app/data/providers.json')); r=merge_directory_providers(p); print(r)\""
)
run("cd /opt/pomich && docker compose -f docker-compose.production.yml --env-file .env.production exec -T pomich-app python3 -c \"from bot.order_store import load_providers; print(len(load_providers()))\"")
run("curl -sf 'http://127.0.0.1:8000/api/map/providers?scope=all' | python3 -c \"import sys,json; print(len(json.load(sys.stdin)))\"")
client.close()
