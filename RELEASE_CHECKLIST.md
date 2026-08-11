# POMICH Release Checklist

## Current Gate
The repository is ready for a controlled pilot, not an unattended public production launch. Before release, the public browser must reach the frontend and FastAPI through the same public origin.

## Required Before Public Beta
- Stable public domain or named Cloudflare Tunnel is configured.
- Public `GET /api/health` returns `200`.
- Public `GET /api/providers` returns real provider data.
- Browser Network panel shows same-origin `/api/*` calls only, with no `localhost` or `127.0.0.1`.
- `POMICH_RUNTIME=production`.
- `POMICH_CORS_ORIGINS` contains exact HTTPS origin(s), never `*`.
- `POMICH_ADMIN_TOKEN` is a long random backend-only secret.
- `POMICH_PROVIDER_TOKEN` is set and shared only with trusted partner sessions.
- `TELEGRAM_BOT_TOKEN` is stored only on the backend.
- `WEB_APP_URL` points to the public HTTPS app URL.
- Runtime data is mounted outside the container image.
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

## Next Architecture Step
Move the JSON runtime store to Postgres/PostGIS before expanding beyond a small pilot. JSON files are acceptable for demo and short controlled testing only.
