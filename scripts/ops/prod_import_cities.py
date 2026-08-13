#!/usr/bin/env python3
"""Import specific cities on prod one at a time (avoids OOM)."""

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

# Cities that failed OOM during bulk import
CITIES = sys.argv[1:] if len(sys.argv) > 1 else [
    "kyiv", "odesa", "kharkiv", "khmelnytskyi", "chernihiv",
]

CITY_NAMES = {
    "kyiv": "Київ",
    "odesa": "Одеса",
    "kharkiv": "Харків",
    "khmelnytskyi": "Хмельницький",
    "chernihiv": "Чернігів",
}


def load_password() -> str:
    password = os.environ.get("POMICH_SSH_PASSWORD", "").strip()
    if password:
        return password
    deploy_env = ROOT / ".env.deploy"
    if deploy_env.exists():
        for line in deploy_env.read_text(encoding="utf-8").splitlines():
            if line.startswith("POMICH_SSH_PASSWORD="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    print("ERROR: set POMICH_SSH_PASSWORD")
    sys.exit(1)


def run(ssh: paramiko.SSHClient, cmd: str, *, timeout: int = 900) -> tuple[str, int]:
    print(f"$ {cmd[:140]}")
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    rc = stdout.channel.recv_exit_status()
    if out.strip():
        print(out[-2000:])
    if err.strip() and rc != 0:
        print("STDERR:", err[-1000:])
    return out, rc


def ensure_app(ssh: paramiko.SSHClient) -> None:
    run(
        ssh,
        f"cd {REMOTE_DIR} && docker compose -f docker-compose.production.yml --env-file .env.production up -d --wait pomich-app",
        timeout=180,
    )


def api_count(ssh: paramiko.SSHClient, *, city: str | None = None) -> int:
    if city:
        q = f"city={city}"
    else:
        q = "scope=all"
    out, rc = run(
        ssh,
        f"curl -sf 'http://127.0.0.1:8000/api/map/providers?{q}' | python3 -c \"import sys,json; print(len(json.load(sys.stdin)))\"",
        timeout=60,
    )
    if rc != 0:
        return 0
    try:
        return int((out.strip().splitlines() or ["0"])[-1])
    except ValueError:
        return 0


def main() -> int:
    password = load_password()
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=password, timeout=20)

    ensure_app(client)
    before = api_count(client)
    print(f"Providers before: {before}")

    results: list[dict] = []
    failed: list[str] = []

    for city in CITIES:
        print(f"\n=== Importing {city} ===")
        ensure_app(client)
        city_before = api_count(client, city=CITY_NAMES.get(city, city))
        cmd = (
            f"cd {REMOTE_DIR} && docker compose -f docker-compose.production.yml --env-file .env.production "
            f"exec -T pomich-app python3 scripts/import_ukraine_providers.py --city {city} --merge --delay 0.5"
        )
        out, rc = run(client, cmd, timeout=900)
        if rc != 0:
            failed.append(city)
            print(f"[WARN] import failed for {city} (exit {rc}), restarting app...")
            ensure_app(client)
        ensure_app(client)
        city_after = api_count(client, city=CITY_NAMES.get(city, city))
        total = api_count(client)
        results.append({
            "city": city,
            "exitCode": rc,
            "cityBefore": city_before,
            "cityAfter": city_after,
            "totalAfter": total,
        })
        print(f"  city providers: {city_before} -> {city_after}, total: {total}")
        time.sleep(2)

    ensure_app(client)
    after = api_count(client)
    health_out, _ = run(client, "curl -sf http://127.0.0.1:8000/api/health", timeout=30)
    summary = {
        "before": before,
        "after": after,
        "failedCities": failed,
        "perCity": results,
        "health": health_out.strip(),
    }
    print("\n" + json.dumps(summary, ensure_ascii=False, indent=2))
    client.close()
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
