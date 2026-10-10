#!/usr/bin/env bash
set -Eeuo pipefail

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "ERROR: $name is required" >&2
    exit 1
  fi
}

require_env POMICH_SSH_HOST
require_env POMICH_SSH_USER

POMICH_SSH_PORT="${POMICH_SSH_PORT:-22}"
POMICH_REMOTE_DIR="${POMICH_REMOTE_DIR:-/opt/pomich}"
POMICH_PUBLIC_URL="${POMICH_PUBLIC_URL:-https://pomich.help}"
POMICH_DEPLOY_SHA="${POMICH_DEPLOY_SHA:-${GITHUB_SHA:-}}"

if [[ ! "$POMICH_SSH_PORT" =~ ^[0-9]+$ ]]; then
  echo "ERROR: POMICH_SSH_PORT must be numeric" >&2
  exit 1
fi
if [[ ! "$POMICH_SSH_HOST" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "ERROR: POMICH_SSH_HOST must be an IPv4 address or DNS hostname" >&2
  exit 1
fi
if [[ ! "$POMICH_SSH_USER" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "ERROR: unsafe POMICH_SSH_USER" >&2
  exit 1
fi
if [[ ! "$POMICH_REMOTE_DIR" =~ ^/[A-Za-z0-9._/-]+$ || "$POMICH_REMOTE_DIR" == "/" ]]; then
  echo "ERROR: unsafe POMICH_REMOTE_DIR" >&2
  exit 1
fi
if [[ ! "$POMICH_DEPLOY_SHA" =~ ^[0-9a-f]{7,40}$ ]]; then
  echo "ERROR: POMICH_DEPLOY_SHA must be a Git commit SHA" >&2
  exit 1
fi
if [[ ! "$POMICH_PUBLIC_URL" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?/?$ ]]; then
  echo "ERROR: POMICH_PUBLIC_URL must be an HTTPS origin" >&2
  exit 1
fi

work_dir="$(mktemp -d)"
archive="$work_dir/pomich-$POMICH_DEPLOY_SHA.tar.gz"
ssh_dir="$work_dir/ssh"
mkdir -p "$ssh_dir"
trap 'rm -rf "$work_dir"' EXIT

known_hosts="$ssh_dir/known_hosts"
require_env POMICH_SSH_KNOWN_HOSTS
printf '%s\n' "$POMICH_SSH_KNOWN_HOSTS" > "$known_hosts"
chmod 600 "$known_hosts"

ssh_options=(
  -F /dev/null
  -p "$POMICH_SSH_PORT"
  -o "UserKnownHostsFile=$known_hosts"
  -o StrictHostKeyChecking=yes
  -o ConnectTimeout=20
  -o ServerAliveInterval=15
  -o ServerAliveCountMax=4
)
scp_options=(
  -F /dev/null
  -P "$POMICH_SSH_PORT"
  -o "UserKnownHostsFile=$known_hosts"
  -o StrictHostKeyChecking=yes
  -o ConnectTimeout=20
)

auth_prefix=()
if [[ -n "${POMICH_SSH_PRIVATE_KEY:-}" ]]; then
  key_file="$ssh_dir/deploy_key"
  printf '%s\n' "$POMICH_SSH_PRIVATE_KEY" > "$key_file"
  chmod 600 "$key_file"
  ssh_options+=( -o BatchMode=yes -o IdentitiesOnly=yes -i "$key_file" )
  scp_options+=( -o BatchMode=yes -o IdentitiesOnly=yes -i "$key_file" )
elif [[ -n "${POMICH_SSH_PASSWORD:-}" ]]; then
  if ! command -v sshpass >/dev/null 2>&1; then
    echo "ERROR: sshpass is required for password authentication" >&2
    exit 1
  fi
  export SSHPASS="$POMICH_SSH_PASSWORD"
  auth_prefix=(sshpass -e)
  ssh_options+=( -o PreferredAuthentications=password -o PubkeyAuthentication=no )
  scp_options+=( -o PreferredAuthentications=password -o PubkeyAuthentication=no )
else
  echo "ERROR: configure POMICH_SSH_PRIVATE_KEY or POMICH_SSH_PASSWORD" >&2
  exit 1
fi

echo "Packaging tested commit $POMICH_DEPLOY_SHA"
tar \
  --exclude=.git \
  --exclude=node_modules \
  --exclude=dist \
  --exclude='.env*' \
  --exclude='*.pyc' \
  --exclude='__pycache__' \
  -czf "$archive" .

remote_archive="/tmp/pomich-$POMICH_DEPLOY_SHA.tar.gz"
echo "Uploading release archive"
"${auth_prefix[@]}" scp "${scp_options[@]}" "$archive" "$POMICH_SSH_USER@$POMICH_SSH_HOST:$remote_archive"

echo "Deploying release on production"
"${auth_prefix[@]}" ssh "${ssh_options[@]}" "$POMICH_SSH_USER@$POMICH_SSH_HOST" \
  bash -s -- "$POMICH_REMOTE_DIR" "$POMICH_DEPLOY_SHA" "$POMICH_PUBLIC_URL" "$remote_archive" \
  < scripts/deploy_remote.sh

echo "Deployment $POMICH_DEPLOY_SHA completed"
