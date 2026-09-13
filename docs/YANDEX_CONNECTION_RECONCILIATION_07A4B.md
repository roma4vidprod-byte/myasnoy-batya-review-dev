# Yandex connection state reconciliation 07A.4B

Status: DEV-only reconciliation prepared for the fixed Asbest Review Activator
scope. It does not run Yandex transport, enqueue a run, create queue metadata or
change the scheduler.

## Root cause

The Asbest connection had `status=ERROR` and the stale
`last_error=SESSION_DECRYPT_FAILED`, while the private Yandex session was already
`READY` at revision 10. The existing enqueue function intentionally does not
queue arbitrary provider errors; its ERROR requeue allowlist contains only
reauthentication codes. It therefore created `SKIPPED_NOT_CONFIGURED` metadata
and returned `0`.

## Reconciliation boundary

Migration `20260913200000_yandex_connection_state_reconciliation_07a4b.sql`
adds the single existing server-side RPC boundary:

`review_reconcile_yandex_connection(uuid, uuid, text)`

It is `SECURITY INVOKER`, fixed to the DEV Asbest company/location and Yandex
organization, and executable only by `service_role`/`postgres`. It requires an
enabled Yandex connection and a matching private session in `READY`. Only the
stale `ERROR / SESSION_DECRYPT_FAILED` state is changed to `READY` with
`last_error=null`.

The reconciliation does not modify `next_sync_at`, last-success timestamps,
session/envelope/keyring data, queue/run tables, reviews or scheduler state.
Repeated reconciliation is a no-op after the first successful change.

The protected existing worker route accepts the strict body
`{"operation":"reconcile_connection"}` and uses the fixed scope. It requires
`REVIEW_WORKER_SECRET`; browser/anonymous/authenticated callers cannot reach the
service-role RPC.

## DEV verification

The applied DEV audit showed:

- provider connection scope and organization matched;
- session `READY`, revision `10`;
- connection `ERROR / SESSION_DECRYPT_FAILED`;
- no queued/running run;
- 67 reviews and 67 unique IDs;
- `review-provider-due-check-hourly` remained `PAUSED`;
- the connection was not due after the previous enqueue attempt because that
  attempt advanced `next_sync_at` to the next 60-minute boundary.

Reconciliation must be followed by a read-only audit. If `due_now=false`, the
next due timestamp is reported and no enqueue is performed in this checkpoint.
