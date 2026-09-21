#!/usr/bin/env python3
"""Generate + apply closed alpha test accounts (passwords stay local / on server secrets).

Examples:
  # Local store (tests / dry-run):
  python3 scripts/ops/seed_alpha_accounts.py --local --credentials secrets/alpha-credentials.local.json

  # Production via SSH (uses POMICH_SSH_PASSWORD; merges login accounts into .env.production):
  python3 scripts/ops/seed_alpha_accounts.py --production
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from bot.alpha_accounts import (  # noqa: E402
    ALPHA_PROVIDERS,
    build_credential_bundle,
    merge_account_env_lists,
    seed_alpha_accounts,
    write_plaintext_credentials,
)


def _print_summary(result: dict, *, show_passwords: bool) -> None:
    print(f"Providers: added={result['providers']['added']} updated={result['providers']['updated']}")
    print(f"IDs: {', '.join(result['providers']['ids'])}")
    print(f"Credentials file: {result['credentialsPath']}")
    if show_passwords:
        print("WARNING: printing plaintext passwords to stdout")
        for username, password in (result.get("plaintext") or {}).items():
            print(f"  {username} = {password}")
    else:
        print("Plaintext passwords written only to credentials file (gitignored).")


def run_local(credentials: Path, reuse: Path | None, show_passwords: bool) -> int:
    result = seed_alpha_accounts(credentials_path=credentials, reuse_passwords_from=reuse)
    _print_summary(result, show_passwords=show_passwords)
    print("Env fragments (hashed) for local docker:")
    print("POMICH_PROVIDER_ACCOUNTS=" + json.dumps(result["providerAccounts"], ensure_ascii=False, separators=(",", ":")))
    print("POMICH_ADMIN_ACCOUNTS_ALPHA=" + json.dumps(result["adminAccounts"], ensure_ascii=False, separators=(",", ":")))
    return 0


def run_production(credentials: Path, reuse: Path | None, show_passwords: bool) -> int:
    ops_dir = Path(__file__).resolve().parent
    if str(ops_dir) not in sys.path:
        sys.path.insert(0, str(ops_dir))
    from ssh_common import REMOTE_DIR, run as ssh_run, ssh_connect  # type: ignore

    passwords: dict[str, str] = {}
    if reuse and reuse.is_file():
        prior = json.loads(reuse.read_text(encoding="utf-8"))
        for account in prior.get("accounts") or []:
            if isinstance(account, dict) and account.get("username") and account.get("password"):
                passwords[str(account["username"])] = str(account["password"])

    bundle = build_credential_bundle(passwords)
    write_plaintext_credentials(credentials, bundle["plaintext"], generated_at=bundle["generatedAt"])

    providers_json = json.dumps(bundle["providers"], ensure_ascii=False)
    provider_accounts_json = json.dumps(bundle["providerAccounts"], ensure_ascii=False, separators=(",", ":"))
    admin_accounts_json = json.dumps(bundle["adminAccounts"], ensure_ascii=False, separators=(",", ":"))

    ssh = ssh_connect()
    try:
        # 1) Upsert provider rows inside the running app container (SQL/runtime).
        seed_py = f"""
