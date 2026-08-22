# POMICH Deployment

Deployment exists to prove the product promise: a real customer can request help, a verified provider can accept, and Time To Rescue can be measured.

## Production-Like Staging
Use this path for a public staging URL with one app container and Postgres/PostGIS.

1. Create `.env.production` from `.env.production.example`.
2. Replace every placeholder secret and password.
3. Set `POMICH_CORS_ORIGINS` to the exact public HTTPS origin.
4. Set `WEB_APP_URL` to the same public HTTPS app URL for Telegram Mini App testing.
5. Set `POMICH_CUSTOMER_SESSION_SECRET`, `POMICH_ADMIN_ACCOUNTS`, and `POMICH_PROVIDER_ACCOUNTS` for beta account login.
6. Start the stack:

```powershell
docker compose -f docker-compose.production.yml --env-file .env.production up --build -d
```

For config validation without real secrets:

```powershell
$env:POMICH_ENV_FILE=".env.production.example"
docker compose -f docker-compose.production.yml --env-file .env.production.example config
Remove-Item Env:\POMICH_ENV_FILE
```

The app container exposes FastAPI and the built SPA on port `8000`. Your public reverse proxy or Cloudflare Tunnel should route the public HTTPS origin to this port. Browser API calls must remain same-origin `/api/*`.

On startup the backend bootstraps normalized runtime tables and applies explicit schema migrations recorded in `pomich_schema_migrations`. On PostgreSQL it enables PostGIS and migration-manages GiST indexes for provider and customer coordinates so dispatch can use `ST_DWithin` queries without changing the public API.

## Smoke Gate
Run the non-mutating smoke check:

```powershell
.\scripts\check-public.ps1 -PublicUrl https://app.example.com
```

Run the full mutating smoke check on staging only:

```powershell
.\scripts\check-public.ps1 -PublicUrl https://app.example.com -Mutating -ProviderId "<provider-a-id>" -ProviderLogin "<provider-a-login>" -ProviderPassword "<provider-a-password>" -SecondProviderId "<provider-b-id>" -SecondProviderLogin "<provider-b-login>" -SecondProviderPassword "<provider-b-password>"
```

The mutating script issues provider and customer sessions, sets two providers online, creates a real order, verifies both offers, confirms first-accept-wins by expecting `409 ORDER_ALREADY_ACCEPTED` for the second provider, confirms the partner price as the customer, and advances the accepted order to `completed`.

Run the browser/API beta release gate on staging:

```bash
POMICH_E2E_BASE_URL=https://staging.pomich.help \
POMICH_E2E_PROVIDER_A_ID=provider-a \
POMICH_E2E_PROVIDER_A_LOGIN=provider-a \
POMICH_E2E_PROVIDER_A_PASSWORD=... \
POMICH_E2E_PROVIDER_B_ID=provider-b \
POMICH_E2E_PROVIDER_B_LOGIN=provider-b \
POMICH_E2E_PROVIDER_B_PASSWORD=... \
npm run test:e2e
```

The Playwright gate reloads `/interface`, rejects browser requests to localhost API origins, attaches the exact browser `/api/*` request URLs to the report, then completes the same provider race, customer price confirmation, and lifecycle through same-origin `/api/*`.

The script prints each exact request URL. In the browser Network panel, verify there are no requests to `localhost` or `127.0.0.1`.

## Rollback
Keep the previous image tag or commit SHA. If a deploy fails the smoke gate, route traffic back to the previous container and keep Postgres data volume intact.
