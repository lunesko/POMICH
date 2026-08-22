# POMICH Scripts

## Official data / migration scripts (`scripts/`)

| Script | Purpose |
|--------|---------|
| `import_uzhgorod_providers.py` | Import provider seed data for Uzhgorod region |
| `import_ukraine_providers.py` | Batch import directory POIs for all settlements in `data/settlements.json` |
| `migrate_customer_encryption.py` | Migrate customer PII to Fernet encryption at rest |
| `postgis_smoke.py` | Smoke-test PostGIS connectivity and spatial queries |
| `check-public.ps1` | Windows helper to verify public endpoint reachability |

## Import monitor GUI

Desktop app to **start/stop** Ukraine-wide provider import on production and watch live progress:

```powershell
pip install -r requirements-gui.txt
python scripts/ops/import_monitor_gui.py
```

- Buttons: «Старт парсингу» / «Стоп парсингу» (runs `scripts/ops/prod_import_worker.py`)
- Polls `http://157.173.101.252:8000/api/map/providers?scope=all` (URL configurable)
- SSH password is read from `POMICH_SSH_PASSWORD` or `.env.deploy` only when starting import — never embedded in the GUI
- Resume: skips cities that already have providers (checkbox)

Smoke test (no window): `python scripts/ops/import_monitor_gui.py --smoke`

## Production ops (`scripts/ops/`)

Requires environment variables (see `.env.example`):

- `POMICH_SSH_PASSWORD` — SSH password for production server
- `TELEGRAM_BOT_TOKEN` — legacy single-bot fallback for webhook/menu sync
- `TELEGRAM_CUSTOMER_BOT_TOKEN` / `TELEGRAM_PROVIDER_BOT_TOKEN` — preferred two-bot tokens
- See `docs/TELEGRAM_TWO_BOTS.md` and `scripts/ops/telegram_set_webhooks.py`

| Script | Purpose |
|--------|---------|
| `import_monitor_gui.py` | Desktop GUI: start/stop Ukraine import + live progress |
| `prod_import_worker.py` | Resume-friendly city-by-city prod import (used by GUI) |
| `import_monitor_status.py` | Shared JSON status file helpers |
| `ssh_common.py` | Shared SSH connection helpers (not run directly) |
| `server_ops.py` | `status`, `deploy`, `tunnel` — full deploy with Docker rebuild |
| `sync_tunnel.py` | Sync current Cloudflare tunnel URL to env, webhook, menu button |
| `verify_production.py` | Health, guest registration, map providers, bot config |
| `audit_production.py` | Detailed JSON audit snapshot for debugging |
| `backup_postgres.py` | Create timestamped Postgres/PostGIS `.dump` backups on the server |
| `restore_postgres.py` | Restore a remote Postgres/PostGIS backup with explicit `--yes` |

### Examples

```powershell
$env:POMICH_SSH_PASSWORD = "your-ssh-password"
$env:TELEGRAM_BOT_TOKEN = "123456:your-bot-token"

# Full deploy (upload + rebuild + webhook)
python scripts/ops/server_ops.py deploy

# After tunnel restart — sync URL without full rebuild
python scripts/ops/sync_tunnel.py

# Quick verification
python scripts/ops/verify_production.py

# Backup database and optionally download the dump
python scripts/ops/backup_postgres.py --download-dir .\backups

# Restore requires an absolute remote backup path and explicit confirmation
python scripts/ops/restore_postgres.py --backup /opt/pomich/backups/pomich-YYYYMMDDTHHMMSSZ.dump --yes
```

## Root deploy

| Script | Purpose |
|--------|---------|
| `deploy.py` | Simple SSH upload + Docker Compose up (preserves existing `.env.production`) |

```powershell
$env:POMICH_SSH_PASSWORD = "your-ssh-password"
python deploy.py
```