import json
from bot.alpha_accounts import upsert_alpha_providers
providers = json.loads({providers_json!r})
print(json.dumps(upsert_alpha_providers(providers), ensure_ascii=False))
"""
        remote_seed = f"{REMOTE_DIR}/.alpha_seed_once.py"
        ssh_run(ssh, f"cat > {remote_seed} << 'PYEOF'\n{seed_py}\nPYEOF", timeout=60)
        rc, out, err = ssh_run(
            ssh,
            f"docker exec -i pomich-app python3 - <<'PY'\n{seed_py}\nPY",
            timeout=120,
        )
        if rc != 0:
            print(f"Provider upsert failed ({rc}): {err or out}", file=sys.stderr)
            return 1
        print(f"Provider upsert: {out.strip()}")

        # 2) Merge hashed login accounts into .env.production (keep dispatcher/oleksandr etc.).
        rc, existing_provider, _ = ssh_run(
            ssh,
            f"grep '^POMICH_PROVIDER_ACCOUNTS=' {REMOTE_DIR}/.env.production | head -1 | cut -d= -f2-",
            timeout=30,
        )
        rc2, existing_admin, _ = ssh_run(
            ssh,
            f"grep '^POMICH_ADMIN_ACCOUNTS=' {REMOTE_DIR}/.env.production | head -1 | cut -d= -f2-",
            timeout=30,
        )
        # File may contain $$ escapes from a prior write — restore real $ before JSON merge.
        existing_provider = (existing_provider or "").replace("$$", "$")
        existing_admin = (existing_admin or "").replace("$$", "$")
        merged_providers = merge_account_env_lists(
            existing_provider if rc == 0 else "",
            bundle["providerAccounts"],
            id_keys=("providerId", "username", "id"),
        )
        merged_admins = merge_account_env_lists(
            existing_admin if rc2 == 0 else "",
            bundle["adminAccounts"],
            id_keys=("username", "id", "email"),
        )
        from bot.alpha_accounts import docker_compose_escape_env_value

        merged_providers_env = docker_compose_escape_env_value(merged_providers)
        merged_admins_env = docker_compose_escape_env_value(merged_admins)

        # Escape for shell sed-safe rewrite via python on the server.
        rewrite = f"""
from pathlib import Path
import re
path = Path("{REMOTE_DIR}/.env.production")
text = path.read_text(encoding="utf-8")
def set_key(raw, key, value):
    line = key + "=" + value
    pattern = re.compile(r"^" + re.escape(key) + r"=.*$", re.M)
    if pattern.search(raw):
        return pattern.sub(lambda _m: line, raw, count=1)
    return raw.rstrip() + "\\n" + line + "\\n"
text = set_key(text, "POMICH_PROVIDER_ACCOUNTS", {merged_providers_env!r})
text = set_key(text, "POMICH_ADMIN_ACCOUNTS", {merged_admins_env!r})
path.write_text(text, encoding="utf-8")
print("env_updated")
"""
        rc, out, err = ssh_run(ssh, f"python3 - <<'PY'\n{rewrite}\nPY", timeout=60)
        if rc != 0:
            print(f"Env merge failed: {err or out}", file=sys.stderr)
            return 1
        print(out.strip())

        # 3) Recreate app so new account env is loaded (postgres volume untouched).
        rc, out, err = ssh_run(
            ssh,
            f"cd {REMOTE_DIR} && docker compose -f docker-compose.production.yml --env-file .env.production up -d --force-recreate --no-deps pomich-app",
            timeout=300,
        )
        if rc != 0:
            print(f"Recreate failed: {err or out}", file=sys.stderr)
            return 1
        print("pomich-app recreated with alpha login accounts")

        # Health
        ssh_run(ssh, "sleep 8 && curl -sf http://127.0.0.1:8000/api/health", timeout=60)
    finally:
        ssh.close()

    result = {
        "providers": {"added": "?", "updated": "?", "ids": [p["id"] for p in ALPHA_PROVIDERS]},
        "credentialsPath": str(credentials),
        "plaintext": bundle["plaintext"],
    }
    # Fix summary counts from upsert output if possible
    _print_summary(
        {
            "providers": {"added": 0, "updated": 0, "ids": [p["id"] for p in ALPHA_PROVIDERS]},
            "credentialsPath": str(credentials),
            "plaintext": bundle["plaintext"],
        },
        show_passwords=show_passwords,
    )
    print("Production seed complete. Login with usernames from credentials file.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--local", action="store_true", help="Seed local JSON/SQL store")
    mode.add_argument("--production", action="store_true", help="Seed production via SSH")
    parser.add_argument(
        "--credentials",
        type=Path,
        default=ROOT / "secrets" / "alpha-credentials.local.json",
        help="Where to write plaintext passwords (gitignored)",
    )
    parser.add_argument(
        "--reuse-credentials",
        type=Path,
        default=None,
        help="Reuse passwords from an existing credentials file",
    )
    parser.add_argument("--show-passwords", action="store_true", help="Print passwords to stdout (unsafe)")
    args = parser.parse_args()

    if args.local:
        return run_local(args.credentials, args.reuse_credentials, args.show_passwords)
    return run_production(args.credentials, args.reuse_credentials, args.show_passwords)


if __name__ == "__main__":
    raise SystemExit(main())
