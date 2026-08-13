#!/usr/bin/env python3
"""Restart pomich-app if needed, run directory import, verify API counts."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[2]
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
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
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
        f"cd {REMOTE_DIR} && docker compose -f docker-compose.production.yml --env-file .env.production up -d --wait pomich-app",
        timeout=180,
    )

    before_out, _, _ = run(
        client,
        "curl -sf 'http://127.0.0.1:8000/api/map/providers?scope=all' | python3 -c \"import sys,json; print(len(json.load(sys.stdin)))\"",
        timeout=60,
    )
    before = int((before_out.strip().splitlines() or ["0"])[-1] or "0")
    print(f"API providers before import: {before}")

    import_cmd = (
        f"cd {REMOTE_DIR} && docker compose -f docker-compose.production.yml --env-file .env.production "
        f"exec -T pomich-app python3 scripts/import_ukraine_providers.py --all --merge --delay 1.5"
    )
    _, _, import_rc = run(client, import_cmd, timeout=7200)

    after_out, _, _ = run(
        client,
        "curl -sf 'http://127.0.0.1:8000/api/map/providers?scope=all' | python3 -c \"import sys,json; print(len(json.load(sys.stdin)))\"",
        timeout=60,
    )
    after = int((after_out.strip().splitlines() or ["0"])[-1] or "0")

    health_out, _, _ = run(client, "curl -sf http://127.0.0.1:8000/api/health", timeout=30)

    summary = {
        "before": before,
        "after": after,
        "importExitCode": import_rc,
        "health": health_out.strip(),
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    client.close()
    return 0 if import_rc == 0 and after > before else (0 if after > 0 else 1)


if __name__ == "__main__":
    raise SystemExit(main())
