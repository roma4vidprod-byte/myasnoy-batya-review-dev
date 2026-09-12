# Yandex Persistence Idempotency Fix 05A

## Status

The replay anomaly was isolated and fixed in a new DEV-only migration. The
previous replay's 67 updates were caused only by `observed_at`; no identity,
scope, owner-reply or local workflow fields were reassigned.

## Semantics

`observed_at` is observation metadata, not provider business data.

The atomic writer now:

* excludes `observed_at` from provider-data equality;
* performs no UPDATE when only `observed_at` differs;
* updates `observed_at` only when another allowed provider-owned field changes;
* preserves `reply_state`, `owner_reply_external_id` and other local/admin fields.

Expected replay result:

`inserted=0 / updated=0 / unchanged=67`.

Scoped identity and constraints are unchanged.

The migration is:

`supabase/migrations/20260913100000_yandex_persistence_idempotency_05a.sql`

It is applied only to Review Activator DEV as migration
`20260912195230_yandex_persistence_idempotency_05a`.

The controlled DB-side replay used the existing 67 normalized rows as the batch
source; no new Yandex request was made and no raw payload was printed. Result:

`inserted=0 / updated=0 / unchanged=67`.

Post-replay DEV checks remain: 67 scoped rows, 67 unique IDs, 54 owner replies,
zero null scopes, zero scoped duplicates, all 67 local reply states preserved,
session `READY` revision 6, scheduler `PAUSED`.

Verification before DEV apply: full suite **299/299 PASS**, checks **81/81 PASS**,
and `git diff --check` PASS.
