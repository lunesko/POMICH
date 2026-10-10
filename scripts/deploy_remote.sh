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

docker compose -f "$compose_file" --env-file "$env_file" up -d postgres
docker compose -f "$compose_file" --env-file "$env_file" build pomich-app
docker compose -f "$compose_file" --env-file "$env_file" up -d --no-deps pomich-app

healthy=false
for _ in $(seq 1 24); do
  if curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8000/api/health >/dev/null \
    && curl --fail --silent --show-error --max-time 5 http://127.0.0.1:8000/internal/ready >/dev/null; then
    healthy=true
    break
  fi
  sleep 5
done

if [[ "$healthy" != true ]]; then
  echo "ERROR: new application failed local health/readiness checks" >&2
  docker logs --tail 150 pomich-app >&2 || true
  if [[ -n "$previous_image" ]]; then
    echo "Restoring previous image: $previous_image"
    export POMICH_IMAGE="$previous_image"
    docker compose -f "$compose_file" --env-file "$env_file" up -d --no-deps pomich-app
  fi
  exit 1
fi

dist_next="/var/www/pomich/dist.next.$deploy_sha"
dist_previous="/var/www/pomich/dist.previous"
mkdir -p /var/www/pomich "$dist_next"
docker cp pomich-app:/app/dist/. "$dist_next/"

if [[ ! -f "$dist_next/index.html" ]] || ! ls "$dist_next"/assets/index-*.js >/dev/null 2>&1; then
  echo "ERROR: frontend assets missing from container dist" >&2
  rm -rf "$dist_next"
  if [[ -n "$previous_image" ]]; then
    echo "Restoring previous image: $previous_image"
    export POMICH_IMAGE="$previous_image"
    docker compose -f "$compose_file" --env-file "$env_file" up -d --no-deps pomich-app
  fi
  exit 1
fi

rm -rf "$dist_previous"
if [[ -d /var/www/pomich/dist ]]; then
  mv /var/www/pomich/dist "$dist_previous"
fi
mv "$dist_next" /var/www/pomich/dist

if command -v nginx >/dev/null 2>&1; then
  install -m 644 deploy/nginx/pomich_upstream.conf /etc/nginx/conf.d/pomich_upstream.conf
  install -m 644 deploy/nginx/pomich.help.conf /etc/nginx/sites-available/pomich.help
  ln -sfn /etc/nginx/sites-available/pomich.help /etc/nginx/sites-enabled/pomich.help
  nginx -t
  systemctl reload nginx
fi

if ! curl --fail --silent --show-error --max-time 15 "$public_url/api/health" >/dev/null; then
  echo "ERROR: public health check failed after deploy" >&2
  if [[ -d "$dist_previous" ]]; then
    rm -rf /var/www/pomich/dist
    mv "$dist_previous" /var/www/pomich/dist
  fi
  if [[ -n "$previous_image" ]]; then
    echo "Restoring previous image: $previous_image"
    export POMICH_IMAGE="$previous_image"
    docker compose -f "$compose_file" --env-file "$env_file" up -d --no-deps pomich-app
  fi
  exit 1
fi

asset_js="$(ls /var/www/pomich/dist/assets/index-*.js 2>/dev/null | head -1 || true)"
if [[ -z "$asset_js" ]]; then
  echo "ERROR: published frontend assets missing" >&2
  exit 1
fi
asset_code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -H 'Accept-Encoding: gzip' "$public_url/assets/$(basename "$asset_js")")"
if [[ "$asset_code" != "200" ]]; then
  echo "ERROR: public frontend asset check failed (HTTP $asset_code)" >&2
  if [[ -d "$dist_previous" ]]; then
    rm -rf /var/www/pomich/dist
    mv "$dist_previous" /var/www/pomich/dist
  fi
  exit 1
fi

rm -rf "$dist_previous"
docker image prune -f --filter 'until=168h' >/dev/null || true
echo "Production is healthy at $public_url (commit $deploy_sha)"
