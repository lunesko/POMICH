# Runtime reliability: dispatch, routing and contracts

## Scope and boundaries

FastAPI/PostgreSQL/PostGIS remain the runtime stack. This release introduces a
separate durable dispatch worker, rather than a Java rewrite or a new broker.
`bot/domain/order_state.py` owns canonical states; `bot/dispatch_service.py`
coordinates SQL dispatch; `bot/geo_search.py` selects candidates;
`bot/routing.py` owns routing; `bot/dispatch_jobs.py` owns durable timers.
`order_store.py` remains a compatibility facade and still contains profile and
legacy JSON logic. This is an incremental module separation, not a completed
rewrite of all account/profile operations.

## Release procedure

1. Back up PostgreSQL and verify that the archive reaches the configured off-site
   repository (`scripts/ops/backup_postgres.sh`). Rehearse recovery with
   `scripts/ops/verify_postgres_backup.sh` in an isolated disposable container.
2. Build the tested image. Run `python3 -m bot.migrate` once using the release
   migration credentials before starting API or worker. This creates the new
   `dispatch_jobs` and `dispatch_workers` tables alongside existing tables.
3. Start **both** `pomich-app` and `pomich-worker` with
   `docker compose -f docker-compose.production.yml --env-file .env.production up -d`.
   The production Compose explicitly sets `POMICH_DISPATCH_ASYNC=1` and
   `POMICH_TELEGRAM_WORKER_MODE=external` for both services. The worker processes
   dispatch jobs and starts the existing durable Telegram outbox processors.
4. Verify `/internal/ready` and the worker container health, then token-protected
   `/internal/metrics`: dispatch worker healthy, no dead letters, no overdue work.
   The release script now gates deployment on API and worker health.
5. Exercise creation, acceptance, price confirmation, completion and cancellation
   on the staging environment. A creation response no longer includes guaranteed
   immediate offers in async mode; clients observe updates through realtime and
   their existing HTTP reconciliation.

Development defaults to synchronous dispatch (`POMICH_DISPATCH_ASYNC=0`) so an
existing local SQL server without a worker remains usable. To test the async
path locally, set it to 1 and start `python3 -m bot.dispatch_worker`. Do not enable
external notification mode without starting the worker.

## Dispatch guarantees and recovery

Creating/updating an SQL order writes the corresponding timer in the same
transaction. Supported timer types are `dispatch.start`, `dispatch.next_wave`,
`dispatch.retry`, `offer.expire`, and `order.accepted_timeout`. Scheduling is
idempotent by order/kind/due time. PostgreSQL workers claim due jobs with
`FOR UPDATE SKIP LOCKED`; a lease can be recovered after 120 seconds. Completion
requires the current lease, so an old worker cannot acknowledge a recovered job.

A per-order PostgreSQL advisory lock serializes different timer kinds across
workers. Assignment uses transactional order/provider locks and rechecks that the provider
is online and has no active assignment after acquiring the provider lock. A
provider cannot accept two distinct orders through concurrent commands.
Pending-offer capacity is rechecked while holding the order row lock. Acceptance,
decline and expiry lock the order before its offers; expiry preserves all offer
events and cannot replace the payload of a concurrently accepted order. An empty
or unreadable provider registry returns no providers instead of embedded demo
contacts.

The worker reconciles existing active orders in pages on startup and every five
minutes, so pre-release active orders receive timers. It can run without browser
requests. Job errors retry with capped backoff and become visible dead letters
after eight attempts; they do not silently acknowledge work. Telegram delivery
remains at-least-once, not exactly-once.

A worker outage does not lose committed jobs. Returning it to service normally
resumes processing; a crash after claiming a job may add the lease recovery delay.
A completed or cancelled order makes an obsolete timer a safe no-op.

## Routing configuration

Set `POMICH_OSRM_URL` to an own or contracted OSRM HTTP endpoint supporting Route
and Table. Do not include a `/route/v1` suffix. An empty value disables upstream
routing and produces explicitly approximate ETA. This release does not download
or preprocess a routing graph and does not assume public demo server capacity.

Candidate retrieval uses a fixed maximum `ST_DWithin` radius before the individual
provider radius, stable ordering, and a bounded shortlist (default 32, configurable
8–100 via `POMICH_MATCH_CANDIDATE_LIMIT`). One OSRM Table call ranks that shortlist
by road ETA; explicitly unreachable entries are excluded. If the matrix is
unavailable/malformed, geographic ordering remains the fallback. This shortlist
strategy is approximate: a faster provider outside the geographic shortlist can
be missed. Initial service radius still takes priority over later radius steps.

For assigned providers, server estimates expose:

- `distanceKm`: straight-line distance;
- `roadDistanceKm`: road distance, or null;
- `etaMinutes`: estimated approach time;
- `etaSource`: `osrm` or `approximate`.

The client labels approximate approach time explicitly. OSRM ETA is still an
estimate; this setup does not promise live traffic or account for every closure.
The existing map continues drawing a fallback when route geometry is unavailable.

