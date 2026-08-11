# POMICH Release Checklist

## Current Gate
The repository is ready for a controlled pilot, not an unattended public production launch. Before release, the public browser must reach the frontend and FastAPI through the same public origin.

## North Star
The beta release should prove a shorter and more predictable **Time To Rescue**: order creation to real provider arrival.

## Required Before Public Beta
- Stable public domain or named Cloudflare Tunnel is configured.
- Production-like stack starts with `docker-compose.production.yml` or an equivalent hosted deployment.
- Public `GET /api/health` returns `200`.
- Public `GET /api/providers` returns real provider data.
- Browser Network panel shows same-origin `/api/*` calls only, with no `localhost` or `127.0.0.1`.
- `POMICH_RUNTIME=production`.
- `POMICH_CORS_ORIGINS` contains exact HTTPS origin(s), never `*`.
- `POMICH_ADMIN_TOKEN` is a long random backend-only secret.
- `POMICH_PROVIDER_TOKEN` is set and shared only with trusted partner sessions.
- `TELEGRAM_BOT_TOKEN` is stored only on the backend.
- `WEB_APP_URL` points to the public HTTPS app URL.
- `DATABASE_URL` is configured for SQL runtime storage. JSON production storage requires explicit `POMICH_ALLOW_JSON_STORE_IN_PRODUCTION=true` and is only acceptable for a very small pilot.
- SQL runtime tables exist: `customers`, `providers`, `provider_presence`, `orders`, `dispatch_offers`, `sessions`, `order_events`.
- Dispatch candidate matching runs through SQL/PostGIS filters for online, verified, capability, TTL, assignment, and radius.
- Offer acceptance enforces first-accept-wins through the SQL runtime transaction path.
- A backup/export procedure exists for `orders`, `providers`, `customers`, `offers`, and Telegram sessions.
- GitHub Actions CI is green.

## Smoke Test
1. Open the public domain.
2. Reload `/interface` directly and confirm the SPA still loads.
3. Open customer flow and confirm `GET /api/providers` succeeds.
4. Open partner flow with a provider token and submit/verify provider profile.
5. Set partner online and confirm `PATCH /api/providers/{id}/presence` succeeds.
6. Confirm heartbeat calls continue every few seconds.
7. Create a customer order and confirm `POST /api/orders` returns `201`.
8. Confirm the partner receives an offer.
9. Accept the offer and advance statuses to `completed`.
10. Confirm no CORS errors and no localhost API requests in Network.

## Beta E2E Gate
The staging Playwright flow must pass end to end: Partner A online, Partner B online, customer creates order, offers are created, Partner A accepts, Partner B loses the race, customer sees Partner A, then status advances through `EN_ROUTE`, `ARRIVED`, `IN_PROGRESS`, and `COMPLETED`.

## Next Architecture Step
The app now uses normalized SQL runtime tables through `DATABASE_URL`, SQL/PostGIS candidate matching, and a SQL transaction path for first-accept-wins. The next storage step is adding explicit migrations instead of relying only on startup schema creation, then running the dispatch race gate against a real Postgres/PostGIS staging service.
