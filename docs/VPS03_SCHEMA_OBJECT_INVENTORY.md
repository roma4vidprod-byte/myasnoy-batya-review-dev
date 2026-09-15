# VPS03 schema object inventory

Source: read-only metadata from the Review Activator DEV Supabase project
`ykiubttldgyjpajmsuas`. No application rows or secret values were read.

## DEV inventory

| Object category | Count | Notes |
|---|---:|---|
| Application tables | 15 | 13 public, 2 `review_private` |
| Columns | 180 | names, types, nullability, defaults/generated metadata |
| Constraints | 75 | primary, unique, foreign-key and check contracts |
| Indexes | 32 | normalized definitions |
| Explicit policies | 2 | all application tables have RLS enabled |
| Non-internal triggers | 2 | normalized trigger definitions |
| Functions | 25 | signatures, owners, security, config and definitions |
| Extensions | 6 | includes managed `pg_cron`; not copied to VPS |

The private Yandex tables are force-RLS. The public application tables are RLS
enabled. The baseline preserves the scoped identities and provider boundaries;
it does not seed business rows.

## Dependency classification

- `auth.uid()` occurs in four functions and `review_admins.user_id` references
  `auth.users(id)`. These are Auth-platform dependencies, not evidence that a
  local PostgreSQL cluster can provide Supabase Auth.
- `cron.job` is referenced by the Recovery09A candidate and migration guards.
  It is retained as a compatibility object only; VPS scheduling is a future
  systemd/server-worker decision.
- No `pg_net`/`net.http` dependency was found. PostgREST/NOTIFY references are
  migration/platform integration points, not VPS business runtime enablement.
- There are no session cookies, encrypted envelopes, review rows, promo rows,
  or Auth users in the synthetic bootstrap.

## Evidence boundary

The inventory proves the DEV database contract and dependency surface. It does
not prove Supabase Auth behavior, managed pg_cron ownership, deployment
readiness, or production parity.
