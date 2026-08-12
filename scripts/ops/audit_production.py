"""Production audit snapshot via SSH."""
from __future__ import annotations

import json
import sys

from ssh_common import BOT_TOKEN, REMOTE_DIR, latest_tunnel_url, run, ssh_connect


def main() -> int:
    ssh = ssh_connect()
    try:
        tunnel = latest_tunnel_url(ssh)
        sections = {"tunnel_url": tunnel or "(not found)"}

        _, out, _ = run(ssh, "docker ps -a --filter name=pomich --format '{{.Names}}|{{.Status}}|{{.Ports}}'")
        sections["containers"] = out or "(none)"

        _, out, _ = run(ssh, "curl -sf http://127.0.0.1:8000/api/health || echo LOCAL_FAIL")
        sections["local_health"] = out

        if tunnel:
            _, out, _ = run(ssh, f"curl -sf {tunnel}/api/health || echo TUNNEL_FAIL")
            sections["tunnel_health"] = out
            _, out, _ = run(ssh, f"curl -sf {tunnel}/api/providers | head -c 400")
            sections["providers_sample"] = out[:400]
            _, out, _ = run(
                ssh,
                f"curl -sf {tunnel}/api/map/providers | python3 -c \"import sys,json; d=json.load(sys.stdin); print('count', len(d) if isinstance(d,list) else d)\" 2>/dev/null || echo MAP_FAIL",
            )
            sections["map_providers"] = out

        _, out, _ = run(
            ssh,
            "curl -sf -X POST http://127.0.0.1:8000/api/auth/customer/guest/session "
            "-H 'Content-Type: application/json' "
            "-d '{\"displayName\":\"AuditGuest\",\"phone\":\"+380501112233\"}' || echo GUEST_FAIL",
        )
        sections["guest_session"] = out[:300]

        if BOT_TOKEN:
            _, out, _ = run(ssh, f"curl -sf 'https://api.telegram.org/bot{BOT_TOKEN}/getMe'")
            sections["bot_getMe"] = out[:300]
            _, out, _ = run(ssh, f"curl -sf 'https://api.telegram.org/bot{BOT_TOKEN}/getWebhookInfo'")
            sections["bot_webhook"] = out[:400]
            _, out, _ = run(ssh, f"curl -sf 'https://api.telegram.org/bot{BOT_TOKEN}/getChatMenuButton'")
            sections["bot_menu"] = out[:400]

        _, out, _ = run(ssh, f"grep -E '^(WEB_APP_URL|POMICH_CORS|TELEGRAM_MODE)=' {REMOTE_DIR}/.env.production 2>/dev/null || echo NO_ENV")
        sections["env_snippet"] = out

        _, out, _ = run(ssh, "docker logs pomich-app --tail 15 2>&1")
        sections["app_logs_tail"] = out[-1200:]

        print(json.dumps(sections, indent=2, ensure_ascii=False))
        return 0
    finally:
        ssh.close()


if __name__ == "__main__":
    raise SystemExit(main())
