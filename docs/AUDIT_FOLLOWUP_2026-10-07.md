# POMICH audit follow-up — 2026-10-07

Reviewed both supplied audit files against main at `1a2df96303218c5cdc197852a9f6834b0eab053f`. The branch combines verified security/stability fixes with structural improvements. Recommendations for wholesale rewrites and deployment operations are distinguished from reproducible defects below.

## Implemented changes

| Finding | Change and evidence |
|---|---|
| Telegram CORS preflight rejected | Allow both Telegram initData/bot headers; OPTIONS regression test. |
| Decryption failures silently erased PII | Raise FieldEncryptionError, return generic HTTP 503, preserve stored ciphertext; wrong/missing/invalid key and recovery tests. |
| Unsafe queue access from request threads | Bind subscribers to their running event loop; use call_soon_threadsafe for delivery, overflow handling and cleanup. |
| Realtime isolated per worker | Shared, bounded SQL event log with asynchronous polling; independent-process delivery regression. PostgreSQL publisher lock preserves sequence/commit ordering. JSON development retains local fan-out. |
| OTP isolated in a local file | Shared SQL OTP repository, transactional cooldown/attempt state, PostgreSQL advisory lock and SQLite BEGIN IMMEDIATE; independent-worker attempt counter and confirmation tests. Expected verification errors commit attempt/deletion changes. Stale background deliveries cannot overwrite a newer code. |
| Divergent order payload / relational columns | One order writer synchronizes every normalized column with payload and advances an integer version. Migration backfills existing rows. Stale snapshot/upsert rejection and existing-database migration tests. |
| Expiry lost events for multiple offers | Reload locked order/offer state in consistent order; every expired offer retains its event. Compare version before changing a snapshot's offers. |
| Multi-worker schema startup | Serialize PostgreSQL schema creation/migrations; reset failed engine initialization so later calls retry safely. |
| Configuration getters reloaded .env | Explicit startup loading only, pure environment getters; test collection opts out. |
| Cross-test imports and persistent test data | Shared fixture; independent temporary PII, OTP and session paths. |
| Vitest collected Playwright | Explicit unit-test include patterns; one npm test command for local and CI. |
| Conflicting npm/pnpm setup | Keep npm/package-lock, remove pnpm lock and pin; align CI/Docker/toolchain guidance with Node 22. |
| Transport failures lost their cause | Preserve ApiRequestError cause; distinguish timeout/cancellation/network failures; retain HTTP status and headers. |
| Edge CSP missing for static responses | Match backend/nginx CSP; cover location-level header inheritance; static consistency test. |
| No broad application-level request limits | Fixed-window login/read/write limits, atomic SQL counters shared across workers; 429 Retry-After and cross-process tests. Enabled by default in production, configurable in .env.example. Health, Telegram webhooks and realtime connections retain their existing controls. |
| Unnecessarily long ordinary Telegram requests | Default 5-second transport timeout; long polling remains explicit; sanitize exception messages to avoid token-bearing URL logs. Existing outbound worker queue retained. |
| Large customer/provider flow components | Extract screen components; separate provider controller and views. Keep existing public props and exercise existing flow tests. |
| Navigation scattered across useState | One typed navigation reducer, stable setters and complete browser-history snapshots; Back restoration and URL-cleanup preservation tests. No credentials are stored in history. |
| API client / CSS monoliths | Split API by domain with compatible facade; split CSS by section with unchanged rule ordering and contents. This is a maintainability change, not a claimed CSS download reduction. |
| Mixed SQL schema/migrations and domain rules | Extract schema, migrations, SQL value helpers and pure order status/price/geo rules. Existing exports remain available. |
| Legacy Flask dependency | Retire Flask routes/dependency together; bot.app now exports the canonical ASGI application and supports uvicorn startup. |
| Missing frontend crash reporting | Anonymous allowlisted render/JS/rejection counters through the existing telemetry logger; no error messages, stacks, URLs or account data sent. Payload bounds and privacy regression tests. Deployment can forward container logs to its chosen monitoring service. |
| Example address/version inconsistencies | Replace environment-specific server IP and align example frontend version with package.json. |
| Credential recurrence | CI scanner rejects tracked local environment files and realistic Telegram tokens; reports only filenames/lines. |

## Audit statements corrected

