"""Verify production health, registration, and bot configuration."""
from __future__ import annotations

import json
import sys

from ssh_common import BOT_TOKEN, REMOTE_DIR, latest_tunnel_url, run, ssh_connect


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ssh = ssh_connect()
    try:
        tunnel = latest_tunnel_url(ssh)
        results = {
            "tunnel": tunnel,
            "containers": "",
            "local_health": "",
            "tunnel_health": "",
            "registration": "",
            "map_providers": "",
            "webhook": "",
            "menu": "",
        }

        _, results["containers"], _ = run(ssh, "docker ps --filter name=pomich --format '{{.Names}} {{.Status}}'")
        _, results["local_health"], _ = run(ssh, "curl -sf http://127.0.0.1:8000/api/health || echo FAIL")
        if tunnel:
            _, results["tunnel_health"], _ = run(ssh, f"curl -sf {tunnel}/api/health || echo FAIL")
            _, map_out, _ = run(
                ssh,
                f"curl -sf {tunnel}/api/map/providers | python3 -c \"import sys,json; d=json.load(sys.stdin); print(len(d) if isinstance(d,list) else d)\"",
            )
            results["map_providers"] = map_out

        _, reg, _ = run(
            ssh,
            "curl -sf -X POST http://127.0.0.1:8000/api/auth/customer/guest/session "
            "-H 'Content-Type: application/json' "
            "-d '{\"displayName\":\"AuditGuest\",\"phone\":\"+380501112233\"}' || echo FAIL",
        )
        results["registration"] = reg[:300]

        if BOT_TOKEN:
            _, results["webhook"], _ = run(ssh, f"curl -sf 'https://api.telegram.org/bot{BOT_TOKEN}/getWebhookInfo'")
            _, results["menu"], _ = run(ssh, f"curl -sf 'https://api.telegram.org/bot{BOT_TOKEN}/getChatMenuButton'")

        _, env_snip, _ = run(ssh, f"grep -E '^(WEB_APP_URL|TELEGRAM_MODE)=' {REMOTE_DIR}/.env.production")
        results["env"] = env_snip

        print(json.dumps(results, indent=2, ensure_ascii=False))
        return 0
    finally:
        ssh.close()


if __name__ == "__main__":
    raise SystemExit(main())
