# Alpha test accounts (closed pilot)

Closed Uzhhorod alpha set for client ↔ partner dry runs. Partners are marked `[TEST]`, stay **offline** until a tester goes on duty, and are flagged `excludeFromAnalytics`.

## Accounts

| Login | Role | Specialty |
|-------|------|-----------|
| `alpha-dispatcher` | admin | ops |
| `alpha-tow-01` | provider | tow |
| `alpha-battery-01` | provider | battery |
| `alpha-wheel-01` | provider | wheel |
| `alpha-fuel-01` | provider | fuel |

Plaintext passwords are **never** committed. They are written to `secrets/alpha-credentials.local.json` (gitignored).

## Generate + seed locally

```bash
python3 scripts/ops/seed_alpha_accounts.py --local
```

## Seed production (SSH)

Requires `POMICH_SSH_PASSWORD`. Merges hashed logins into `/opt/pomich/.env.production` and upserts provider rows.

```bash
python3 scripts/ops/seed_alpha_accounts.py --production
```

Reuse the same passwords on re-run:

```bash
python3 scripts/ops/seed_alpha_accounts.py --production \
  --reuse-credentials secrets/alpha-credentials.local.json
```

## Admin API (profiles only)

After deploy, admin token can upsert partner profiles without touching login env:

```bash
curl -sS -X POST https://pomich.help/api/admin/providers/seed-alpha \
  -H "X-POMICH-Admin-Token: $POMICH_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Login still needs the env merge from the ops script.

## Responsive notes already in mainline

Breakpoint `759`/`760`, phone landscape compact, map controls ≥44px, viewport zoom, and Sora via `<link>` are covered on recent `cursor/fix-*` branches — this pack focuses on alpha accounts.
