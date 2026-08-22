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
- `POMICH_PROVIDER_TOKEN` is set as a backend-only bootstrap secret for issuing provider sessions.
- `POMICH_CUSTOMER_SESSION_SECRET` is a long random backend-only secret.
- `POMICH_ADMIN_ACCOUNTS` and `POMICH_PROVIDER_ACCOUNTS` are configured for beta account login, preferably with `passwordHash=sha256:<hex>`.
- Provider/admin operational routes require bearer sessions; bootstrap token headers are valid only on `/api/auth/*/session`.
- Missing provider auth must return `provider_auth_not_configured` when provider auth is not configured and `provider_session_required` when a session is missing.
- Signed provider sessions must be scoped to one provider id.
- Web provider/admin flows use `Authorization: Bearer` sessions for operational calls and remove bootstrap tokens from the URL after reading them.
- Customer profile and verification routes require matching customer bearer sessions.
- `TELEGRAM_BOT_TOKEN` is stored only on the backend.
- `WEB_APP_URL` points to the public HTTPS app URL.
- `DATABASE_URL` is configured for SQL runtime storage. JSON production storage requires explicit `POMICH_ALLOW_JSON_STORE_IN_PRODUCTION=true` and is only acceptable for a very small pilot.
- SQL runtime tables exist: `customers`, `providers`, `provider_presence`, `orders`, `dispatch_offers`, `sessions`, `order_events`.
- SQL migration ledger exists as `pomich_schema_migrations` and records applied runtime schema versions.
- Dispatch candidate matching runs through SQL/PostGIS filters for online, verified, capability, TTL, assignment, and radius.
- Offer acceptance enforces first-accept-wins through the SQL runtime transaction path.
- GitHub Actions includes a PostGIS runtime smoke job against a real `postgis/postgis` service.
- A backup/export procedure exists for `orders`, `providers`, `customers`, `offers`, and Telegram sessions.
- GitHub Actions CI is green.

## Smoke Test
1. Open the public domain.
2. Reload `/interface` directly and confirm the SPA still loads.
3. Open customer flow and confirm `GET /api/providers` succeeds.
4. Confirm Telegram Mini App or guest customer session issuance works through `/api/auth/customer/*/session`.
5. Log in provider/admin through `/api/auth/provider/login` and `/api/auth/admin/login`, or use bootstrap session issuance only for controlled transition testing.
6. Set Partner A and Partner B online and confirm `PATCH /api/providers/{id}/presence` succeeds for both.
7. Confirm heartbeat calls continue every few seconds.
8. Create a customer order and confirm `POST /api/orders` returns `201`.
9. Confirm both partners receive offers.
10. Accept with Partner A and confirm Partner B receives `409 ORDER_ALREADY_ACCEPTED`.
11. Confirm Partner A's proposed price as the customer.
12. Advance the accepted order through `en_route`, `arrived`, `in_progress`, and `completed`.
13. Confirm no CORS errors and no localhost API requests in Network.
14. Confirm customer/provider/admin operational requests use `Authorization: Bearer`, not repeated bootstrap-token headers.

## Beta E2E Gate
The staging Playwright flow must pass end to end: Partner A online, Partner B online, customer creates order, offers are created, Partner A accepts with price, Partner B loses the race, customer sees Partner A and confirms the price, then status advances through `EN_ROUTE`, `ARRIVED`, `IN_PROGRESS`, and `COMPLETED`.

Run it with `npm run test:e2e` after setting `POMICH_E2E_BASE_URL`, `POMICH_E2E_PROVIDER_A_*`, and `POMICH_E2E_PROVIDER_B_*`. Without staging env, the Playwright test is skipped.

## Next Architecture Step
The app now uses normalized SQL runtime tables through `DATABASE_URL`, explicit schema migrations, SQL/PostGIS candidate matching, and a SQL transaction path for first-accept-wins. The next architecture step is running the same dispatch race gate against a real public staging origin and converting it into a browser-level Playwright release gate.
