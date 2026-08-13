#!/usr/bin/env python3
"""Import OSM directory providers for Zakarpattia oblast on production."""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.parse
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[2]
REMOTE_DIR = os.environ.get("POMICH_REMOTE_DIR", "/opt/pomich")
HOST = os.environ.get("POMICH_SSH_HOST", "157.173.101.252")
USER = os.environ.get("POMICH_SSH_USER", "root")

ZAKARPATTIA_CITIES = [
    "uzhhorod",
    "mukachevo",
    "beregove",
    "vynohradiv",
    "svaliava",
    "khust",
    "perechyn",
    "chop",
    "irshava",
    "rakhiv",
    "tyachiv",
    "mizhhiria",
]

API_CHECKS = [
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
    print("ERROR: set POMICH_SSH_PASSWORD")
    sys.exit(1)


def run(ssh: paramiko.SSHClient, cmd: str, *, timeout: int = 600) -> tuple[str, int]:
    print(f"$ {cmd[:140]}")
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    rc = stdout.channel.recv_exit_status()
    if out.strip():
        print(out[-2500:])
    if err.strip() and rc != 0:
        print("STDERR:", err[-800:])
    return out, rc


def ensure_app(ssh: paramiko.SSHClient) -> None:
    run(
        ssh,
        f"cd {REMOTE_DIR} && docker compose -f docker-compose.production.yml --env-file .env.production up -d --wait pomich-app",
        timeout=180,
    )


def api_counts(ssh: paramiko.SSHClient) -> dict[str, int]:
    results: dict[str, int] = {}
    for name, url in API_CHECKS:
        out, rc = run(ssh, f"curl -sf '{url}'", timeout=120)
        if rc != 0 or not out.strip():
            results[name] = 0
            continue
        try:
            results[name] = len(json.loads(out))
        except json.JSONDecodeError:
            results[name] = 0
    return results


def main() -> int:
    password = load_password()
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=password, timeout=20)

    ensure_app(client)

    # Upload updated settlements.json
    sftp = client.open_sftp()
    local_path = ROOT / "data" / "settlements.json"
    remote_path = f"{REMOTE_DIR}/data/settlements.json"
    sftp.put(str(local_path), remote_path)
    sftp.close()
    print(f"Uploaded settlements.json")

    before = api_counts(client)
    print("BEFORE:", json.dumps(before, ensure_ascii=False, indent=2))

    failed: list[str] = []
    per_city: dict[str, object] = {}
    for city in ZAKARPATTIA_CITIES:
        ensure_app(client)
        cmd = (
            f"cd {REMOTE_DIR} && docker compose -f docker-compose.production.yml --env-file .env.production "
            f"exec -T pomich-app python3 scripts/import_ukraine_providers.py --city {city} --merge --delay 2"
        )
        out, rc = run(client, cmd, timeout=300)
        if rc != 0:
            failed.append(city)
            ensure_app(client)
        else:
            try:
                payload = json.loads(out.strip().split("Stored:")[0].strip().split("\n")[-1])
                per_city[city] = payload.get("perSettlement", [{}])[0].get("counts", {})
            except (json.JSONDecodeError, IndexError, KeyError):
                per_city[city] = {"raw": out[-400:]}
        time.sleep(2)

    ensure_app(client)
    after = api_counts(client)
    summary = {
        "before": before,
        "after": after,
        "importCounts": per_city,
        "failedCities": failed,
    }
    print("AFTER:", json.dumps(after, ensure_ascii=False, indent=2))
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    client.close()
    return 0 if not failed and after.get("radius30_uzh", 0) >= 50 else 1


if __name__ == "__main__":
    raise SystemExit(main())
