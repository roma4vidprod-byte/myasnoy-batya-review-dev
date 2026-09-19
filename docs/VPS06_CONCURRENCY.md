# VPS06 — native concurrency and atomicity

One backend/transaction holds `pg_try_advisory_xact_lock(1380013908,6)`. The key is a fixed Review Activator namespace and VPS06 task ID, not a hash of user input. It serializes this synthetic company worker. A second worker gets false without waiting, rolls back, exits0 `ALREADY_RUNNING`, and never enqueues/claims/processes work. There is no filesystem lock in this business path.

The transaction spans enqueue, claim, synthetic processing and completion/failure. A process crash cannot commit a partial claim. Disconnect rolls back state and releases the transaction lock. PostgreSQL restart also discards backend locks and rolls back unfinished transactions; **the live DB was not restarted** to test this. Native backend/process termination tests cover disconnect behavior. PostgreSQL documents transaction-level advisory lock release at transaction end in [Explicit Locking](https://www.postgresql.org/docs/17/explicit-locking.html).

This long transaction is deliberately bounded and suitable only for synthetic work (0–8s controlled delay). Do not extend it to remote providers as an implicit future design decision. A real provider worker needs a separately reviewed lease/transaction boundary and explicit authorization.

## Actual native evidence

- Two independent PG backends: first claim true; second claim false through existing `FOR UPDATE SKIP LOCKED`. First rollback restores QUEUED.
- Worker A holds a real granted `ExclusiveLock`; lock PID/classid/objid observations are saved. Worker B in a second systemd unit returns ALREADY_RUNNING; exactly one successful run remains.
- Three queued jobs require three invocations. A fourth is empty. No loop drains the queue.
- Due connection with an existing queued job: two enqueue attempts both0, one queue row, next_sync_at unchanged.
- Duplicate complete and duplicate fail are rejected; complete/fail on stale/foreign/null scope cannot mutate a run.
- SIGTERM, SIGKILL and systemd timeout: zero completed work, queued fixture restored, no RUNNING run, lock immediately acquirable afterward.
- Claim/complete permission-failure injection: entire transaction rolls back, no fail RPC attempted inside an aborted transaction, no automatic retry. Temporary test revocations were restored.

`docs/evidence/vps06/VPS06_CONCURRENCY.json` contains real PG17 results, not PGlite simulations. The successful run used PostgreSQL `170011`. No DB restart/reboot, cloud SQL or real review processing.

## Ambiguous commit

A lost response during COMMIT is an operational failure with stage COMMIT, not proof that the DB rolled back. Do not retry automatically. Inspect scoped run state read-only first. The worker does not translate an unknown commit result into claimed success or zero mutations.
