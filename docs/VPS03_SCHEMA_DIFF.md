# VPS03 schema comparison

Comparison basis: read-only DEV catalog metadata versus two clean native
PostgreSQL 17.11 synthetic bootstraps. No application rows were compared.

## PASS categories

The normalized A/B application fingerprint was identical. The following DEV
contract categories matched after the canonical baseline corrections:

- tables and columns;
- primary/unique/foreign-key/check constraints;
- application indexes, including the unique lower-email admin index;
- RLS flags and force-RLS for private Yandex tables;
- explicit policies and non-internal triggers;
- retained application function signatures and security attributes where the
  migration history is authoritative.

## Expected VPS/cloud differences

- DEV has managed extensions (`pg_cron`, `pg_stat_statements`, `pgcrypto`,
  `plpgsql`, `supabase_vault`, `uuid-ossp`); VPS uses PostgreSQL 17 built-ins and
  does not install managed extensions.
- Schema ACLs differ because Supabase platform roles and PostgREST are not a
  local VPS platform. The baseline grants only the compatibility schema usage
  required by the retained contract.
- Recovery09A is not in the retained VPS runtime chain; its owner-gated helper
  is intentionally absent.

## Migration-history drift retained explicitly

The DEV function definition/security hashes expose two historical drifts which
are not silently rewritten by the baseline: `review_fail_sync_run` differs from
the retained migration-08 body, and `review_admin_reviews_scoped` has a DEV
service-role ACL not reproduced by the old migration chain. These are classified
as `MIGRATION_HISTORY_DRIFT`, not unexplained schema drift. No application
semantics were changed in this stage.

No `UNKNOWN` difference is being promoted to PASS; any future catalog change
requires a new metadata comparison.
