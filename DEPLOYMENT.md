# POMICH Deployment

Deployment exists to prove the product promise: a real customer can request help, a verified provider can accept, and Time To Rescue can be measured.

## Production-Like Staging
Use this path for a public staging URL with one app container and Postgres/PostGIS.

1. Create `.env.production` from `.env.production.example`.
2. Replace every placeholder secret and password.
3. Set `POMICH_CORS_ORIGINS` to the exact public HTTPS origin.
4. Set `WEB_APP_URL` to the same public HTTPS app URL for Telegram Mini App testing.
5. Start the stack:

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
.\scripts\check-public.ps1 -PublicUrl https://app.example.com -Mutating -ProviderToken "<partner token>" -ProviderId "<provider-a-id>" -SecondProviderId "<provider-b-id>"
```

The mutating script issues provider sessions, sets two providers online, creates a real order, verifies both offers, confirms first-accept-wins by expecting `409 ORDER_ALREADY_ACCEPTED` for the second provider, and advances the accepted order to `completed`.

The script prints each exact request URL. In the browser Network panel, verify there are no requests to `localhost` or `127.0.0.1`.

## Rollback
Keep the previous image tag or commit SHA. If a deploy fails the smoke gate, route traffic back to the previous container and keep Postgres data volume intact.
