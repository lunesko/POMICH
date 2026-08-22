"""Restore a POMICH PostgreSQL custom-format backup on the production host."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ssh_common import REMOTE_DIR, run, ssh_connect


def sh_quote(value: str) -> str:
    return "'" + value.replace("'", "'\"'\"'") + "'"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Restore POMICH Postgres/PostGIS data through SSH + Docker.")
    parser.add_argument("--backup", required=True, help="Remote backup path, for example /opt/pomich/backups/pomich-YYYY.dump.")
    parser.add_argument("--remote-dir", default=REMOTE_DIR, help="Remote POMICH directory.")
    parser.add_argument("--yes", action="store_true", help="Required. Confirms destructive database restore.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    backup_path = args.backup.strip()
    if not backup_path.startswith("/"):
        print("--backup must be an absolute remote path.", file=sys.stderr)
        return 2
    if not args.yes:
        print("Refusing to restore without --yes.")
        print("This will stop pomich-app, replace the Postgres database contents, then restart pomich-app.")
        print(f"backup={backup_path}")
        return 2

    compose_file = f"{args.remote_dir.rstrip('/')}/docker-compose.production.yml"
    env_file = f"{args.remote_dir.rstrip('/')}/.env.production"
    compose = f"docker compose -f {sh_quote(compose_file)} --env-file {sh_quote(env_file)}"
    restore_sql = (
        'dropdb -U "$POSTGRES_USER" "$POSTGRES_DB" --if-exists && '
        'createdb -U "$POSTGRES_USER" "$POSTGRES_DB" && '
        'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner'
    )

    ssh = ssh_connect(timeout=30)
    try:
        commands = [
            f"test -s {sh_quote(backup_path)}",
            f"{compose} stop pomich-app",
            f"cat {sh_quote(backup_path)} | docker exec -i pomich-postgres sh -lc {sh_quote(restore_sql)}",
            f"{compose} up -d pomich-app",
            "curl -sf http://127.0.0.1:8000/api/health",
        ]
        for command in commands:
            rc, out, err = run(ssh, command, timeout=900)
            if rc != 0:
                print(err or out, file=sys.stderr)
                return rc
            if out:
                print(out)
        print(f"restored={backup_path}")
        return 0
    finally:
        ssh.close()


if __name__ == "__main__":
    raise SystemExit(main())
