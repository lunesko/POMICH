# Customer failure recovery

## Behavior

- No eligible partners: show the actual search state, elapsed minutes, retry on the same order, cancellation and support. Do not claim a dispatcher is working on a case unless there is an assigned operator.
- Unreachable assigned partner: expose heartbeat/GPS timestamps and the freshness flag. Treat an unknown/offline/older-than-60-second fix as unavailable. Hide stale ETA and live movement. The customer may contact the partner, report a problem, or explicitly cancel and review a replacement request. A failed cancellation never starts the replacement.
- Manual pickup: persist the manual source in the draft. Ignore passive GPS, Telegram location hydration and late callbacks until an explicit location refresh.
- Network failure: retain the order ID/status. Retry restoration and polling on reconnect. A server-confirmed terminal state ends the active order; a transport failure does not. Display last successful synchronization time.
- ETA: the customer flow uses OSRM road duration with a range, independently of the API's labeled straight-line estimate. Requests are keyed by order, partner, ~100m position cell, pickup and minute. Ignore superseded responses; hide estimates if GPS or route data ages. Road duration does not incorporate live traffic. Notify in the open application if a refreshed arrival estimate moves back by more than five minutes.
- Help not received: support is available in the active/terminal ride sheet and customer history, including cancelled orders. The cancelled customer screen no longer disappears while the customer is reporting a problem.

## Support workflow

Authenticated customer owner:

- `GET /api/orders/{order_id}/support`
- `POST /api/orders/{order_id}/support` with `reason` (`no_partner`, `partner_unreachable`, `help_not_received`, `other`) and `description` (5–2000 nonblank characters).

Authenticated administrator:

- `GET /api/admin/support`
- `PATCH /api/admin/support/{case_id}` with `status` (`open`, `in_review`, `resolved`) and `resolution`. Resolving requires at least five nonblank characters.

One case per order makes submission retries idempotent, including concurrent SQL workers. Cases are stored separately so order polling/status updates cannot overwrite them. Customers see the status and response in the same view; administrators use the new Support section. The admin list shows the newest 200 cases. There are no external operator notifications or response-time guarantees. Telegram `/support` directs customers to this workflow instead of asking them to send unhandled free text.

SQL cases are included in the customer's export and removed alongside their order during retention/erasure. The JSON fallback uses `support_cases.json` beside the order store, or `POMICH_SUPPORT_STORE_PATH`.

## Deployment and rollback

Run the existing `python -m bot.migrate` release step before starting the new application. It registers and creates the additive `support_cases` table and indexes. Existing production deploy scripts already run this command. No destructive schema changes are needed; rollback may leave the new table in place.

## Validation

Regression coverage includes network failure/reconnect, manual pickup against late GPS responses and watch callbacks, cancellation failure before replacement, road ETA and GPS aging, support ownership/admin authorization, retry idempotency (including concurrent SQL submissions), resolution visibility, export and retention. Browser verification remains required: the current environment could not download a valid Chromium archive.