- .env was already ignored. No tracked .env or commits from `git log --all -- .env` were found in the fetched repository. The supplied token is not evidence that it was committed. No shared history rewrite was performed.
- The scanner found no realistic Telegram tokens in the tracked tree. This is not an exhaustive historical secret audit. The separately supplied provider credential was not added to source or documentation.
- Backend CSP already existed; the defect was the edge/static policy gap. The existing pragmatic policy is preserved, not presented as strict CSP hardening.
- Flask was used by a compatibility shim; dependency and shim had to be retired together.
- web-vitals resolved after npm ci; its alleged missing dependency failure was not reproduced.
- Python dictionary equality ignores key ordering. Versioned concurrency addresses explicit storage consistency, not that incorrect key-order claim.
- Telegram notifications already use a bounded outbound queue. Retaining a synchronous long-polling client is intentional; this branch does not claim an AsyncClient migration.
- No unresolved Git LFS pointers were found in tracked files. Historical asset migration is an optional repository-size decision, not required to restore missing content.
- React Router/Zustand are implementation suggestions, not prerequisites for correct navigation. This branch consolidates state and verifies history behavior without replacing every product URL/session flow.

## Validation

| Check | Result |
|---|---|
| Baseline backend / frontend | 250 / 375 tests passed |
| Final backend | 275 passed; one dependency deprecation warning |
| Final frontend | 386 passed across 58 files |
| TypeScript | npx tsc --noEmit passed |
| Production build | npm run build passed |
| Production dependency audit | Zero vulnerabilities reported |
| Credential scanner / whitespace | Passed |
| Existing-database migration | SQLite order version backfill and subsequent update passed |
| Multiple independent processes | OTP state, realtime delivery and rate-limit counter passed against shared SQLite |

Chromium installation failed locally with a corrupt/truncated archive. GitHub CI for commit `1c7e988c0bc09bab8761aec50617d401a9dd991b` subsequently passed unit tests/build, Playwright UX/accessibility checks, PostGIS runtime smoke and backup/restore round trip (run `37573350861`). The follow-up changes require another CI run. A new nginx -t step validates the edge files using disposable TLS fixtures; nginx is not installed in this local environment, so that check must run in CI. No live VPS/bot verification or deployment was performed. Do not treat pending follow-up CI checks as passed.

## Deployment and remaining architectural work

- Install the newly supplied provider credential as TELEGRAM_PROVIDER_BOT_TOKEN for @pomich_help_bot through the deployment's secret store, then verify bot identity and webhook/polling. No server secret access was available here. Do not copy the token into this report or a PR.
- Keep the existing POMICH_ENCRYPTION_KEY during deployment. SQL startup creates the new tables and migrates order versions; take the usual database backup before rollout. Old file-backed pending OTP codes are not imported and users may need a new code. Browser realtime clients hydrate current state after reconnect; the event log is not a durable message broker.
- Confirm trusted proxy IP resolution before relying on IP-based limits. Defaults are deliberately broad and should be tuned with operational traffic evidence.
- Polling introduces up to roughly 0.5 seconds delivery latency plus database work per subscription. External monitoring dashboards/alert rules and retention require deployment configuration. Anonymous crash counters are aggregate visibility, not source-map crash diagnostics.
- Core domain operations are now separated into lifecycle, matching, customer/provider profiles, order queries and review services with explicit dependency records. The original order_store imports/signatures remain as a compatibility facade; the service modules do not import that facade. Further narrowing of large dependency records/controllers is possible but is not required for the fixed behavior. Two exact CSS duplicates were removed; removal of other historical override rules requires visual review. No destructive binary/history cleanup was performed.

## Structural and review follow-up

- Moved 119 order/profile/dispatch operations into six service modules. Injection is explicit and evaluated at call time, preserving existing patch/instrumentation boundaries and locks without globals copying or circular service imports.
- SQL lifecycle and dispatch responses now use the saved payload, including the advanced version. Stale lifecycle writes surface a domain conflict before offer/provider side effects; regression tests cover both paths.
- Captured the SQL realtime cursor before exposing a subscription. A deterministic regression publishes during registration and verifies delivery.
- Back/Forward now synchronizes or clears the persisted role; reload and landing-restoration regressions cover both storage locations.
- Extracted provider geolocation/offer-feed hooks and customer nearby-provider/order-tracking hooks. A polling regression covers clock ticks, equal specialty arrays and subscription cleanup.
- Split the original backend order/API tests into eleven feature modules with shared non-test support; split 54 frontend flow declarations into five feature modules with shared mocks/setup. Existing test counts are retained, plus the new regressions.
- Added actual nginx syntax validation to CI, generating temporary certificates and DH parameters without touching deployment certificates or changing routing/header directives.

Merge after required CI checks. Server credential installation, monitoring account configuration and production rollout remain deployment operations outside the available access.
