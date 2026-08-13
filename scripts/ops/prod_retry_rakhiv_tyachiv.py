#!/usr/bin/env python3
import json, os, sys, time
from pathlib import Path
import paramiko
ROOT = Path(__file__).resolve().parents[2]
pw = os.environ.get("POMICH_SSH_PASSWORD","")
if not pw:
    for line in (ROOT/".env.deploy").read_text().splitlines():
        if line.startswith("POMICH_SSH_PASSWORD="):
            pw = line.split("=",1)[1].strip()
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect("157.173.101.252", username="root", password=pw, timeout=20)
for city in ["rakhiv", "tyachiv"]:
    cmd = (
        "cd /opt/pomich && docker compose -f docker-compose.production.yml --env-file .env.production "
        f"exec -T pomich-app python3 scripts/import_ukraine_providers.py --city {city} --merge --delay 5"
    )
    _, stdout, stderr = c.exec_command(cmd, timeout=300)
    out = stdout.read().decode("utf-8", "replace")
    rc = stdout.channel.recv_exit_status()
    print(city, "rc", rc, out[-600:].encode("ascii", "replace").decode())
    time.sleep(5)
urls = {
    "rakhiv": "http://127.0.0.1:8000/api/map/providers?city=%D0%A0%D0%B0%D1%85%D1%96%D0%B2",
    "tyachiv": "http://127.0.0.1:8000/api/map/providers?city=%D0%A2%D1%8F%D1%87%D1%96%D0%B2",
}
for city, url in urls.items():
    _, stdout, _ = c.exec_command(
        f"curl -sf '{url}' | python3 -c \"import sys,json; print(len(json.load(sys.stdin)))\"",
        timeout=60,
    )
    print(city, "count", stdout.read().decode().strip())
c.close()
