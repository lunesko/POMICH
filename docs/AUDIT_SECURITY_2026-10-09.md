# Security audit follow-up — 2026-10-09

Source: complex UX/security/architecture audit against `main` @ `52742b7`.

## Closed in this change

| ID | Priority | Result |
| --- | --- | --- |
| F01 | P0 | Customer `POST /orders` strips client `id` and other lifecycle fields, mints a server id, and uses INSERT-only persistence. SQL upsert refuses ownership takeover. |
| F02 | P1 | Create always sets `status=searching`; source cannot skip validation. Service details, finite Ukraine coordinates and tow destination checks apply to every customer create. |
| F03 | P1 | Invalid `POMICH_ENCRYPTION_KEY` raises at encrypt time; production startup rejects non-Fernet keys. |
| F04 | P1 | Logout revokes session families (`sid`) for browser cookies and bearer; subsequent API calls return `session_revoked`. |
| F05 | P1 | EventSource/WebSocket URLs use short-lived `/auth/realtime/ticket` tokens instead of long-lived bearer; nginx access logs disabled for `/api/events/` and `/api/ws/`. |
| F06 | P1 | SSE/WS streams close when the session is revoked or the stream deadline expires (`session.expired` / WS 4401). |
| F07 | P2 | CI runs `pip-audit -r requirements.txt --strict` alongside npm audit. |
| F09 | P2 | Deploy gates require `/internal/ready` (DB) plus frontend `dist/assets` before declaring success. |

Regression coverage: `tests/test_order_create_authorization.py`, `tests/test_auth_sessions.py`, SQL owner-takeover case in `tests/test_runtime_store.py`, Fernet fail-closed cases in `tests/test_field_encryption.py`, and realtime ticket assertions in `src/lib/realtime.test.ts`.

## Still open (not in this change)

F08 branch protection, F10 CSS probe, F11–F12 durable queues/bus, F13–F15 DTO/module/migration ops, F16 full E2E journeys, F17–F21 hardening/privacy/CSP/idempotency.
