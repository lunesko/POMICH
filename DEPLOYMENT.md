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
.\scripts\check-public.ps1 -PublicUrl https://app.example.com -Mutating -ProviderToken "<partner token>" -ProviderId "<provider-a-id>" -SecondProviderId "<provider-b-id>"
```

The mutating script issues provider sessions, sets two providers online, creates a real order, verifies both offers, confirms first-accept-wins by expecting `409 ORDER_ALREADY_ACCEPTED` for the second provider, and advances the accepted order to `completed`.

The script prints each exact request URL. In the browser Network panel, verify there are no requests to `localhost` or `127.0.0.1`.

## Automatic production deploy from GitHub Actions

Every push to `main` now runs the complete CI suite first. The `Deploy production` job starts only after both `Test and build` and `PostGIS runtime smoke` succeed. Pull requests never deploy.

Create a GitHub environment named `production`, then add these repository or environment secrets:

| Name | Required | Value |
| --- | --- | --- |
| `POMICH_SSH_HOST` | Yes | Production server hostname or IP |
| `POMICH_SSH_USER` | Yes | SSH user; currently normally `root` |
| `POMICH_SSH_PRIVATE_KEY` | Recommended | Private deployment key accepted by the server |
| `POMICH_SSH_PASSWORD` | Fallback | SSH password; use only when a deployment key is not configured |
| `POMICH_SSH_PORT` | No | SSH port; defaults to `22` |
| `POMICH_SSH_KNOWN_HOSTS` | Recommended | Output of `ssh-keyscan -H <host>` pinned as a secret |

Add these GitHub environment variables when the defaults are not correct:

| Name | Default |
| --- | --- |
| `POMICH_REMOTE_DIR` | `/opt/pomich` |
| `POMICH_PUBLIC_URL` | `https://pomich.help` |

The server must already have Docker, the Docker Compose plugin, `rsync`, nginx, and a configured `/opt/pomich/.env.production`. The workflow never uploads or overwrites `.env.production`. It refreshes tracked reference files under `data/` without deleting server-only runtime files from that directory.

The deploy uploads the exact commit tested by CI, tags the image with that commit SHA, recreates the application container, waits for the local health endpoint, publishes the built frontend, validates nginx, and checks the public health endpoint. If the new container fails its local health check, the previous image is restored automatically. Database migrations must therefore remain backward-compatible with the previous application image.

## Rollback
The workflow keeps commit-tagged images and automatically restores the previous application image when the new container fails its local health check. PostgreSQL data is stored in its named volume and is not replaced during deploy. For a manual rollback, set `POMICH_IMAGE` to a previous `pomich-app:<commit-sha>` tag and run Docker Compose again.
