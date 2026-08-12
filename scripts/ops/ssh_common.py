"""Shared SSH helpers for POMICH production ops."""
from __future__ import annotations

import os
import sys

import paramiko

HOST = os.environ.get("POMICH_SSH_HOST", "157.173.101.252")
USER = os.environ.get("POMICH_SSH_USER", "root")
REMOTE_DIR = os.environ.get("POMICH_REMOTE_DIR", "/opt/pomich")
BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")


def require_password() -> str:
    password = os.environ.get("POMICH_SSH_PASSWORD", "")
    if not password:
        print("ERROR: set POMICH_SSH_PASSWORD environment variable", file=sys.stderr)
        sys.exit(1)
    return password


def ssh_connect(*, timeout: int = 20) -> paramiko.SSHClient:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=require_password(), timeout=timeout)
    return client


def run(ssh: paramiko.SSHClient, cmd: str, *, timeout: int = 120) -> tuple[int, str, str]:
    _, stdout, stderr = ssh.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    rc = stdout.channel.recv_exit_status()
    return rc, out, err


def latest_tunnel_url(ssh: paramiko.SSHClient) -> str:
    for cmd in (
        "grep -oE 'https://[a-zA-Z0-9-]+\\.trycloudflare\\.com' /var/log/pomich-tunnel.log 2>/dev/null | tail -1",
        "journalctl -u pomich-tunnel --no-pager -n 40 2>/dev/null | grep -oE 'https://[a-zA-Z0-9-]+\\.trycloudflare\\.com' | tail -1",
    ):
        _, out, _ = run(ssh, cmd)
        if out:
            return out.strip().rstrip("/")
    return ""
