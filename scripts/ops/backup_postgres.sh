#!/usr/bin/env bash
# Consistent PostgreSQL archive for the production Compose database.
set -Eeuo pipefail
umask 077

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
env_file="${POMICH_ENV_FILE:-$repo_dir/.env.production}"
backup_dir="${POMICH_BACKUP_DIR:-/var/backups/pomich}"
require_offsite="${POMICH_REQUIRE_OFFSITE_BACKUP:-1}"

if [[ "$backup_dir" != /* || "$backup_dir" == / || "$backup_dir" == "$repo_dir" ]]; then
  echo "POMICH_BACKUP_DIR must be a dedicated absolute directory" >&2
  exit 1
fi

if [[ ! -f "$env_file" ]]; then
  echo "Missing Compose environment file: $env_file" >&2
  exit 1
fi
if [[ "$require_offsite" != 0 && "$require_offsite" != 1 ]]; then
  echo "POMICH_REQUIRE_OFFSITE_BACKUP must be 0 or 1" >&2
  exit 1
fi
if [[ "$require_offsite" == 1 ]]; then
  if [[ -z "${RESTIC_REPOSITORY:-}" || -z "${RESTIC_PASSWORD_FILE:-}" ]]; then
    echo "Set RESTIC_REPOSITORY and RESTIC_PASSWORD_FILE for off-server backup" >&2
    exit 1
  fi
  command -v restic >/dev/null || { echo "restic is required" >&2; exit 1; }
  restic snapshots --json >/dev/null # fail before creating a local-only backup
fi

mkdir -p -- "$backup_dir"
chmod 700 -- "$backup_dir"
exec 9>"$backup_dir/.backup.lock"
flock -n 9 || { echo "Another backup is running" >&2; exit 1; }
archive="$backup_dir/pomich-$(date -u +%Y%m%dT%H%M%SZ)-$(date +%s).dump"
temporary="$(mktemp "$backup_dir/.pomich-XXXXXXXX.dump")"
trap 'rm -f -- "$temporary"' EXIT

compose=(docker compose --env-file "$env_file" -f "$repo_dir/docker-compose.production.yml")
"${compose[@]}" exec -T postgres sh -ec \
  'export PGPASSWORD="$POSTGRES_PASSWORD"; exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl' \
  > "$temporary"

[[ -s "$temporary" ]] || { echo "Empty PostgreSQL dump" >&2; exit 1; }
"${compose[@]}" exec -T postgres pg_restore --list < "$temporary" >/dev/null
mv -- "$temporary" "$archive"
(cd "$backup_dir" && sha256sum -- "$(basename "$archive")" > "$(basename "$archive").sha256")

if [[ "$require_offsite" == 1 ]]; then
  # Both archive and checksum must reach the off-server repository.
  restic backup --tag pomich-postgres -- "$archive" "$archive.sha256"
fi

# Only prune local copies after a successful off-site upload. Retention in the
# encrypted repository is managed separately and must be tested before pruning.
if [[ "$require_offsite" == 1 ]]; then
  find "$backup_dir" -maxdepth 1 -type f -name 'pomich-*.dump' -mtime +7 -delete
  find "$backup_dir" -maxdepth 1 -type f -name 'pomich-*.dump.sha256' -mtime +7 -delete
fi

echo "Backup complete: $archive"
echo "Verify a restore with: scripts/ops/verify_postgres_backup.sh '$archive'"
