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
cmds = [
    "wc -l /opt/pomich/data/settlements.json; head -8 /opt/pomich/data/settlements.json",
    "cd /opt/pomich && docker compose -f docker-compose.production.yml --env-file .env.production exec -T pomich-app python3 -c 'from bot.settlements import load_settlements; print(len(load_settlements()))'",
    "cd /opt/pomich && docker compose -f docker-compose.production.yml --env-file .env.production exec -T pomich-app ls -la /app/data/",
    "grep POMICH_PROVIDER /opt/pomich/.env.production || true",
    "cd /opt/pomich && docker compose -f docker-compose.production.yml --env-file .env.production exec -T pomich-app python3 scripts/import_ukraine_providers.py --city kyiv --dry-run",
]
for cmd in cmds:
    print(">", cmd)
    stdin, stdout, stderr = client.exec_command(cmd, timeout=180)
    print(stdout.read().decode())
    err = stderr.read().decode()
    if err:
        print("ERR:", err)
client.close()
