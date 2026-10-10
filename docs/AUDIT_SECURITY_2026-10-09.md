# Security audit follow-up — 2026-10-09

Source: complex UX/security/architecture audit against `main` @ `52742b7`.

## Closed in this change

| ID | Priority | Result |
| --- | --- | --- |
| F01 | P0 | Customer `POST /orders` strips client `id` and other lifecycle fields, mints a server id, and uses INSERT-only persistence. SQL upsert refuses ownership takeover. |
| F02 | P1 | Create always sets `status=searching`; source cannot skip validation. Service details, finite Ukraine coordinates and tow destination checks apply to every customer create. |
| F03 | P1 | Invalid `POMICH_ENCRYPTION_KEY` raises at encrypt time; production startup rejects non-Fernet keys. |

Regression coverage: `tests/test_order_create_authorization.py`, SQL owner-takeover case in `tests/test_runtime_store.py`, and Fernet fail-closed cases in `tests/test_field_encryption.py`.

## Still open (not in this change)

F04 session revoke, F05–F06 realtime tokens/expiry, F07 Python SCA gate, F08 branch protection, F09 deploy readiness/DB gate, F10 CSS probe, F11–F12 durable queues/bus, F13–F15 DTO/module/migration ops, F16 full E2E journeys, F17–F21 hardening/privacy/CSP/idempotency.
