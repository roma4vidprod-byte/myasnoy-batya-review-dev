# VPS03 scheduler compatibility

The DEV project has a managed `pg_cron` dependency, but the VPS foundation is
deliberately not a managed Supabase scheduler. The canonical baseline therefore
does not install or enable `pg_cron`, does not create a due-check row, and does
not start a worker or timer.

It creates only a migration-compatible `cron.job` table so retained migration
references remain explicit and auditable. This table is empty in the synthetic
baseline and is not a scheduler implementation.

The VPS foundation remains `127.0.0.1:13000`, with business routes and timers
disabled. A future scheduler must be a separately approved systemd/server-worker
transport with server-only credentials and the existing queue/claim boundary.

## Recovery09A

Recovery09A is owner-gated. Its helper requires the genuine `cron.job` owner,
managed scheduler semantics, and an owner-installed capability. The native
probe on the VPS candidate failed closed with:

`RECOVERY09A_BASELINE_MISMATCH`

No helper was created. Therefore Recovery09A is
`MIGRATION_COMPAT_ONLY` for this VPS schema and `BLOCKED` as a runtime scheduler
capability. It is not a reason to grant the application roles direct cron-table
write access.
