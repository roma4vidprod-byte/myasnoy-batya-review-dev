# VPS03 Recovery09 / Recovery09A classification

## Recovery09

Classification: `MIGRATION_COMPAT_ONLY`.

Recovery09 applied successfully in both clean native bootstrap databases and
its immutable recovery-history contract was included in the normalized schema
comparison. No recovery operation, real session, remote migration, or row was
executed. The migration remains part of the application schema history, not a
claim that VPS can recover a live Supabase session.

## Recovery09A

Classification: `MIGRATION_COMPAT_ONLY` for schema compatibility and
`BLOCKED` for VPS runtime use.

The candidate is an owner-only installation proposal, not a normal application
migration. The native VPS probe returned the allowlisted fail-closed code
`RECOVERY09A_BASELINE_MISMATCH`; the helper was absent afterwards. The VPS has
no genuine managed `cron.job` owner or pg_cron runtime, so installing the
proposal as `postgres`, by `SET ROLE`, or by granting application privileges
would violate its contract.

No provider supportability claim is made. A future use requires explicit owner
approval and a separately verified managed scheduler capability.
