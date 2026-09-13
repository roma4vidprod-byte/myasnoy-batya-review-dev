# Yandex Hourly Sync 07 — DEV automation

This checkpoint wires the existing Review Activator DEV queue to one server-only
worker for the synthetic Asbest scope:

- company: `13f3cb80-487a-4a19-96a1-fb3103200230`;
- location: `9a95f63b-18e6-447b-a449-8530b67ddbae`;
- Yandex organization: `54309413522`;
- account label: `myasnoibatya-zakaz`;
- page base: `1`.

## Runtime path

`review_enqueue_due_syncs(uuid)` is still the existing scoped enqueue engine.
It now queues only a Yandex connection whose config names the exact location and
organization and whose private session is `READY`. Reauthentication errors may be
re-queued only after the private session returns to `READY`; contract and database
errors remain fail-closed.

Migration `20260913160000_yandex_enqueue_rpc_07a1_ambiguity_fix.sql` preserves this
contract while explicitly qualifying connection/session columns and using
`v_location_id`; this prevents PostgreSQL `42702` name-resolution failures in the
DEV enqueue path.

`review_claim_next_sync_run(uuid)` claims one queued run with `FOR UPDATE SKIP
LOCKED`. The worker then reuses the existing Session Transport, YandexProvider,
normalizer, scoped atomic writer and alert deduplication. It completes through
`review_complete_sync_run` or closes the run through `review_fail_sync_run`.

The worker is available at the server-only `POST /api/internal/review-sync-worker`
boundary. It requires the server-only `REVIEW_WORKER_SECRET`, fixed Asbest scope,
and `YANDEX_LIVE_READ_APPROVAL=asbest-read-only-v1`. It returns only safe counts
and fixed error codes. Browser code cannot call it with a service credential.

For DEV-only runtime diagnosis, the existing worker endpoint accepts the strict JSON
body `{"diagnostic_only":true}` with the same worker secret. This branch only reads
the scoped encrypted session and returns key fingerprints, envelope metadata and
decrypt status; it never returns cookies, envelopes, key material or performs a
Yandex request. The normal worker path is unchanged for all other bodies.

## Scheduler gate

The existing `review-provider-due-check-hourly` job remains paused until the worker
runtime is deployed, its server-only environment is verified, one controlled worker
cycle returns `0 inserts / 0 updates / 67 unchanged`, and the job command is updated
to an explicitly scoped target. No Vercel cron is used. No Yandex write, reply,
matching or promo operation is part of this checkpoint.
