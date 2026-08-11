# POMICH MVP 0.5 — Beta Foundation

This milestone moves POMICH from demo-MVP to beta-MVP. The goal is not more screens. The goal is a trustworthy dispatch foundation for real roadside assistance in one pilot market.

## North Star

**Time To Rescue**: time from order creation to real provider arrival.

Every major feature should either reduce Time To Rescue, improve assignment trust, or make the provider network safer and more reliable.

## Current Status

Done:

- GitHub Actions CI runs backend tests, frontend tests, TypeScript, and production build.
- Frontend uses same-origin `/api/*` instead of browser `localhost`.
- FastAPI serves API and built SPA from one origin.
- Production guards block unsafe CORS, missing provider/admin secrets, and missing production `DATABASE_URL`.
- SQL runtime storage exists behind the current API without breaking UI/API contracts.
- Normalized runtime tables exist for `customers`, `providers`, `provider_presence`, `orders`, `dispatch_offers`, `sessions`, and `order_events`.
- PostGIS extension/index setup is prepared for PostgreSQL runtime.
- Provider candidate search runs through the SQL runtime path with `online`, `verified`, capability, TTL, assignment, and radius filters.
- PostgreSQL candidate search uses `ST_DWithin`/`ST_Distance`; SQLite keeps a portable SQL + Haversine test adapter.
- Offer acceptance uses the SQL runtime transaction path so first-accept-wins is enforced at the database boundary.
- Provider endpoints require configured backend auth; missing `POMICH_PROVIDER_TOKEN` no longer makes partner routes public.
- Backend can issue HMAC-signed admin/provider sessions and enforces provider session identity against URL `provider_id`.
- Telegram Mini App order creation records the verified Telegram identity into the order payload.
- Production-like Docker Compose exists with app + Postgres/PostGIS.

## Work Sequence

### 1. CI/CD Gate

Status: done.

Required rule: no deploy if any of these fail:

```text
python -m pytest
npm test
npx tsc --noEmit
npm run build
```

### 2. Storage Abstraction To PostgreSQL/PostGIS

Status: in progress.

Completed:

- SQL backend is available through `DATABASE_URL`.
- Runtime data is split into normalized tables.
- API and UI remain unchanged.
- JSON remains dev/test adapter.
- Provider candidate matching is no longer Python-list-only on the SQL runtime path.
- First-accept-wins has a SQL transaction path with a regression test where one provider accepts and the second receives `ORDER_ALREADY_ACCEPTED`.

Next:

- Add explicit migrations instead of startup-only schema creation.
- Add indexes around `status`, `service`, `provider_id`, `order_id`, and coordinates.
- Run the dispatch race gate against a real Postgres/PostGIS service in staging.

Target dispatch query shape:

```sql
online = true
AND capability = 'tow'
AND ST_DWithin(provider.location, order.location, radius)
```

### 3. Auth Model

Status: in progress.

Completed:

- Provider auth is mandatory on backend partner routes.
- Admin auth is separate from provider auth.
- Backend accepts signed admin/provider sessions through `Authorization: Bearer`.
- Provider sessions are scoped to one provider id; a session for Provider A cannot operate Provider B routes.
- Verified Telegram Mini App orders get backend-attached Telegram customer identity.

Target:

- Customer: guest/session or Telegram identity.
- Provider: replace bootstrap shared secret UX with provider login/session issuance.
- Admin: replace query-token UX with admin session/login flow.
- Backend determines role and permissions; UI is never source of truth.

### 4. Stable Staging

Status: partially ready.

Target:

- `staging.pomich.help` or equivalent.
- One HTTPS origin for frontend and `/api`.
- Exact CORS.
- Persistent Postgres/PostGIS.
- Restart policy.
- Healthcheck.
- Structured logs.
- Public smoke gate.

### 5. Telegram Mini App

Status: partially ready.

Target:

- `@pomich_help_bot` opens the same Web frontend.
- Backend verifies Telegram `initData`.
- Telegram user links to POMICH customer.
- Telegram order creation uses the same `/api/orders`.

### 6. Release Gate

Status: not done.

Required staging E2E:

```text
Partner A online
Partner B online
Customer creates order
Dispatch offers are created
Partner A accepts
Partner B loses race
Customer sees Partner A
EN_ROUTE
ARRIVED
IN_PROGRESS
COMPLETED
```

This should become a Playwright scenario against staging.

## Do Not Add Yet

Avoid until beta foundation is proven:

- Redis
- Kubernetes
- Kafka
- microservices
- WebSocket-first architecture
- AI matching
- Google Maps SDK dependency
- complex payment layer
- native apps

For the first 3-5 real providers, these slow down learning more than they help.

## Target Architecture

```text
Web / PWA ─────────────── Telegram Mini App
     │                          │
     └────────────┬─────────────┘
                  │
                HTTPS
                  │
               FastAPI
                  │
       ┌──────────┼──────────┐
       │          │          │
      Auth     Dispatch    Orders
       │          │          │
       └──────────┼──────────┘
                  │
         PostgreSQL + PostGIS
                  │
          ┌───────┴────────┐
          │                │
     Provider Geo       Events
          │
     radius search
          │
      Dispatch offers
          │
   first-accept-wins
```

Maps: OpenStreetMap + Leaflet.

Routing later: OSRM or Valhalla.

## Product Boundary

We are not building a towing app.

We are building dispatch infrastructure for physical roadside help.
