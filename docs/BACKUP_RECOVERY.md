# POMICH PostgreSQL backup and restore

This procedure covers the production PostgreSQL/PostGIS database. It does not
cover separately stored files, server configuration, DNS, Telegram credentials
or repository secrets. Inventory those separately before claiming full disaster
recovery.

## Set up on the production host

1. Install `restic` and choose an off-server repository (for example, an S3
   compatible bucket). Create `/etc/pomich/backup.env` owned by root with mode
   `0600`. Set `RESTIC_REPOSITORY`, `RESTIC_PASSWORD_FILE`, and the storage
   provider credentials. Keep the restic password in a separate root-only file
   and preserve an offline copy; losing it makes backups unreadable. Set
   `POMICH_ENV_FILE` if the Compose environment file is not `/opt/pomich/.env.production`.
2. Initialize the remote repository once with `restic init`; verify access with
   `restic snapshots`. The backup script deliberately fails if off-site settings
   or repository access are missing.
3. If the checkout is `/opt/pomich`, install the units in `deploy/systemd/` into
   `/etc/systemd/system/`. Otherwise adjust `WorkingDirectory` and `ExecStart`.
   Run `systemctl daemon-reload && systemctl enable --now pomich-backup.timer`.
4. Run `systemctl start pomich-backup.service` once, inspect its exit status and
   `restic snapshots --tag pomich-postgres`. Do not interpret timer installation
   alone as a successful backup.

The script creates a custom-format `pg_dump` with restrictive permissions,
checks its archive table of contents, writes SHA-256 alongside it, and uploads
both to the encrypted remote repository. Local copies older than seven days are
removed only after a successful remote upload. Configure remote retention
separately after the restore drill; do not use a lifecycle policy that deletes
restic repository objects independently.

## Restore drill (at least monthly)

Restore both the `.dump` and `.dump.sha256` from a selected restic snapshot to a
protected temporary directory. Then run:

```bash
scripts/ops/verify_postgres_backup.sh /protected/path/pomich-TIMESTAMP.dump
```

The script checks SHA-256, starts an isolated disposable PostGIS container,
restores the archive with `pg_restore --exit-on-error`, verifies that public
tables exist and removes the container. Record the snapshot date, result,
elapsed time, and restore operator. Never restore directly over production as
a test.

Initial objective: daily backup (up to 24 hours of data at risk) and a tested
restore within four hours. These are *targets*, not achieved RPO/RTO or an SLA;
measure the actual schedule and drill times before publishing them.