Route geometry is fetched through `POST /api/routing/route`. Coordinates are kept
in the request body rather than access-log URLs. Nginx applies a separate rate
limit and body limit to this public endpoint. OSRM target URLs come exclusively
from deployment configuration, never from user input. The adapter bounds concurrent
upstream requests, request timeouts, response size accepted for parsing, a 512-entry
per-process cache (30-second successes / 5-second failures), and handles outages.
The cache is disposable; separate instances may perform the same bounded requests.

## Realtime consistency

SQL order changes enqueue PostgreSQL NOTIFY invalidations in the transaction that
commits the new state, including affected provider channels. This closes the gap
between database commit and an API-side publish call. Clients continue using
WebSocket, SSE and periodic HTTP reconciliation. Notifications are hints, not a
durable event history. On reconnect, current state must be fetched; durable replay
is not introduced by this release. Long transactions or a full PostgreSQL
notification queue must be monitored because NOTIFY now participates in commit.

## API contract

`npm run api:generate` exports the application's OpenAPI into
`docs/api/openapi.json` and generates `src/api/generated.ts` with openapi-typescript.
`npm run api:check` regenerates and fails if the checked-in files differ.

The routing client consumes generated request/response types. Order creation,
read and administrative list routes now have explicit response models for stable
fields while retaining legacy extensions. Existing `src/api/client.ts` operations
are not all replaced in this release; migrate them endpoint by endpoint as response
models are expanded, preserving auth-first errors and compatibility.

## Monitoring and incident handling

Scrape the token-protected `/internal/metrics` from the private network. Alert on:

- `dispatchWorkerUnavailable`;
- `dispatchDelayed` (oldest due timer over 30 seconds);
- `dispatchDeadLetters`;
- existing `telegramDeadLetters`, `telegramPendingStale` and realtime broker alerts.

Future timers are not counted as overdue. Readiness checks verify the new SQL
tables; worker health verifies its shared heartbeat. A database heartbeat does not
prove every Telegram delivery succeeded: monitor outbox dead letters separately.

For a dead dispatch job, inspect worker logs and the referenced order before
retrying. Do not reset all jobs. Repair the cause, then conditionally reset the
single dead job's state to pending, attempts to zero, lease to null and
available_at to current epoch in a reviewed administrative database operation.
Preserve the original incident record. Never force a completed order back to searching.

## Availability limits and next infrastructure gate

The default Compose remains a **single-host, single-PostgreSQL** deployment. A
restart policy, a second worker or a second API process does not make the database
highly available. No server topology has been changed by this source-code patch.

Before multi-host rollout:

1. Select a managed HA PostgreSQL or a separately operated replicated cluster with
   a stable failover endpoint; test failover and connection recovery.
2. Remove remaining local runtime state from the request path: notably OTP
   challenges in `bot/otp_verification.py` still use a local JSON file and
   process locks. They must be moved into a shared transactional store before
   advertising transparent multi-host login/verification. A shared filesystem
   alone does not make those operations atomic.
3. Run at least two API instances behind a load balancer with WS/SSE timeouts and
   shared PostgreSQL realtime, shared keys/session registry and consistent clocks.
4. Separate Telegram polling ownership, or use the existing webhook mode; never
   start several independent polling consumers for the same bot.
5. Rehearse worker termination, DB failover, network isolation, rolling updates,
   off-site backup recovery and release rollback on staging.
6. Agree measurable SLO/RPO/RTO and collect latency/load evidence before claiming
   high availability. API and worker shares should have independent resource
   limits, and metrics/alerts must be consumed by an actual monitoring service.

The current release uses additive tables. Application rollback can retain them.
The deploy script stops the new worker before rolling an initial deployment back
to an image without the worker module. Database and static release rollback are
separate concerns; restoring an old database dump would discard newer user actions.

## Verification

Backend regressions cover atomic scheduling, process restart recovery, leases,
next-wave progress without HTTP, dead letters, HTTP enqueue-only creation and
pending-offer capacity. The PostGIS CI job additionally runs parallel claims,
transactional NOTIFY and `EXPLAIN (ANALYZE, BUFFERS)` on the actual candidate query
with 20,000 synthetic providers, and uploads the query plan. It does not force
`enable_seqscan=off` or assert machine-dependent timing.

The real backend browser harness launches an independent worker and checks the
lifecycle on desktop/mobile. SQLite is useful for local lifecycle checks but does
not substitute for PostgreSQL row/advisory locks or the PostGIS CI run.

## Audit integration and OTP transition (2026-10-26)

The integration forwards the functional fixes from audit PR #91 into the current
module layout. Its older file-layout refactor and realtime polling replacement
are superseded by the current domain/dispatch services and transactional realtime
broker. Current CSP hashes, strict encryption-key validation, support workflow and
atomic business transitions are retained.

OTP profile changes, challenges, confirmation attempts and account erasure share a
single SQL unit of work. The PostgreSQL advisory lock serializes OTP operations
across API workers; SQLite reserves its writer for isolated local tests. A missing
persisted customer cannot be recreated by a request authenticated before erasure.

Pending challenges from the old OTP JSON file are deliberately invalidated rather
than imported. The release migration retires that obsolete file after creating
the SQL tables; the first SQL OTP operation or erasure also performs this cleanup.
Users with a pending code request a new code after deployment. The code file is
removed, while customer profiles, order history and support cases retain their
existing migration and erasure rules.
