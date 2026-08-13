#!/usr/bin/env python3
"""Ensure prod app is up and print Zakarpattia final counts."""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[2]
REMOTE_DIR = os.environ.get("POMICH_REMOTE_DIR", "/opt/pomich")
HOST = os.environ.get("POMICH_SSH_HOST", "157.173.101.252")
USER = os.environ.get("POMICH_SSH_USER", "root")

QUERIES = [
    ("all", "http://127.0.0.1:8000/api/map/providers?scope=all"),
    ("city_uzhhorod", "http://127.0.0.1:8000/api/map/providers?city=%D0%A3%D0%B6%D0%B3%D0%BE%D1%80%D0%BE%D0%B4"),
    ("radius30_uzh", "http://127.0.0.1:8000/api/map/providers?lat=48.62&lng=22.29&radius_km=30"),
    ("mukachevo", "http://127.0.0.1:8000/api/map/providers?city=%D0%9C%D1%83%D0%BA%D0%B0%D1%87%D0%B5%D0%B2%D0%BE"),
    ("khust", "http://127.0.0.1:8000/api/map/providers?city=%D0%A5%D1%83%D1%81%D1%82"),
    ("beregove", "http://127.0.0.1:8000/api/map/providers?city=%D0%91%D0%B5%D1%80%D0%B5%D0%B3%D0%BE%D0%B2%D0%B5"),
    ("vynohradiv", "http://127.0.0.1:8000/api/map/providers?city=%D0%92%D0%B8%D0%BD%D0%BE%D0%B3%D1%80%D0%B0%D0%B4%D1%96%D0%B2"),
    ("svaliava", "http://127.0.0.1:8000/api/map/providers?city=%D0%A1%D0%B2%D0%B0%D0%BB%D1%8F%D0%B2%D0%B0"),
    ("chop", "http://127.0.0.1:8000/api/map/providers?city=%D0%A7%D0%BE%D0%BF"),
    ("irshava", "http://127.0.0.1:8000/api/map/providers?city=%D0%86%D1%80%D1%88%D0%B0%D0%B2%D0%B0"),
    ("rakhiv", "http://127.0.0.1:8000/api/map/providers?city=%D0%A0%D0%B0%D1%85%D1%96%D0%B2"),
    ("tyachiv", "http://127.0.0.1:8000/api/map/providers?city=%D0%A2%D1%8F%D1%87%D1%96%D0%B2"),
    ("perechyn", "http://127.0.0.1:8000/api/map/providers?city=%D0%9F%D0%B5%D1%80%D0%B5%D1%87%D0%B8%D0%BD"),
]


def load_password() -> str:
    password = os.environ.get("POMICH_SSH_PASSWORD", "").strip()
    if password:
        return password
    deploy_env = ROOT / ".env.deploy"
    if deploy_env.exists():
        for line in deploy_env.read_text(encoding="utf-8").splitlines():
            if line.startswith("POMICH_SSH_PASSWORD="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit(1)


def run(ssh: paramiko.SSHClient, cmd: str, *, timeout: int = 180) -> tuple[str, int]:
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode(errors="replace")
    rc = stdout.channel.recv_exit_status()
    return out, rc


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=load_password(), timeout=20)

    run(
        client,
        f"cd {REMOTE_DIR} && docker compose -f docker-compose.production.yml --env-file .env.production up -d --wait pomich-app",
        timeout=180,
    )
    time.sleep(5)

    health, _ = run(client, "curl -sf http://127.0.0.1:8000/api/health", timeout=30)
    print("health:", health.strip())

    results: dict[str, object] = {}
    for name, url in QUERIES:
        out, rc = run(
            client,
            f"curl -sf '{url}' | python3 -c \"import sys,json; d=json.load(sys.stdin); print(len(d))\"",
            timeout=180,
        )
        if rc == 0:
            try:
                count = int((out.strip().splitlines() or ["0"])[-1])
            except ValueError:
                count = -1
            results[name] = count
            if name in ("city_uzhhorod", "radius30_uzh"):
                out2, rc2 = run(
                    client,
                    f"curl -sf '{url}' | python3 -c \"import sys,json,collections; d=json.load(sys.stdin); c=collections.Counter(); "
                    "[c.update(p.get('specialties') or []) for p in d]; print(dict(c))\"",
                    timeout=180,
                )
                if rc2 == 0:
                    results[f"{name}_specs"] = out2.strip().splitlines()[-1]
        else:
            results[name] = "error"

    # Retry rakhiv/tyachiv import if missing
    for city in ("rakhiv", "tyachiv"):
        if results.get(city) in (0, "error"):
            run(
                client,
                f"cd {REMOTE_DIR} && docker compose -f docker-compose.production.yml --env-file .env.production "
                f"exec -T pomich-app python3 scripts/import_ukraine_providers.py --city {city} --merge --delay 3",
                timeout=300,
            )
            time.sleep(2)
            url = next(u for n, u in QUERIES if n == city)
            out, rc = run(
                client,
                f"curl -sf '{url}' | python3 -c \"import sys,json; print(len(json.load(sys.stdin)))\"",
                timeout=120,
            )
            if rc == 0:
                results[city] = int((out.strip().splitlines() or ["0"])[-1])

    print(json.dumps(results, ensure_ascii=False, indent=2))
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
