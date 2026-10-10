# Operational monitoring

`GET /internal/metrics` is intended for a private monitor and requires
`X-POMICH-Internal-Token` in production. Do not expose this route through the public nginx
location. Configure `POMICH_INTERNAL_TOKEN` as a secret and run every minute:

```bash
POMICH_INTERNAL_TOKEN=... python3 scripts/check_internal_metrics.py
```

The check exits 1 for an application alert and 2 when metrics cannot be read. Alert on either:

- `telegramDeadLetters`: one or more notifications exhausted all eight attempts;
- `telegramPendingStale`: the oldest deliverable notification is over ten minutes old;
- `realtimeBrokerUnavailable`: the PostgreSQL listener is configured but disconnected;
- either `*MetricsUnavailable`: the application could not calculate that subsystem's state.

For a dead letter, inspect application logs by job ID and the referenced order state, correct the
underlying Telegram/configuration failure, then deliberately reschedule the notification. Do not
blindly replay all rows because delivery is at-least-once and a recipient may already have received
the message. For a broker alert, verify PostgreSQL connectivity and LISTEN permissions; clients
continue polling HTTP while the broker recovers.

Also alert independently on `/api/internal/ready` returning non-200, container restarts, backup
service failure, and missing daily restic snapshots. Keep metric tokens and full logs out of alert
messages. The repository supplies the signals and exit-code probe; connecting them to the chosen
monitoring/paging service remains an operator deployment step.
