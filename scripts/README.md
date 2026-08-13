# POMICH Scripts

## Official data / migration scripts (`scripts/`)

| Script | Purpose |
|--------|---------|
| `import_uzhgorod_providers.py` | Import provider seed data for Uzhgorod region |
| `import_ukraine_providers.py` | Batch import directory POIs for all settlements in `data/settlements.json` |
| `migrate_customer_encryption.py` | Migrate customer PII to Fernet encryption at rest |
| `postgis_smoke.py` | Smoke-test PostGIS connectivity and spatial queries |
| `check-public.ps1` | Windows helper to verify public endpoint reachability |

## Production ops (`scripts/ops/`)

Requires environment variables (see `.env.example`):

- `POMICH_SSH_PASSWORD` — SSH password for production server
- `TELEGRAM_BOT_TOKEN` — bot token for webhook/menu sync

| Script | Purpose |
|--------|---------|
| `ssh_common.py` | Shared SSH connection helpers (not run directly) |
| `server_ops.py` | `status`, `deploy`, `tunnel` — full deploy with Docker rebuild |
| `sync_tunnel.py` | Sync current Cloudflare tunnel URL to env, webhook, menu button |
| `verify_production.py` | Health, guest registration, map providers, bot config |
| `audit_production.py` | Detailed JSON audit snapshot for debugging |

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
```

## Root deploy

| Script | Purpose |
|--------|---------|
| `deploy.py` | Simple SSH upload + Docker Compose up (preserves existing `.env.production`) |

```powershell
$env:POMICH_SSH_PASSWORD = "your-ssh-password"
python deploy.py
```
