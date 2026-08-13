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

def run(cmd, timeout=120):
    print(">", cmd)
    i, o, e = client.exec_command(cmd, timeout=timeout)
    out = o.read().decode()
    err = e.read().decode()
    if out: print(out[-12000:])
    if err: print("ERR:", err[-3000:])

run("docker ps -a --filter name=pomich")
run("docker logs --tail 40 pomich-app 2>&1 || docker logs --tail 40 $(docker ps -aq --filter name=pomich-app | head -1) 2>&1")
run("wc -c /opt/pomich/import.log; tail -30 /opt/pomich/import.log")
run("head -5 /opt/pomich/import.log")
run("cd /opt/pomich && docker compose -f docker-compose.production.yml --env-file .env.production up -d pomich-app")
run("sleep 8 && curl -sf http://127.0.0.1:8000/api/health || echo DOWN")
run("cd /opt/pomich && docker compose -f docker-compose.production.yml --env-file .env.production exec -T pomich-app python3 -c \"from bot.order_store import load_providers; print(len(load_providers()))\"")
run("curl -sf 'http://127.0.0.1:8000/api/map/providers?scope=all' | python3 -c \"import sys,json; print(len(json.load(sys.stdin)))\"")
client.close()
