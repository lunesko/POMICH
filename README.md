# POMICH

**POMICH — допомога вже їде.**

POMICH is an on-demand roadside assistance platform. The product goal is not to be a directory of towing services or a map clone; it is dispatch infrastructure that turns a roadside incident into assigned, tracked, real-world help from a suitable verified provider nearby.

## Product Direction

The north-star metric is **Time To Rescue**: the time from customer order creation to real provider arrival.

Core flow:

```text
Incident
  -> geolocation
  -> POMICH dispatch
  -> suitable verified providers nearby
  -> first provider accepts
  -> provider assigned
  -> help is on the way
  -> arrived
  -> work completed
```

Current beta foundation work is tracked in [docs/BETA_FOUNDATION.md](docs/BETA_FOUNDATION.md). The product manifesto is in [docs/POMICH_MANIFESTO.md](docs/POMICH_MANIFESTO.md).

## Stack

- Frontend: React, Vite, Tailwind CSS, Leaflet/OpenStreetMap
- Backend: FastAPI
- Runtime storage: **PostgreSQL + PostGIS in production** (`DATABASE_URL`, `POMICH_STORAGE_BACKEND=sql`). JSON file store is local/dev (and pytest) fallback only — not for production unless `POMICH_ALLOW_JSON_STORE_IN_PRODUCTION=true`
- HTTP API: FastAPI routers under `bot/routers/` (auth, orders, providers, admin, customers, events)
- Realtime: SSE at `/api/events/orders/{id}` and `/api/events/providers/{id}` with polling fallback in the UI
- SQL schema: explicit runtime migrations recorded in `pomich_schema_migrations`
- CI: backend tests, frontend tests, TypeScript, production build, and PostGIS runtime smoke
- Auth: bearer sessions for customers, providers, and admins; provider/admin beta account login via backend account config
- Staging target: one public HTTPS origin serving Web/PWA and `/api/*`
- Telegram: same Web frontend as Telegram Mini App, with backend `initData` verification and `tg-*` customer identity linking

## Development

```powershell
npm test
npx tsc --noEmit
npm run build
python -m pytest
```

Local Vite dev uses same-origin `/api/*` proxying to FastAPI. Public/demo tunneling must not expose browser calls to `localhost` or `127.0.0.1`.

## Release Docs

- [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md)
- [DEPLOYMENT.md](DEPLOYMENT.md)
- [TELEGRAM_RUNTIME.md](TELEGRAM_RUNTIME.md)
- [PRE_PRODUCTION_AUDIT.md](PRE_PRODUCTION_AUDIT.md)
