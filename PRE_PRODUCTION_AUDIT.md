# POMICH Pre-Production Audit

## Scope
This audit reviewed the current POMICH MVP as a React/Vite roadside-assistance client backed by FastAPI, Telegram, a JSON dev adapter, and SQL/PostGIS-ready runtime storage. The focus was on correctness, resilience, privacy, runtime safety, and state handling rather than on introducing new product features.

## What was hardened
- Added a deterministic domain layer for pricing, ETA, distance, validation, sanitization, and duplicate-request fingerprinting in [src/lib/pomichDomain.ts](src/lib/pomichDomain.ts).
- Added regression tests covering pricing, validation failures, state transitions, privacy masking, and request fingerprinting in [src/lib/pomichDomain.test.ts](src/lib/pomichDomain.test.ts).
- Connected the UI to the domain rules so price and ETA are calculated from shared logic instead of hard-coded values.
- Added a safer flow guard for invalid order submission and a privacy-safe display of sanitized addresses.
- Improved the phone-frame layout so the experience remains usable on narrower screens.
- Added configurable API CORS origins through `POMICH_CORS_ORIGINS`.
- Replaced optional provider endpoint protection with mandatory backend provider sessions issued from `POMICH_PROVIDER_TOKEN`.
- Restricted provider/admin bootstrap shared-secret headers to session issuance only; operational routes now require bearer sessions.
- Updated Web provider/admin flows to exchange bootstrap tokens for signed sessions, remove those bootstrap tokens from the URL, and use bearer auth for operational calls.
- Reduced Docker build-context risk by excluding local secrets, runtime data, logs, and caches from the image context.
- Updated Vite config for future native config-loader compatibility.

## Findings
### 1. Strengths
- The app now has explicit business rules rather than ad-hoc display values.
- Key edge cases such as empty location fields, unrealistic distances, and duplicate requests are handled in a deterministic way.
- Regression tests provide safety against regressions in the core order logic.

### 2. Remaining gaps for true production readiness
The current repository now includes a backend-backed MVP, but it still needs production-grade replacements or hardening for:
- Managed Postgres/PostGIS hosting, backups, point-in-time recovery, and audit retention.
- Full identity binding between Telegram users, provider accounts, and admin operators.
- Account-level provider/admin login instead of bootstrap token session issuance.
- Real-time provider/order updates instead of polling-heavy UI refreshes.
- Operational monitoring, rate limiting, and incident handling.

## Recommendation
The current MVP is now materially stronger for a demo or pre-production review, but it should still be treated as a polished pilot rather than a fully production-ready dispatch platform. If the next step is full readiness, the next milestone should be durable storage, account-level identity, and operational observability.
