# VPS03 canonical schema baseline

Status: local/native evidence recorded; no Supabase migration was applied.

## Scope

This baseline is for the synthetic Review Activator VPS only. It contains no
company, location, review, promo, Auth user, Yandex session, or scheduler row.
The existing VPS foundation remains loopback-only and business routes remain
disabled.

The baseline file is:

`supabase/migrations/20260912090000_review_activator_canonical_baseline.sql`

SHA-256 at this checkpoint:

`71aa35c22cb2aa99a39491b22de8f0f56d390dd53d6165223a8c61f15126176c`

It is applied before retained application migrations beginning at
`20260912095126_review_sync_server_boundary.sql`. It is a hand-authored
application schema contract, not a `pg_dump` and not the local-only fixture
`test/fixtures/db/review-sync-baseline.sql`.

## Design decisions

- Public application tables, private Yandex tables, constraints, indexes, RLS,
  function compatibility, and grants are created explicitly.
- `auth.users`, `auth.uid()` and `auth.jwt()` are minimal database compatibility
  objects only. There is no Supabase Auth server or Auth user bootstrap on VPS.
- `cron.job` is a migration-only compatibility table. No `pg_cron` extension,
  cron row, timer, worker, or business route is enabled.
- PostgreSQL 17 built-ins are used where available; historical `pgcrypto` and
  `uuid-ossp` extensions are not required by the VPS schema.
- Private session material remains behind RLS and server-only function paths.

## Native bootstrap evidence

Two independent clean databases, A and B, were created on the local native
PostgreSQL 17.11 cluster and applied the baseline plus the retained migration
chain through Recovery09 in chronological order. The normalized application
schema fingerprints were identical:

`77e288e5494551a2d51d6e2cda34500c|359`

Both databases had six application row-count checks equal to zero and were
destroyed after the checks. Native `server_version_num` was `170011`.

Privilege/RLS assertions on a third clean synthetic database passed for role
separation, RLS configuration, anonymous denial, private-schema denial,
recovery-history denial, and the expected service-role platform bypass. That
database was also destroyed after the test.

## Gate status

`DATABASE_SCHEMA_BOOTSTRAP = PASS`

`AUTH_PLATFORM_BOOTSTRAP = NOT_REPRODUCED`

`MINIMAL_BACKEND_READY = PARTIAL` — the database contract is reproducible, but
the Supabase Auth platform and managed scheduler are intentionally not
emulated by this VPS baseline.
