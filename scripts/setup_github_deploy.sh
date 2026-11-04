#!/usr/bin/env bash
# Run locally in Git Bash/Linux/macOS. Never enable shell tracing here.
set +x
set -Eeuo pipefail
repo='lunesko/POMICH'

for command_name in gh ssh ssh-keygen; do
  command -v "$command_name" >/dev/null || { echo "$command_name is required" >&2; exit 1; }
done
gh auth status >/dev/null 2>&1 || { echo 'Run gh auth login first.' >&2; exit 1; }

read -r -p 'Server IP or DNS: ' server
read -r -p 'SSH user: ' deploy_user
read -r -p 'SSH port [22]: ' deploy_port
deploy_port="${deploy_port:-22}"
read -r -p 'Existing installation directory [/opt/pomich]: ' remote_dir
remote_dir="${remote_dir:-/opt/pomich}"
read -r -p 'Private key file (use /c/Users/... in Git Bash): ' key_file
read -r -p "Verified known_hosts file [$HOME/.ssh/known_hosts]: " hosts_file
hosts_file="${hosts_file:-$HOME/.ssh/known_hosts}"

[[ "$server" =~ ^[A-Za-z0-9.-]+$ && "$server" != -* ]] || { echo 'Invalid server' >&2; exit 1; }
[[ "$deploy_user" =~ ^[A-Za-z0-9._-]+$ && "$deploy_user" != -* ]] || { echo 'Invalid SSH user' >&2; exit 1; }
[[ "$deploy_port" =~ ^[0-9]{1,5}$ ]] && (( 10#$deploy_port >= 1 && 10#$deploy_port <= 65535 )) || { echo 'Invalid port' >&2; exit 1; }
[[ "$remote_dir" =~ ^/[A-Za-z0-9._/-]+$ && "$remote_dir" != / ]] || { echo 'Invalid installation directory' >&2; exit 1; }
[[ -f "$key_file" && -f "$hosts_file" ]] || { echo 'Key or known_hosts file not found' >&2; exit 1; }
# Actions cannot unlock a passphrase-protected key interactively.
ssh-keygen -y -P '' -f "$key_file" >/dev/null || { echo 'Use a deploy key without a passphrase, already authorized on the server.' >&2; exit 1; }
host_lookup="$server"
if [[ "$deploy_port" != 22 ]]; then host_lookup="[$server]:$deploy_port"; fi
host_keys="$(ssh-keygen -F "$host_lookup" -f "$hosts_file")" || {
  echo 'No trusted host key found. Verify the server fingerprint with its console before adding it to known_hosts.' >&2
  exit 1
}

echo 'Checking SSH access and existing installation (no server changes)...'
ssh -F /dev/null -p "$deploy_port" -i "$key_file" \
  -o BatchMode=yes -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes \
  -o "UserKnownHostsFile=$hosts_file" -o ConnectTimeout=20 \
  "$deploy_user@$server" bash -s -- "$remote_dir" <<'REMOTE'
set -eu
for tool in docker rsync curl tar python3 nginx systemctl; do command -v "$tool" >/dev/null; done
docker compose version >/dev/null
test -f "$1/.env.production"
test -w "$1"
# The current release script installs nginx files and changes data ownership.
test "$(id -u)" = 0 || { echo 'Current deploy_remote.sh requires a root SSH user.' >&2; exit 1; }
REMOTE

echo 'Saving deployment settings to GitHub environment production...'
printf '%s' "$server" | gh secret set POMICH_SSH_HOST --repo "$repo" --env production
printf '%s' "$deploy_user" | gh secret set POMICH_SSH_USER --repo "$repo" --env production
printf '%s' "$deploy_port" | gh secret set POMICH_SSH_PORT --repo "$repo" --env production
gh secret set POMICH_SSH_PRIVATE_KEY --repo "$repo" --env production < "$key_file"
printf '%s\n' "$host_keys" | gh secret set POMICH_SSH_KNOWN_HOSTS --repo "$repo" --env production
gh variable set POMICH_REMOTE_DIR --repo "$repo" --env production --body "$remote_dir"
gh variable set POMICH_PUBLIC_URL --repo "$repo" --env production --body 'https://pomich.help'
echo 'Settings saved. No deployment was started.'
echo 'Run: gh workflow run ci.yml --repo lunesko/POMICH --ref main'
