#!/usr/bin/env bash
# Restore a dump into an isolated, disposable PostGIS container.
set -Eeuo pipefail

archive="${1:-}"
if [[ -z "$archive" || ! -f "$archive" || ! -f "$archive.sha256" ]]; then
  echo "Usage: $0 /path/to/pomich-TIMESTAMP.dump (with .sha256)" >&2
  exit 1
fi
archive="$(realpath "$archive")"
(cd "$(dirname "$archive")" && sha256sum --check --status "$(basename "$archive").sha256") || {
  echo "Backup checksum mismatch" >&2
  exit 1
}

container="pomich-restore-$$"
image="${POMICH_POSTGIS_IMAGE:-postgis/postgis:16-3.4}"
cleanup() { docker rm -f -v "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --name "$container" --network none \
  -e POSTGRES_PASSWORD=restore-test-only -e POSTGRES_DB=pomich_verify \
  "$image" >/dev/null

ready=0
for _ in {1..30}; do
  if docker exec "$container" pg_isready -U postgres -d pomich_verify >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
[[ "$ready" == 1 ]] || { echo "Restore database did not become ready" >&2; exit 1; }

docker exec -i "$container" sh -ec \
  'export PGPASSWORD="$POSTGRES_PASSWORD"; exec pg_restore --exit-on-error --no-owner --no-acl -U postgres -d pomich_verify' \
  < "$archive"

table_count="$(docker exec "$container" sh -ec \
  'export PGPASSWORD="$POSTGRES_PASSWORD"; exec psql -U postgres -d pomich_verify -Atc "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = '\''public'\'' AND table_type = '\''BASE TABLE'\''"')"
[[ "$table_count" =~ ^[0-9]+$ && "$table_count" -gt 0 ]] || {
  echo "Restore contained no public tables" >&2
  exit 1
}
echo "Restore verified: $table_count public tables (isolated container removed on exit)"
