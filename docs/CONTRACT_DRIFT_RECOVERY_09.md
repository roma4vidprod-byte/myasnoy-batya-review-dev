# SCOPED CONTRACT-DRIFT RECOVERY — administrative candidate 09

## Status and source

Prepared locally on 14 September 2026. NOT DEPLOYED, NOT APPLIED, NOT A NEW LIVE DIAGNOSTIC.
The base is the exact 166-file integrated patch already accepted on Windows by the user as commit
`c47b83b179b9a94781d55029b4b399c44f9a075b`. That Git object is not present in this workspace;
base file SHA-256 checks against the previously delivered manifest are the evidence of content identity.
Do not replace the user's Git repository, `.env` or `.vercel` directory.

Last accepted diagnostic (user report, not re-executed here): revision 13, 4/4 requests/pages,
69 received/69 unique/total 69, full completeness PASS, no mutations.
Last successful remote metadata read: 2026-09-14T14:54:12.149459Z, session READY/revision 13,
connection ERROR/YANDEX_CONTRACT_DRIFT. This is historical evidence, not current metadata.
A new read-only Supabase query in this task was blocked by the tool's safety check. It was not
retried through another path; no fresh remote state or remote mutation is claimed.

## Minimal approach — no new web endpoint or Vercel deployment

Add only the private administrative function
`review_private.recover_yandex_contract_connection(...)` and its small private audit table.
This is an administrative transition on the EXISTING connection, not a second review engine,
provider, queue, scheduler or parser. The original three-argument
`public.review_reconcile_yandex_connection` remains byte-for-byte unchanged and continues to
reject CONTRACT_DRIFT. Normal recovery of decrypt errors keeps its existing contract.

The new function is SECURITY INVOKER, has an empty search_path, and is available only to
`postgres`. PUBLIC, anon, authenticated and service_role receive NO EXECUTE capability.
The old REVIEW_WORKER_SECRET therefore cannot invoke the new administrative operation.
No function is added to the HTTP handler or public API. Do not solve a denied admin call by
broadening grants, switching accounts, disabling RLS or inventing an HTTP operation.

## Evidence is operator-attested, not provider-signed

The read-only diagnostic intentionally did not persist a receipt or cryptographic signature.
Therefore it is impossible to retroactively assert a server-signed receipt exists.
The operator reviews the exact saved result and its hash, verifies the source/deployment/scope
binding, and explicitly authorizes its use. The function accepts a strictly shaped attestation
only from postgres. It verifies the internal shape, revision/scope binding and arithmetic of
that attestation; it does NOT independently re-fetch Yandex or authenticate the origin of a
caller-provided hash. The audit labels this OPERATOR_ATTESTED_FULL_DIAGNOSTIC.

Never replace this trust boundary with an application request containing `full_pass=true`.
Never claim that a SHA format check proves actual artifact contents. Verify the saved artifact
SHA-256 outside SQL before invocation and retain it with the authorization.
There is no invented provider timestamp: the existing follow-up observation time is not the
exact timestamp of each provider response.

A recovery request receives a frozen UUID and an explicit expiry, at most one hour into the
future. This is the lifetime of the newly authorized administrative attempt, NOT a declaration
that cookies will remain valid for an hour. Re-check approval after lock waits. Do not renew
expiry implicitly on retry. Future worker reads still must validate cookie expiry and state.

## Preconditions and ordering

1. Independently establish the exact Review Activator DEV project and authorized postgres
   context. The SQL routine cannot identify Supabase project_ref from database name `postgres`.
   Production and all other projects remain forbidden.
2. Verify exact connection ID/company/location/org, expected connection.updated_at and
   session READY + expected record revision; verify material exists without reading its values.
   An actual state change requires fresh scope/version metadata immediately before execution.
3. Scheduler remains paused, and no QUEUED/RUNNING run exists for the connection.
4. The diagnostic belongs to this scope, revision, accepted source/deployment and full result.
   Old successful evidence does not authorize suppressing a newer error/version.
5. Lock order: request-scoped transaction advisory lock -> scheduler row SHARE -> connection
   FOR UPDATE -> session FOR SHARE. The connection expected-state predicate is rechecked.
   Existing queue insertion uses the connection FK; existing enqueue first locks connection.
   Native concurrent behavior must be tested before applying remotely.
6. Require precisely enabled=true, ERROR + YANDEX_CONTRACT_DRIFT, unchanged connection version.
   Changed revision/version, different error, PAUSED/DISABLED, wrong scope or active run => reject.
7. Update only connection.status, last_error and updated_at. Insert exactly one private audit.
   Audit insertion failure or a suppressed insertion aborts the entire statement/transaction.
