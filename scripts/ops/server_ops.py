"""Server operations for POMICH: status, deploy, tunnel setup."""
from __future__ import annotations

import os
import sys
import time
import hashlib
import json
import secrets
from pathlib import Path

import paramiko

from ssh_common import BOT_TOKEN, HOST, REMOTE_DIR, USER, latest_tunnel_url, require_password, run as ssh_run, ssh_connect

PROJECT_ROOT = Path(__file__).resolve().parents[2]
WEB_APP_URL = os.environ.get("POMICH_WEB_APP_URL", "http://157.173.101.252:8000/")

SKIP_DIRS = {
    "node_modules", ".git", "dist", "__pycache__", ".venv",
    ".mypy_cache", ".pytest_cache", ".vscode", "openroadaid",
}
SKIP_FILES = {".env.deploy", "deploy.py"}


def run(ssh: paramiko.SSHClient, cmd: str, *, check: bool = False, timeout: int = 600) -> tuple[str, str, int]:
    print(f"$ {cmd}")
    rc, out, err = ssh_run(ssh, cmd, timeout=timeout)
    if out:
        print(out)
    if err:
        print(f"STDERR: {err}")
    if check and rc != 0:
        raise RuntimeError(f"Command failed ({rc}): {cmd}")
    return out, err, rc


