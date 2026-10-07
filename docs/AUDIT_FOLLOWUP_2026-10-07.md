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
| Final backend | 272 passed; one dependency deprecation warning |
| Final frontend | 383 passed across 53 files |
| TypeScript | npx tsc --noEmit passed |
| Production build | npm run build passed |
| Production dependency audit | Zero vulnerabilities reported |
| Credential scanner / whitespace | Passed |
| Existing-database migration | SQLite order version backfill and subsequent update passed |
| Multiple independent processes | OTP state, realtime delivery and rate-limit counter passed against shared SQLite |

Chromium installation failed with a corrupt/truncated archive; Playwright was not run locally. No live nginx syntax validation, PostGIS database or VPS/bot verification was available. CI retains Playwright and the PostGIS service job; its smoke script now checks the new migration, version conflict, OTP, realtime and rate-limit SQL paths. Do not treat unexecuted CI checks as passed.

## Deployment and remaining architectural work

- Install the newly supplied provider credential as TELEGRAM_PROVIDER_BOT_TOKEN for @pomich_help_bot through the deployment's secret store, then verify bot identity and webhook/polling. No server secret access was available here. Do not copy the token into this report or a PR.
- Keep the existing POMICH_ENCRYPTION_KEY during deployment. SQL startup creates the new tables and migrates order versions; take the usual database backup before rollout. Old file-backed pending OTP codes are not imported and users may need a new code. Browser realtime clients hydrate current state after reconnect; the event log is not a durable message broker.
- Confirm trusted proxy IP resolution before relying on IP-based limits. Defaults are deliberately broad and should be tuned with operational traffic evidence.
- Polling introduces up to roughly 0.5 seconds delivery latency plus database work per subscription. External monitoring dashboards/alert rules and retention require deployment configuration. Anonymous crash counters are aggregate visibility, not source-map crash diagnostics.
- Deeper extraction of order lifecycle/matching/profile services, smaller controller hooks, test-module decomposition and removal of duplicate/obsolete CSS remain architectural debt. Those recommendations are not fully closed by moving pure rules/screens/schema. No destructive binary/history cleanup or speculative business-flow rewrite was performed.

This PR is ready for code review, not a claim that every optional architectural recommendation has been completed. Merge after required CI checks; this task does not authorize production rollout.