8. Session fields/envelope/revision, all sync timestamps, next_sync_at, enabled/interval, reviews,
   old runs, queue and scheduler are unchanged. No external HTTP or notifications are involved.
9. Same UUID + identical arguments returns ALREADY_APPLIED with changed=false; no new audit.
   This is a recorded historical outcome, not a fresh assertion that current status is READY.
   Same UUID with different evidence/scope/expiry is rejected. A new UUID cannot overwrite the
   now-changed connection version. Do not issue a new UUID after an ambiguous response.
10. Preserve failed runs. The new audit is append-only (UPDATE/DELETE/TRUNCATE blocked by triggers and
    no application privileges; only postgres SELECT/INSERT RLS policies). A privileged owner could still disable/drop schema protections;
    this mechanism is not protection against a malicious database owner.

## Migration and rollback

Candidate: `20260914210000_yandex_contract_recovery_admin_09.sql`.
DDL alone changes no business rows. Existing table/function/RPC contracts remain unchanged.
It is independent of the still-pending NULL-guard 08 migration. Do not apply the entire folder:
the archive does not contain the complete original migration history, and historical remote
versions differ from some local filenames. Do not use migration repair/db push automatically.
Use the approved migration tool only after baseline/schema/ACL/trigger preflight.
Migration requires postgres and existing session/connection/run tables; an unexpected same-name
history table fails closed. Tests cover clean application and repeat application, not arbitrary
migration-ledger divergence. Do not silently rewrite existing recovery/audit objects.

No remote migration or recovery is authorized just by applying this local patch.
Before release run the native PostgreSQL 17 concurrency gate described below, and obtain the
separate explicit authorization for DDL + one guarded recovery + safe post-read.
On failure do not delete audit or reset connection to an assumed old value. Fix-forward or a
separately approved compensating action must consider all newer state.

## Native PostgreSQL gate (not PGlite simulation)

The installed PGlite 0.5.8 identifies itself as PostgreSQL 18.3 WASM, single connection.
It executes the real SQL for input guards, atomic rollback and privileges, but cannot prove
multi-session locks on the actual PostgreSQL 17 server. Do not relabel serial tests concurrency.

A prepared runner creates ONLY a new disposable, Unix-socket-only cluster:

```
python3 tools/contract-recovery/native-concurrency.py \
  --pg-bin /path/to/postgresql17/bin \
  --report /tmp/review-native-concurrency.json
```

It accepts no DSN/remote host/existing DB; it refuses non-17 versions. It initializes its own
cluster, runs six concurrent scenarios, shuts it down and removes only its temporary directory.
Use an isolated Linux/WSL/container with official native PostgreSQL 17 binaries, never Supabase.
The six scenarios are: two identical requests; concurrent newer connection error; concurrent
session replacement; session lock held by successful recovery; concurrent queued insert through
FK; approval expires during lock wait. Blocking is observed through pg_stat_activity rather
than assumed from sleep (a deliberate wait is used only for the expiry case).

In the assistant environment initdb/pg_ctl/psql are absent. Attempt to obtain system packages
failed due to DNS resolution. The native runner was syntax-checked but did not execute these
scenarios. This is a concrete remaining gate, not a reason to rebuild the implementation.

## Server operation after separate approval — no executable defaults

Use one READ COMMITTED transaction, `SET LOCAL lock_timeout='5s'`,
`SET LOCAL statement_timeout='30s'`, and the private function with bound parameters.
Do not hold a transaction open across separate tool calls. Read-only preflight is separate.
A draft evidence/parameter plan is delivered outside the repository, with request ID and expiry
unset; it is not executable authorization. Resolve fresh exact metadata, artifact/source binding
and approval before filling those fields. Never silently substitute the current revision or
version when the expected one differs. A changed expectation requires renewed review.

Allowed effects after approval: one connection transition, one private audit insert.
No Yandex request, session import/health, new deployment, env/key, review write, enqueue/worker,
notifications, scheduler or other project. Read after the operation; unknown result => no retry,
read the immutable receipt and current metadata. No recovery from a failed live transport here.

## Public sources used to check SQL assumptions

PostgreSQL 17 Explicit Locking: https://www.postgresql.org/docs/17/explicit-locking.html
PostgreSQL 17 CREATE FUNCTION: https://www.postgresql.org/docs/17/sql-createfunction.html
PostgreSQL 17 Transaction Isolation: https://www.postgresql.org/docs/17/transaction-iso.html
PGlite architecture: https://pglite.dev/docs/
These documents do not prove the project's deployed config; current remote preflight remains required.

QUALITY GATE / REGRESSION HARNESS is a separate future block, not enabled by this change.
