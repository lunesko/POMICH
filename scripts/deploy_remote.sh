#!/usr/bin/env bash
set -Eeuo pipefail

remote_dir="$1"
deploy_sha="$2"
public_url="${3%/}"
remote_archive="$4"
release_dir="/tmp/pomich-release-$deploy_sha"
compose_file="$remote_dir/docker-compose.production.yml"
env_file="$remote_dir/.env.production"
new_image="pomich-app:$deploy_sha"

cleanup() {
  rm -rf "$release_dir" "$remote_archive"
}
trap cleanup EXIT

for command_name in docker rsync curl tar; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "ERROR: $command_name is required on the production server" >&2
    exit 1
  fi
done
docker compose version >/dev/null

if [[ ! -f "$env_file" ]]; then
  echo "ERROR: $env_file is missing; production secrets are never created by CI" >&2
  exit 1
fi

rm -rf "$release_dir"
mkdir -p "$release_dir" "$remote_dir/data"
tar -xzf "$remote_archive" -C "$release_dir"

rsync -a --delete \
  --exclude='.env.production' \
  --exclude='data/' \
  "$release_dir/" "$remote_dir/"
rsync -a "$release_dir/data/" "$remote_dir/data/"

cd "$remote_dir"
previous_image="$(docker inspect --format '{{.Config.Image}}' pomich-app 2>/dev/null || true)"
export POMICH_IMAGE="$new_image"
export POMICH_BUILD_SHA="$deploy_sha"
# The runtime image runs as an unprivileged, fixed UID.
chown -R 10001:10001 "$remote_dir/data"
dist_previous="/var/www/pomich/dist.previous"
static_switched=false
nginx_backup="$(mktemp -d)"
for config in /etc/nginx/conf.d/pomich_upstream.conf /etc/nginx/sites-available/pomich.help; do
  if [[ -f "$config" ]]; then cp -p "$config" "$nginx_backup/$(basename "$config")"; fi
done
rollback() {
  local result=$?
  trap - ERR
  set +e
  echo "Deploy failed; restoring previous release" >&2
  if [[ "$static_switched" == true && -d "$dist_previous" ]]; then
    rm -rf /var/www/pomich/dist
    mv "$dist_previous" /var/www/pomich/dist
  fi
  for config in /etc/nginx/conf.d/pomich_upstream.conf /etc/nginx/sites-available/pomich.help; do
    if [[ -f "$nginx_backup/$(basename "$config")" ]]; then cp -p "$nginx_backup/$(basename "$config")" "$config"; fi
  done
  if [[ -n "$previous_image" ]]; then
    export POMICH_IMAGE="$previous_image"
    docker compose -f "$compose_file" --env-file "$env_file" up -d --no-deps pomich-app
  fi
  if command -v nginx >/dev/null; then nginx -t && systemctl reload nginx; fi
  exit "$result"
}
trap rollback ERR

docker compose -f "$compose_file" --env-file "$env_file" up -d postgres
docker compose -f "$compose_file" --env-file "$env_file" build pomich-app
# Run DDL once before starting the new runtime; production startup performs no DDL.
docker compose -f "$compose_file" --env-file "$env_file" run --rm --no-deps pomich-app python3 -m bot.migrate
docker compose -f "$compose_file" --env-file "$env_file" up -d --no-deps pomich-app

healthy=false
for _ in $(seq 1 24); do
  if curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8000/internal/ready >/dev/null; then
    healthy=true
    break
  fi
  sleep 5
done

if [[ "$healthy" != true ]]; then
  docker logs --tail 150 pomich-app >&2 || true
  false  # ERR trap restores the previous release.
fi

dist_next="/var/www/pomich/dist.next.$deploy_sha"
dist_previous="/var/www/pomich/dist.previous"
mkdir -p /var/www/pomich "$dist_next"
docker cp pomich-app:/app/dist/. "$dist_next/"

rm -rf "$dist_previous"
if [[ -d /var/www/pomich/dist ]]; then
  mv /var/www/pomich/dist "$dist_previous"
fi
static_switched=true
# Keep old hashed chunks for existing browser tabs. Never overwrite new chunks.
if [[ -d "$dist_previous/assets" ]]; then
  mkdir -p "$dist_next/assets"
  rsync -a --ignore-existing "$dist_previous/assets/" "$dist_next/assets/"
fi
mv "$dist_next" /var/www/pomich/dist

if command -v nginx >/dev/null 2>&1; then
  install -m 644 deploy/nginx/pomich_upstream.conf /etc/nginx/conf.d/pomich_upstream.conf
  install -m 644 deploy/nginx/pomich.help.conf /etc/nginx/sites-available/pomich.help
  ln -sfn /etc/nginx/sites-available/pomich.help /etc/nginx/sites-enabled/pomich.help
  nginx -t
  systemctl reload nginx
fi

curl --fail --silent --show-error --max-time 15 "$public_url/api/health" >/dev/null
python3 scripts/check_release_assets.py "$public_url" "$deploy_sha"
trap - ERR
rm -rf "$nginx_backup"

rm -rf "$dist_previous"
docker image prune -f --filter 'until=168h' >/dev/null || true
echo "Production is healthy at $public_url (commit $deploy_sha)"
