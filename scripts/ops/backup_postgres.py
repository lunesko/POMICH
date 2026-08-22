"""Create a timestamped PostgreSQL custom-format backup on the production host."""
from __future__ import annotations

import argparse
import datetime as dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ssh_common import REMOTE_DIR, run, ssh_connect


def sh_quote(value: str) -> str:
    return "'" + value.replace("'", "'\"'\"'") + "'"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backup POMICH Postgres/PostGIS data through SSH + Docker.")
    parser.add_argument("--remote-dir", default=REMOTE_DIR, help="Remote POMICH directory.")
    parser.add_argument("--backup-dir", default="backups", help="Backup directory relative to remote-dir.")
    parser.add_argument("--keep", type=int, default=14, help="Keep the newest N remote backups.")
    parser.add_argument("--download-dir", default="", help="Optional local directory to download the dump into.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    timestamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    remote_backup_dir = f"{args.remote_dir.rstrip('/')}/{args.backup_dir.strip('/')}"
    remote_path = f"{remote_backup_dir}/pomich-{timestamp}.dump"

    ssh = ssh_connect(timeout=30)
    try:
        commands = [
            f"mkdir -p {sh_quote(remote_backup_dir)}",
            (
                "docker exec pomich-postgres sh -lc "
                + sh_quote('pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner')
                + f" > {sh_quote(remote_path)}"
            ),
            f"test -s {sh_quote(remote_path)}",
            f"ls -lh {sh_quote(remote_path)}",
        ]
        for command in commands:
            rc, out, err = run(ssh, command, timeout=600)
            if rc != 0:
                print(err or out, file=sys.stderr)
                return rc
            if out:
                print(out)

        if args.keep > 0:
            retention = (
                f"find {sh_quote(remote_backup_dir)} -maxdepth 1 -type f -name 'pomich-*.dump' "
                f"| sort | head -n -{int(args.keep)} | xargs -r rm --"
            )
            rc, out, err = run(ssh, retention, timeout=120)
            if rc != 0:
                print(err or out, file=sys.stderr)
                return rc

        if args.download_dir:
            local_dir = Path(args.download_dir).expanduser().resolve()
            local_dir.mkdir(parents=True, exist_ok=True)
            local_path = local_dir / Path(remote_path).name
            with ssh.open_sftp() as sftp:
                sftp.get(remote_path, str(local_path))
            print(f"downloaded={local_path}")

        print(f"backup={remote_path}")
        return 0
    finally:
        ssh.close()


if __name__ == "__main__":
    raise SystemExit(main())
