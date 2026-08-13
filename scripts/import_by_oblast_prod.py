#!/usr/bin/env python3
"""Import providers oblast-by-oblast on production to avoid OOM/timeouts."""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
REMOTE_DIR = "/opt/pomich"

OBLASTS = [
    "Закарпатська",
    "Волинська",
    "Львівська",
    "Тернопільська",
    "Івано-Франківська",
    "Чернівецька",
    "Рівненська",
    "Житомирська",
    "Вінницька",
    "Хмельницька",
    "Черкаська",
    "Кіровоградська",
    "Полтавська",
    "Сумська",
    "Чернігівська",
    "Київська",
    "Харківська",
    "Дніпропетровська",
    "Запорізька",
    "Миколаївська",
    "Херсонська",
    "Одеська",
]


def password() -> str:
    value = os.environ.get("POMICH_SSH_PASSWORD", "").strip()
    if value:
        return value
    for line in (ROOT / ".env.deploy").read_text(encoding="utf-8").splitlines():
        if line.startswith("POMICH_SSH_PASSWORD="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("POMICH_SSH_PASSWORD missing")


def run(client: paramiko.SSHClient, cmd: str, *, timeout: int = 1800) -> tuple[int, str]:
    print(f"$ {cmd}")
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    rc = stdout.channel.recv_exit_status()
    if out.strip():
        print(out[-3000:])
    if err.strip() and rc != 0:
        print("ERR:", err[-1500:])
    return rc, out


def count_providers(client: paramiko.SSHClient) -> int:
    _, out = run(
        client,
        f"cd {REMOTE_DIR} && docker compose -f docker-compose.production.yml --env-file .env.production exec -T pomich-app "
        "python3 -c \"from bot.order_store import load_providers; print(len(load_providers()))\"",
        timeout=60,
    )
    return int(out.strip().splitlines()[-1])


def main() -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect("157.173.101.252", username="root", password=password(), timeout=20)

    started = time.time()
    before = count_providers(client)
    print(f"Before: {before}")

    per_oblast: list[dict] = []
    for oblast in OBLASTS:
        t0 = time.time()
        rc, out = run(
            client,
            f"cd {REMOTE_DIR} && docker compose -f docker-compose.production.yml --env-file .env.production exec -T pomich-app "
            f"python3 scripts/import_ukraine_providers.py --oblast '{oblast}' --merge --delay 1.5",
            timeout=1800,
        )
        after = count_providers(client)
        parsed = 0
        try:
            marker = out.find('"counts"')
            if marker >= 0:
                snippet = out[marker - 20 : marker + 120]
                if '"total"' in snippet:
                    parsed = int(snippet.split('"total":')[1].split(",")[0].strip())
        except (IndexError, ValueError):
            parsed = 0
        entry = {
            "oblast": oblast,
            "exitCode": rc,
            "parsed": parsed,
            "providersInDb": after,
            "seconds": round(time.time() - t0, 1),
        }
        per_oblast.append(entry)
        print(json.dumps(entry, ensure_ascii=False))

    api_rc, api_out = run(
        client,
        "curl -sf 'http://127.0.0.1:8000/api/map/providers?scope=all' | python3 -c \"import sys,json; print(len(json.load(sys.stdin)))\"",
        timeout=60,
    )
    api_count = int(api_out.strip().splitlines()[-1]) if api_rc == 0 else -1

    summary = {
        "before": before,
        "afterSql": count_providers(client),
        "apiCount": api_count,
        "elapsedSeconds": round(time.time() - started, 1),
        "perOblast": per_oblast,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
