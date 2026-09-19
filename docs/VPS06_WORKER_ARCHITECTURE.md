# VPS06 — autonomous synthetic worker

Acceptance date: 2026-09-19. Starting commit `fd44c0d5e3c721c739e16a4a252cae39d1f2d164`, branch `codex/yandex-live-read-smoke-01`. VPS `hiplet-120706`, database `review_activator_lab`, PostgreSQL 17.11. This is a NO-PROVIDERS lab capability, not permission or readiness for live sync.

## Dependency map

| Boundary | Decision | Actual implementation |
| --- | --- | --- |
| ENQUEUE | ADAPT | Same `public.review_enqueue_due_syncs(uuid)`, LAB-only synthetic eligibility; existing connection/run tables, due time, interval and active-job dedupe |
| CLAIM | REUSE | `review_claim_next_sync_run(uuid)`, original function body unchanged |
| PROCESS | ADAPT | Provider-neutral lifecycle extracted from existing worker into `lib/server/single-sync-run.js`; `processSynthetic` performs no review writes or I/O |
| COMPLETE | REUSE | Existing `review_complete_sync_run(uuid,uuid,jsonb)`, unchanged |
| FAIL | REUSE | Existing NULL-safe `review_fail_sync_run(uuid,uuid,text)`, unchanged |
| LOCK | ADAPT | Native transaction advisory lock, one fixed application namespace/task pair; no filesystem business lock |
| PROVIDER | NOT_USED_ON_VPS | No Yandex transport/service/parser/session module in installed dependency graph; no 2GIS, keys or sessions |
| NOTIFICATION | NOT_USED_ON_VPS | No Telegram/Resend/email/AI/promo module imported |
| Cloud HTTP cron/worker routes | NOT_USED_ON_VPS | Existing API contracts unchanged, no requests/deployments to Cloud |
| PostgREST | NOT_USED_ON_VPS for worker | Direct fixed local Unix-socket PostgreSQL peer auth; existing API/Auth services remain intact |

The old worker now calls the shared lifecycle with its original scope, validator, service and result mapping. The VPS worker calls that same lifecycle with an explicit synthetic processor and the same DB RPCs. No second queue, writer, review engine or delivery engine is added. The Cloud completion-failure behavior is preserved; the native adapter selects rollback when SQL aborts a transaction.

## Single invocation

`tools/vps06/once.mjs --once` → strict `RA_RUNTIME_PROFILE=vps-lab` and `RA_WORKER_PROVIDER=synthetic-vps06` → DB name/peer role/PG17/schema-version readiness → BEGIN → try advisory lock → validate visible synthetic connection → existing enqueue RPC → claim at most one → synthetic operation → complete/fail once → COMMIT → close backend → exit. Empty and ALREADY_RUNNING exit0; processing/infrastructure/guard failures exit1. No daemon loop or automatic retry.

The fixed synthetic company/location/connection UUIDs start `60000000` / `61000000` / `62000000`, ending `000000000006`; org `vps06-synthetic-org`, account `vps06-synthetic`. They are unrelated to Asbest. Existing queue schema only permits `yandex`/`2gis`; `yandex` is retained solely as a DB compatibility tag. It never selects a transport. Removing/misconfiguring synthetic mode refuses execution before connecting. Runtime has no fallback to a real provider.

Native `psql` is a persistent child, not a shell string. Fixed Unix socket, port5432, DB and peer user; sanitized environment; parameter validation; SQL response framing; raw SQL errors discarded. No npm runtime dependencies or passwords. The role has no superuser/bypass/create-role/create-DB/inheritance powers. RLS limits it to the one synthetic connection and its runs. Column grants prevent it changing provider config. Reviews, auth, sessions and cron writes are denied in actual native tests.

## LAB installation scope

`tools/vps06/lab-worker.sql` is an explicit host-guarded LAB install, **not** a Supabase migration. It adds the peer role/policies/grants and adapts the already existing enqueue function only in this LAB. The original enqueue definition is retained root-only in `/var/lib/review-activator-ops/vps06/enqueue-before.sql`. Claim/complete/fail body hashes match before/after. Historical migrations are untouched.

Acceptance fixture writes deliberately create/delete only the VPS06 company/location/connection/runs. They are not arbitrary writes bypassing the normal worker lifecycle. Final fixture count is zero. All pre-existing LAB table counts/digests, including three Auth users and two reviews, match the pre-install snapshot.

Recovery09 = MIGRATION_COMPAT_ONLY. Recovery09A schema = MIGRATION_COMPAT_ONLY; scheduler runtime = BLOCKED/SUPERSEDED by this systemd + native advisory-lock architecture. No Recovery09A helper, pg_cron runtime, owner-helper or Cloud permission was activated. This supersedes the runtime scheduling design only, not historical migration validation or unrelated unresolved tests.