def upload_project(ssh: paramiko.SSHClient) -> None:
    sftp = ssh.open_sftp()
    local_root = PROJECT_ROOT

    def ensure_remote_dir(remote_path: str) -> None:
        parts = remote_path.strip("/").split("/")
        current = ""
        for part in parts:
            current = f"{current}/{part}" if current else f"/{part}"
            try:
                sftp.stat(current)
            except FileNotFoundError:
                sftp.mkdir(current)

    ensure_remote_dir(REMOTE_DIR)

    for root, dirs, files in os.walk(local_root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        rel = os.path.relpath(root, local_root).replace("\\", "/")
        remote_base = REMOTE_DIR if rel == "." else f"{REMOTE_DIR}/{rel}"
        ensure_remote_dir(remote_base)
        for filename in files:
            if filename in SKIP_FILES:
                continue
            if filename.endswith(".pyc"):
                continue
            local_path = os.path.join(root, filename)
            remote_path = f"{remote_base}/{filename}"
            sftp.put(local_path, remote_path)

    sftp.close()
    print(f"Uploaded project to {REMOTE_DIR}")


def read_existing_encryption_key(ssh: paramiko.SSHClient) -> str | None:
    out, _, rc = run(ssh, f"grep '^POMICH_ENCRYPTION_KEY=' {REMOTE_DIR}/.env.production 2>/dev/null | cut -d= -f2-", check=False)
    return out.strip() if rc == 0 and out.strip() else None


def read_existing_env_value(ssh: paramiko.SSHClient, key: str) -> str | None:
    out, _, rc = run(ssh, f"grep '^{key}=' {REMOTE_DIR}/.env.production 2>/dev/null | cut -d= -f2-", check=False)
    return out.strip() if rc == 0 and out.strip() else None


def env_or_existing_or_generated(ssh: paramiko.SSHClient, key: str, *, token_bytes: int = 32) -> str:
    return (
        os.environ.get(key, "").strip()
        or (read_existing_env_value(ssh, key) or "").strip()
        or secrets.token_urlsafe(token_bytes)
    )


def env_or_existing(ssh: paramiko.SSHClient, key: str) -> str:
    return os.environ.get(key, "").strip() or (read_existing_env_value(ssh, key) or "").strip()


def password_hash(password: str) -> str:
    return "sha256:" + hashlib.sha256(password.encode("utf-8")).hexdigest()


def account_seed_json(
    ssh: paramiko.SSHClient,
    env_name: str,
    *,
    role: str,
    username: str,
    provider_id: str | None = None,
) -> str:
    existing = env_or_existing(ssh, env_name)
    if existing:
        return existing
    password = secrets.token_urlsafe(18)
    account = {"username": username, "passwordHash": password_hash(password)}
    if provider_id:
        account["providerId"] = provider_id
    print(f"Generated initial {role} password for {username}: {password}")
    return json.dumps([account], separators=(",", ":"))


def write_env_production(
    ssh: paramiko.SSHClient,
    *,
    web_app_url: str | None = None,
    telegram_mode: str = "polling",
    encryption_key: str | None = None,
) -> str:
    app_url = web_app_url or WEB_APP_URL
    cors_origin = app_url.rstrip("/")
    if not encryption_key:
        encryption_key = read_existing_encryption_key(ssh)
    if not encryption_key:
        try:
            from cryptography.fernet import Fernet

            encryption_key = Fernet.generate_key().decode("ascii")
        except Exception:
            encryption_key = "replace-with-generated-fernet-key"
    admin_token = env_or_existing_or_generated(ssh, "POMICH_ADMIN_TOKEN")
    provider_token = env_or_existing_or_generated(ssh, "POMICH_PROVIDER_TOKEN")
    customer_secret = env_or_existing_or_generated(ssh, "POMICH_CUSTOMER_SESSION_SECRET")
    postgres_password = env_or_existing_or_generated(ssh, "POSTGRES_PASSWORD", token_bytes=24)
    admin_accounts = account_seed_json(ssh, "POMICH_ADMIN_ACCOUNTS", role="admin", username="dispatcher")
    provider_accounts = account_seed_json(
        ssh,
        "POMICH_PROVIDER_ACCOUNTS",
        role="provider",
        username="oleksandr",
        provider_id="provider-oleksandr",
    )
    telegram_bot_token = env_or_existing(ssh, "TELEGRAM_BOT_TOKEN") or BOT_TOKEN
    customer_bot_token = env_or_existing(ssh, "TELEGRAM_CUSTOMER_BOT_TOKEN")
    provider_bot_token = env_or_existing(ssh, "TELEGRAM_PROVIDER_BOT_TOKEN")
    webhook_secret = env_or_existing_or_generated(ssh, "TELEGRAM_WEBHOOK_SECRET")
    if not (telegram_bot_token or (customer_bot_token and provider_bot_token)):
        print("WARNING: Telegram tokens are not configured; bot/webhook setup must be completed separately")
    env_content = f"""VITE_APP_NAME=POMICH
VITE_APP_ENV=production
VITE_APP_VERSION=0.1.0
POMICH_RUNTIME=production
POMICH_ALLOW_HTTP_PILOT=true
POMICH_CORS_ORIGINS={cors_origin}
POMICH_ADMIN_TOKEN={admin_token}
POMICH_PROVIDER_TOKEN={provider_token}
POMICH_CUSTOMER_SESSION_SECRET={customer_secret}
POMICH_ADMIN_ACCOUNTS={admin_accounts}
POMICH_PROVIDER_ACCOUNTS={provider_accounts}
POMICH_AUTH_RATE_LIMIT_WINDOW_SECONDS=600
POMICH_AUTH_LOGIN_RATE_LIMIT=12
POMICH_AUTH_RESET_RATE_LIMIT=5
TELEGRAM_BOT_TOKEN={telegram_bot_token}
TELEGRAM_CUSTOMER_BOT_USERNAME=pomich_ua_bot
TELEGRAM_CUSTOMER_BOT_TOKEN={customer_bot_token}
TELEGRAM_CUSTOMER_WEB_APP_URL={app_url.rstrip("/")}/?role=customer&tgBot=customer
TELEGRAM_PROVIDER_BOT_USERNAME=pomich_help_bot
TELEGRAM_PROVIDER_BOT_TOKEN={provider_bot_token}
TELEGRAM_PROVIDER_WEB_APP_URL={app_url.rstrip("/")}/?role=provider&tgBot=provider
TELEGRAM_MODE={telegram_mode}
TELEGRAM_WEBHOOK_SECRET={webhook_secret}
WEB_APP_URL={app_url if app_url.endswith('/') else app_url + '/'}
POMICH_ENCRYPTION_KEY={encryption_key}
POMICH_STORAGE_BACKEND=sql
POSTGRES_DB=pomich
POSTGRES_USER=pomich
POSTGRES_PASSWORD={postgres_password}
DATABASE_URL=postgresql://pomich:{postgres_password}@postgres:5432/pomich
"""
    run(ssh, f"cat > {REMOTE_DIR}/.env.production << 'ENVEOF'\n{env_content}\nENVEOF")
    print("Wrote .env.production")
    return encryption_key


def setup_cloudflare_tunnel(ssh: paramiko.SSHClient) -> str:
    run(ssh, "command -v cloudflared >/dev/null 2>&1 || (curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared)")
    service = """[Unit]
Description=Cloudflare Tunnel for POMICH
After=network.target docker.service

[Service]
Type=simple
ExecStart=/usr/local/bin/cloudflared tunnel --url http://127.0.0.1:8000 --logfile /var/log/pomich-tunnel.log --loglevel info
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
"""
    run(ssh, f"cat > /etc/systemd/system/pomich-tunnel.service << 'EOF'\n{service}\nEOF")
    run(ssh, "systemctl daemon-reload")
    run(ssh, "systemctl enable pomich-tunnel")
    run(ssh, "systemctl restart pomich-tunnel")
    print("Waiting 15s for tunnel URL...")
    time.sleep(15)
    tunnel_url = latest_tunnel_url(ssh)
    if not tunnel_url:
        raise RuntimeError("Could not detect Cloudflare tunnel URL from logs")
    print(f"Tunnel URL: {tunnel_url}")
    return tunnel_url


def set_telegram_webhook(ssh: paramiko.SSHClient, tunnel_url: str) -> None:
    if not BOT_TOKEN:
        return
    webhook_url = f"{tunnel_url.rstrip('/')}/api/telegram/webhook"
    run(ssh, f"curl -sf 'https://api.telegram.org/bot{BOT_TOKEN}/setWebhook?url={webhook_url}'")


def main() -> int:
    sys.stdout.reconfigure(errors="replace")
    require_password()
    action = sys.argv[1] if len(sys.argv) > 1 else "status"

    ssh = ssh_connect()
    try:
        if action == "status":
            for cmd in [
                "docker ps --filter name=pomich --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'",
                "curl -sf http://127.0.0.1:8000/api/health || echo HEALTH_FAILED",
                f"grep -E '^(WEB_APP_URL|TELEGRAM_MODE|POMICH_RUNTIME|POMICH_STORAGE_BACKEND|POMICH_CORS)' {REMOTE_DIR}/.env.production 2>/dev/null || echo NO_ENV",
                f"docker compose -f {REMOTE_DIR}/docker-compose.production.yml --env-file {REMOTE_DIR}/.env.production logs --tail=15 pomich-app 2>/dev/null || true",
            ]:
                print(f"\n=== {cmd} ===")
                run(ssh, cmd)
            return 0

        if action == "deploy":
            tunnel_url = latest_tunnel_url(ssh) or "https://monkey-stuck-fountain-lite.trycloudflare.com"
            print(f"Using tunnel URL: {tunnel_url}")
            upload_project(ssh)
            write_env_production(ssh, web_app_url=f"{tunnel_url}/", telegram_mode="webhook")
            run(ssh, f"chmod +x {REMOTE_DIR}/start.sh")
            run(ssh, f"cd {REMOTE_DIR} && docker compose -f docker-compose.production.yml --env-file .env.production down 2>/dev/null || true")
            run(ssh, f"cd {REMOTE_DIR} && docker compose -f docker-compose.production.yml --env-file .env.production up --build -d", check=True)
            print("Waiting 45s for startup...")
            time.sleep(45)
            set_telegram_webhook(ssh, tunnel_url)
            run(ssh, "curl -sf http://127.0.0.1:8000/api/health || echo HEALTH_FAILED")
            run(ssh, f"curl -sf {tunnel_url}/api/health || echo TUNNEL_HEALTH_FAILED")
            print(f"\nDeploy complete. HTTPS URL: {tunnel_url}/")
            return 0

        if action == "tunnel":
            tunnel_url = setup_cloudflare_tunnel(ssh)
            write_env_production(ssh, web_app_url=f"{tunnel_url}/", telegram_mode="webhook")
            run(ssh, f"cd {REMOTE_DIR} && docker compose -f docker-compose.production.yml --env-file .env.production up -d --build pomich-app", check=True)
            time.sleep(30)
            set_telegram_webhook(ssh, tunnel_url)
            print(f"\nHTTPS URL for BotFather: {tunnel_url}/")
            return 0

        print(f"Unknown action: {action}. Use: status | deploy | tunnel")
        return 2
    finally:
        ssh.close()


if __name__ == "__main__":
    raise SystemExit(main())
