# POMICH Architecture Strategy

POMICH should become an open roadside-assistance platform, not a language rewrite project.

The current direction is:

```text
Modular Monolith First, Services Later
PostgreSQL/PostGIS as Source of Truth
Open Geo Providers by Default
Commercial Adapters Optional
```

## Core Decision

Do not rewrite the current FastAPI backend to Java/Kotlin for beta.

The next milestone is to turn the existing MVP into a production-ready beta platform:

- stable CI gates;
- no production demo fallbacks;
- durable SQL/PostGIS storage;
- real account and role model;
- reliable dispatch;
- staging and production separation;
- Telegram Mini App on the same web frontend;
- object storage for KYC and vehicle/provider documents.

Java/Kotlin may be introduced later only when measured production load or integration complexity justifies extracting a dedicated service.

## Target Beta Architecture

```text
Clients
  React PWA
  Telegram Mini App
  Admin UI
      |
      | HTTPS / WS / SSE
      v
FastAPI Backend
  Auth / Accounts
  Orders
  Providers
  Dispatch
  Pricing
  Notifications
  Verification / KYC
  Admin
      |
      +--> PostgreSQL + PostGIS
      |
      +--> Object Storage
      |
      +--> Redis later, only when needed
```

The backend should evolve as a modular monolith. Preferred module shape:

```text
backend/
  api/
  auth/
  users/
  providers/
  orders/
  dispatch/
  pricing/
  payments/
  verification/
  notifications/
  telegram/
  admin/
  realtime/
  infrastructure/
  shared/
```

Each substantial module should own:

```text
router.py
service.py
repository.py
models.py
schemas.py
exceptions.py
```

## Source Of Truth

PostgreSQL/PostGIS is the source of truth.

Frontend state, Telegram state, WebSocket/SSE events, Redis, and map UI are projections of database state.

Example order assignment flow:

```text
Partner accepts offer
  -> API validates session
  -> PostgreSQL transaction
  -> order atomically changes state
  -> events are emitted
  -> Web/PWA, Telegram, and admin UI update
```

The assignment must remain atomic:

```sql
UPDATE orders
SET provider_id = :provider_id,
    status = 'ASSIGNED'
WHERE id = :order_id
  AND status = 'SEARCHING'
  AND provider_id IS NULL;
```

`affected_rows = 1` means the provider won. `affected_rows = 0` means another provider already accepted.

## Dispatch Direction

Dispatch is the heart of POMICH.

The target engine is not simply "nearest provider wins". It should move toward:

```text
Order created
  -> find candidates
  -> filter by online, verified, capability, TTL, radius
  -> score candidates
  -> send offers
  -> first valid accept wins
  -> atomic assignment
```

Initial scoring may combine:

```text
distance_score
ETA_score
rating_score
acceptance_score
service_match_score
workload_score
```

PostGIS remains the right default engine for spatial filtering:

```sql
WHERE online = true
  AND verified = true
  AND ST_DWithin(provider.location, order.location, :radius)
```

## Geo Provider Strategy

POMICH Core must not depend on Google.

The open-source/community stack should work without a Google API key:

```text
MapLibre / Leaflet
OpenStreetMap
OSRM or Valhalla
Nominatim or another open geocoder
PostgreSQL + PostGIS
```

Google Maps Platform should be an optional provider adapter, not core infrastructure.

Recommended provider interfaces:

```text
geo/
  routing/
    base.py
    osrm.py
    valhalla.py
    google.py
  geocoding/
    base.py
    nominatim.py
    google_places.py
  maps/
    maplibre.ts
    google.ts
```

Configuration should select the provider:

```env
ROUTING_PROVIDER=osrm
GEOCODING_PROVIDER=nominatim
MAP_PROVIDER=osm
```

or:

```env
ROUTING_PROVIDER=google
GEOCODING_PROVIDER=google
MAP_PROVIDER=google
GOOGLE_MAPS_API_KEY=...
```

## Google Data Boundary

Google data must not become the POMICH database.

POMICH-owned data:

```text
provider profile
provider live location
orders
prices
service areas
ratings
dispatch events
customer-owned order data
POMICH analytics
```

Provider data such as routes, ETA, places search results, and navigation instructions may be requested through adapters when configured. Persisting or reusing third-party map content must follow that provider's terms.

## Redis Policy

Redis is not required for the beta foundation.

Add Redis when there is a concrete production need:

- distributed presence TTL;
- rate limiting;
- WebSocket fanout across replicas;
- job queues;
- temporary OTP state;
- dispatch locks;
- hot cache.

Until then, PostgreSQL/PostGIS should stay authoritative.

## When To Add Java/Kotlin

Do not extract a Java/Kotlin dispatch service immediately after beta.

Measure first. Consider extraction only when there is evidence such as:

```text
large active-provider volume
high dispatch event throughput
complex scoring or pricing
Kafka/event-stream architecture
multiple backend teams
strict enterprise integration requirements
```

Possible future split:

```text
FastAPI Core
  Accounts
  Orders
  Admin
  Telegram
  KYC

Extracted services, only when justified
  Dispatch: Kotlin/Spring Boot or FastAPI
  Pricing: Python or Kotlin
  Fraud/Risk: Python/ML
  Payments: Java/Kotlin or dedicated provider integration
```

The language should follow the workload and team, not the other way around.

## Open Platform Direction

POMICH should be positioned as:

```text
Open Roadside Assistance Platform
```

Not just:

```text
Uber for tow trucks
```

The community edition should be runnable without commercial map providers:

```bash
git clone ...
docker compose up
```

and provide:

```text
client flow
partner flow
orders
dispatch
live location
admin
PostgreSQL/PostGIS
Telegram integration
open map stack
```

The commercial moat should live in the network and operations:

- POMICH brand;
- verified provider network;
- marketplace liquidity;
- customer base;
- historical operational data;
- insurance and fleet integrations;
- payment infrastructure;
- fraud/risk models;
- dispatch analytics;
- B2B contracts;
- managed cloud platform.

## IP And Licensing Notes

Final licensing requires legal review.

The likely direction is open core:

- open-source core under a permissive license such as Apache-2.0;
- commercial/enterprise modules for managed cloud, advanced analytics, integrations, fleet management, fraud, payments, SSO, and white-label;
- trademark protection for `POMICH`;
- contributor framework before broad public contribution.

Recommended repository/legal docs before public open-source launch:

```text
LICENSE
NOTICE
TRADEMARKS.md
CONTRIBUTING.md
CODE_OF_CONDUCT.md
SECURITY.md
CLA.md
GOVERNANCE.md
```

The code can be open. The POMICH brand, provider network, operational data, and commercial relationships remain company assets.

## Near-Term Execution Order

1. Stabilize core gates:
   `pytest`, `npm test`, `tsc`, `npm build`, PostGIS smoke.
2. Remove production demo fallbacks:
   demo providers, fake coordinates, hardcoded provider cards, test bypasses.
3. Build unified identity:
   users, roles, customer profiles, provider profiles, provider documents, admin permissions.
4. Harden dispatch:
   SQL/PostGIS filters, scoring, first-accept-wins, dispatch events.
5. Add production layer:
   dev/staging/prod separation, secrets, migrations, object storage, health checks, rollback.
6. Add geo provider adapters:
   routing, geocoding, map provider configuration.
7. Add Redis or extracted services only after measurement proves the need.

