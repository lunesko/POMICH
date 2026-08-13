#!/usr/bin/env python3
"""Run Ukraine provider import on production server via SSH."""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
REMOTE_DIR = os.environ.get("POMICH_REMOTE_DIR", "/opt/pomich")
HOST = os.environ.get("POMICH_SSH_HOST", "157.173.101.252")
USER = os.environ.get("POMICH_SSH_USER", "root")


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


def run(ssh: paramiko.SSHClient, cmd: str, *, timeout: int = 7200) -> tuple[str, str, int]:
    print(f"$ {cmd}")
    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode(errors="replace")
    err = stderr.read().decode(errors="replace")
    rc = stdout.channel.recv_exit_status()
    if out.strip():
        print(out[-6000:])
    if err.strip():
        print("STDERR:", err[-2000:])
    return out, err, rc


def main() -> int:
    password = load_password()
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=password, timeout=20)

    run(
        client,
        f"test -f {REMOTE_DIR}/data/settlements.json && wc -l {REMOTE_DIR}/data/settlements.json && "
        f"python3 -c \"import sys; sys.path.insert(0,'{REMOTE_DIR}'); from bot.settlements import load_settlements; print('host settlements', len(load_settlements()))\"",
        timeout=60,
    )
    run(
        client,
        f"cd {REMOTE_DIR} && docker compose -f docker-compose.production.yml --env-file .env.production exec -T pomich-app "
        f"python3 -c \"from bot.settlements import load_settlements; print('container settlements', len(load_settlements()))\"",
        timeout=60,
    )
    run(
        client,
        f"cd {REMOTE_DIR} && docker compose -f docker-compose.production.yml --env-file .env.production exec -T pomich-app "
        f"ls -la /app/data/settlements.json /app/data/providers.json 2>&1",
        timeout=60,
    )

    before_out, _, _ = run(
        client,
        f"python3 -c \"import json; p=json.load(open('{REMOTE_DIR}/data/providers.json')); print(len(p))\" 2>/dev/null || echo 0",
        timeout=60,
    )
    before_count = int(before_out.strip().splitlines()[-1] or "0")
    print(f"Providers before: {before_count}")

    started = time.time()
    import_cmd = (
        f"cd {REMOTE_DIR} && docker compose -f docker-compose.production.yml --env-file .env.production exec -T pomich-app "
        f"python3 scripts/import_ukraine_providers.py --all --merge --delay 1.5"
    )
    _, _, rc = run(client, import_cmd, timeout=7200)
    elapsed = time.time() - started

    after_out, _, _ = run(
        client,
        f"python3 -c \"import json; p=json.load(open('{REMOTE_DIR}/data/providers.json')); print(len(p))\"",
        timeout=60,
    )
    after_count = int(after_out.strip().splitlines()[-1] or "0")

    api_out, _, _ = run(
        client,
        "curl -sf http://127.0.0.1:8000/api/map/providers?scope=all | python3 -c \"import sys,json; print(len(json.load(sys.stdin)))\"",
        timeout=60,
    )
    api_count = int(api_out.strip().splitlines()[-1] or "0")

    summary = {
        "before": before_count,
        "after": after_count,
        "apiCount": api_count,
        "importExitCode": rc,
        "elapsedSeconds": round(elapsed, 1),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    client.close()
    return 0 if rc == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
