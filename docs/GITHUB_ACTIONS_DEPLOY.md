# POMICH: GitHub Actions CI/CD

PRs run all existing tests, audits, PostGIS and browser checks. A push to `main`
runs the same checks and deploys that exact commit only when all three jobs pass.
`Actions → POMICH CI → Run workflow → main` also runs all checks before deploying.
Manual runs on other branches never deploy. Production jobs are serialized and
are not cancelled while a release is running.

## One-time setup from your computer

Use Git Bash on Windows, or Bash on Linux/macOS, with GitHub CLI (`gh`), OpenSSH
and an existing checkout of this repository. Run `gh auth login` as an account
allowed to manage this repository's environment secrets and Actions workflows.
Create the `production` environment in repository Settings → Environments if it
does not exist. Optional environment approval rules are managed there.

The server must already run Docker Compose v2 and have `rsync`, `curl`, `tar`,
Python 3, nginx and systemd. The current release script requires root privileges
and uses direct SSH (it does not automatically invoke sudo). Use the SSH account
that currently manages this installation. Its directory must already contain
`.env.production`, database credentials and the existing encryption/session keys.
Do not replace those keys or create a new empty database for an existing service.
Verify a recoverable database backup before the first release.

Use a private deploy key without a passphrase whose public half is already
authorized on this server. Keep the private file outside the repository.
The server's host key must be in your verified `known_hosts` file. Check a new
fingerprint against the hosting console or another trusted channel; an
unverified `ssh-keyscan` result alone is not a trusted identity.

```bash
bash scripts/setup_github_deploy.sh
```

The script prompts for server, SSH user/port, installation directory and local
key/known_hosts paths. It tests SSH and server prerequisites without modifying
the server, then sends settings directly from your computer to the GitHub
`production` environment. Key contents are not printed or committed. It does
not trigger a deployment. With a partial upload failure, correct the error and
run the script again.

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `POMICH_SSH_HOST` | Server IP or DNS |
| Secret | `POMICH_SSH_USER` | SSH deployment account |
| Secret | `POMICH_SSH_PORT` | SSH port, defaults to 22 |
| Secret | `POMICH_SSH_PRIVATE_KEY` | Entire private key file |
| Secret | `POMICH_SSH_KNOWN_HOSTS` | Verified host key entry, `[host]:port` for a custom port |
| Variable | `POMICH_REMOTE_DIR` | Existing installation, defaults to `/opt/pomich` |
| Variable | `POMICH_PUBLIC_URL` | `https://pomich.help` |

The existing password fallback (`POMICH_SSH_PASSWORD`) remains supported for
manual configuration; the setup script uses key authentication. Existing secrets
with other names, such as `VPS_HOST`, are not read by this workflow.

## Start and verify a release

```bash
gh workflow run ci.yml --repo lunesko/POMICH --ref main
gh run list --repo lunesko/POMICH --workflow ci.yml --limit 5
```

Open the resulting run and wait for **Deploy production** to succeed. A green PR
run or green test jobs alone do not mean production was updated. Configuration
validation reports all missing settings before packaging/uploading anything.
`--check` validates presence and scalar formats only, not actual SSH access.

The release uploads a source archive, builds the production image on the server,
runs database migrations, starts API and dispatch worker, checks readiness and
worker health, switches static assets/nginx and verifies public health and build
SHA/assets. `.env.production` and `data/` are preserved. The existing rollback
restores the previous application/static release on failure after its rollback
handler is installed; database migrations are not reverted and this is not a
replacement for verified backups. First-time server provisioning and disaster
recovery are separate operations.

If configuration failed before upload, fix environment secrets and use
**Re-run failed jobs** on that tested run, or manually run the workflow on main.
If deployment failed after changing the server, inspect its logs and health
before retrying. Never disable CI gates or host-key validation to make a release
pass.
