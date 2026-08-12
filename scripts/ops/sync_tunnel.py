"""Sync Cloudflare tunnel URL to production env, webhook, and Telegram menu button."""
from __future__ import annotations

import json
import sys

from ssh_common import BOT_TOKEN, REMOTE_DIR, latest_tunnel_url, run, ssh_connect


def main() -> int:
    if not BOT_TOKEN:
        print("ERROR: set TELEGRAM_BOT_TOKEN environment variable", file=sys.stderr)
        return 1

    ssh = ssh_connect()
    try:
        tunnel = latest_tunnel_url(ssh)
        if not tunnel:
            print("ERROR: could not detect tunnel URL from logs")
            return 1

        print(f"Tunnel: {tunnel}")
        run(ssh, f"sed -i 's|^POMICH_CORS_ORIGINS=.*|POMICH_CORS_ORIGINS={tunnel}|' {REMOTE_DIR}/.env.production")
        run(ssh, f"sed -i 's|^WEB_APP_URL=.*|WEB_APP_URL={tunnel}/|' {REMOTE_DIR}/.env.production")
        run(ssh, f"cd {REMOTE_DIR} && docker compose -f docker-compose.production.yml --env-file .env.production up -d pomich-app")

        webhook_url = f"{tunnel}/api/telegram/webhook"
        _, webhook_out, _ = run(ssh, f"curl -sf 'https://api.telegram.org/bot{BOT_TOKEN}/setWebhook?url={webhook_url}'")
        print("Webhook:", webhook_out[:200])

        menu_payload = json.dumps({"menu_button": {"type": "web_app", "text": "POMICH", "web_app": {"url": f"{tunnel}/"}}})
        _, menu_out, _ = run(
            ssh,
            f"curl -sf -X POST 'https://api.telegram.org/bot{BOT_TOKEN}/setChatMenuButton' "
            f"-H 'Content-Type: application/json' -d '{menu_payload}'",
        )
        print("Menu:", menu_out[:200])

        _, health, _ = run(ssh, f"curl -sf {tunnel}/api/health")
        print("Health:", health)
        return 0
    finally:
        ssh.close()


if __name__ == "__main__":
    raise SystemExit(main())
