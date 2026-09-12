# Review Activator — Sync Boundary Remediation 02

This is the Remediation 02 historical boundary audit. Its pre-04 persistence
section is superseded by [Yandex Scoped Persistence + Atomic Writer 04](YANDEX_SCOPED_PERSISTENCE_04.md):
the DEV global review identity index was later replaced by the scoped identity
and server-only atomic writer. The scheduler remains PAUSED.

Date: 2026-09-12. Baseline: `b7822f5f1fad146190fabb50b81877ea791fedfd`.
Only repository `myasnoy-batya-review-dev` and its Supabase DEV project
`ykiubttldgyjpajmsuas` are in scope. Business OS and production were not queried or modified.

## Status

DB bypass CLOSED and verified in DEV. Local server caller updated; **not pushed or
deployed**. Scheduler PAUSED. Yandex transport and review persistence remain DISABLED.
No service key was retrieved, provisioned, printed or committed. No Yandex request,
cookie/session/login/CSRF handling, reply publishing or customer-row mutation was performed.

## Audit source of truth

Current pg_proc/proacl, role privilege checks, pg_indexes/pg_constraint, RLS/policies,
triggers and all 16 applied migration names were inspected in the verified DEV project.
All migration statements referencing the enqueue/status/reviews functions and applicable
GRANT/REVOKE statements were inspected. Catalog definitions were also searched for
callers referencing queue tables and enqueue functions. Local api/lib/HTML sources
and existing tests/docs were searched; no frontend enqueue caller was found.

- `20260911142919`: original queue engine, tables and pg_cron; engine revoked from
  PUBLIC/anon/authenticated and granted to service_role/postgres; public status explicitly readable.
- `20260911143114`: second public enqueue implementation with explicit
  anon/authenticated EXECUTE and **missing PUBLIC REVOKE**.
- Current legacy ACL before remediation:
  `{=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}`.
- The legacy function was SECURITY DEFINER owned by postgres and accepted a public
  QR token to resolve company. RLS could not protect against this entry point.
- Normal authenticated users had the same enqueue access; no admin check existed.
- Existing admin model is `review_is_admin()`, backed by active review_admins/auth.uid().
  It is not adopted for scheduler calls: even an admin browser has no enqueue grant.

The bypass was independent of the HTTP CRON_SECRET check. Revoking only anon/authenticated
would have left PUBLIC EXECUTE in place.

## Applied migration and new RPCs

[20260912095126_review_sync_server_boundary.sql](../supabase/migrations/20260912095126_review_sync_server_boundary.sql)
was applied successfully to DEV only. The file was created with Supabase CLI 2.117.0,
then its filename was aligned to the version assigned by MCP. Its SQL matches the
applied migration; no earlier migration was rewritten.
Normalized SQL MD5 verified equal locally/in DEV: `0e9dfc0400d4550b14999e3875f41c12`.

1. `review_public_request_due_syncs(text)`: retained **denial tombstone**, not an
   enqueue wrapper. SECURITY INVOKER, empty search_path; always raises 42501
   PUBLIC_SYNC_DISABLED even if accidentally re-granted. PUBLIC, anon, authenticated
   and service_role EXECUTE all revoked; only owner retains access.
2. `review_enqueue_due_syncs()` replaced by **the same engine**
   `review_enqueue_due_syncs(p_company_id uuid)`. Required non-null company;
   no default/all-company path or overload. SECURITY INVOKER, empty search_path.
   Only service_role/postgres EXECUTE. Existing tables/locking/interval/status engine
   reused; no parallel queue. Selection and updates explicitly scoped to company.
   Only queue/run metadata changes; no review writes, matching, rewards or Yandex calls.
3. `review_public_sync_status(text)`: same return columns and explicit read grants,
   now STABLE, schema-qualified read-only body, empty search_path.
   Free-form last_error is reduced to PROVIDER_SYNC_ERROR or null.
   It never enqueues or calls a mutation function.
4. Migration refuses to run if the known legacy job is active. DROP has no CASCADE;
   unexpected SQL dependencies abort the transaction. No table/index changes.

### Security matrix (actual DEV privileges after migration)

| Role | Legacy public enqueue | Scoped enqueue(uuid) | Public status |
|---|---|---|---|
| PUBLIC | denied | denied | denied |
| anon | denied | denied | read allowed |
| authenticated (including admin browser) | denied | denied | read allowed |
| service_role | denied | allowed | read allowed |
| postgres owner | tombstone denies execution | allowed | read allowed |

Queue/connections/reviews RLS remains enabled with no permissive policies or user
triggers. Existing service-role table privileges and BYPASSRLS enable the INVOKER
engine; no blanket grants or new client mutation policies were added.

## Callers before / after

| Caller | Before | After |
|---|---|---|
| HTTP GET /api/cron/review-sync | publishable client -> legacy public enqueue(text), then QR-scoped status | CRON_SECRET -> server-only boundary -> scoped enqueue(uuid), service credential |
| HTTP GET /api/review-sync-status | publishable -> public status(text) | same read-only RPC, sanitized errors; no service credential |
| Frontend HTML/JS | no enqueue caller found | no enqueue caller or privileged import/key added |
| Existing pg_cron job 1 | active, no-arg enqueue() as postgres | paused; retained old target is intentionally NOT runnable until updated |

Cron keeps 401/0-RPC for missing/empty/wrong secret, 405 for non-GET, fixed 503 on
configuration/backend failures. Authorization is read per request. No user-controlled
company ID, RPC name, URL or credential is forwarded from headers/query/body.

Server-only configuration names (values never committed):
`CRON_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `REVIEW_SYNC_COMPANY_ID`.
Missing privileged configuration fails before Fetch; there is no publishable-key fallback.
The backend URL is pinned to this DEV project. New sb_secret keys use apikey only;
legacy service_role JWTs must name this project and are sent as Bearer as well.
Local JWT parsing is only a configuration guard; Supabase verifies signatures.

External scheduler interface: authenticated GET /api/cron/review-sync with server env.
Future pg_cron/Supabase scheduler interface: call enqueue_due_syncs with an explicit,
trusted company UUID under postgres/service_role. A future multi-company dispatcher
must enumerate trusted company scopes, never accept scope from an anonymous client.

HTTP response retains `ok/schedule/requested/providers` keys. **Compatibility change:**
`providers` is now an empty array; obtain health through /api/review-sync-status.
This deliberately separates QR-scoped public reads from company-scoped mutation.
`schedule: hourly` is legacy metadata, not proof of an active scheduler.

No app deploy was requested/performed. Previously deployed code still references the
retired RPC and will fail closed until a separate DEV code deployment/configuration.
Do not restore public grants to make that obsolete caller work.

## Job pause evidence and restore boundary

Owner explicitly authorized pausing, NOT deleting, this DEV job.

| Field | Before | After |
|---|---|---|
| jobid / name | 1 / review-provider-due-check-hourly | unchanged |
| schedule | 0 * * * * | unchanged |
| command | select public.review_enqueue_due_syncs(); | unchanged, obsolete signature |
| database role | postgres | unchanged |
| active | true | false |

Pause verified at 2026-09-12 09:42:45 UTC; 0 in-flight runs.
Rechecked 09:52:13 UTC: active=false, 0 in-flight, **0 starts since pause**.
Final aggregate recheck 09:57:37 UTC: active=false, 0 in-flight, 0 starts and
**0 new queue rows since pause**; review count remains 0 and global index is retained.
Last start remained 09:00:00 UTC. No job was manually triggered or newly scheduled.
No Vercel cron configuration was added.

Restoration requires a separate approval: deploy/configure the new DEV server path,
confirm trusted company mapping, update this existing job's command to the explicit
UUID signature and validate it, then enable the same job. Do not simply flip active
on the retained no-argument target. Do not create a duplicate job.

## Cross-company / persistence verdict

**UNSAFE for an unguarded global conflict writer. Index migration DEFERRED.**
Read-only aggregate inspection: 0 review rows, 0 null locations, 0 company/location
mismatches, 0 scoped duplicate groups. No review bodies/authors were selected.

Current constraints:
- UNIQUE(company_id, provider, external_review_id).
- UNIQUE(provider, external_review_id), global index review_external_reviews_provider_external_id_uq.
- Separate company/location FKs; no composite check that location belongs to company.

Local PostgreSQL regression proves:
- Same provider/ID in a different company OR location -> 23505, not two scoped records.
- Different provider -> distinct records allowed.
- An unsafe global ON CONFLICT DO UPDATE can reassign company/location. This is a
  demonstrated remaining schema/writer hazard, NOT a safe persistence contract.

New `lib/server/review-persistence-plan.js` is a **pure preflight**, not a writer:
same provider/full scope/ID duplicates keep first observation; cross-company/location
collisions reject the entire plan with REVIEW_SCOPE_COLLISION; different providers
stay distinct. Always returns persistenceEnabled=false. Inputs are trusted normalized
rows and a complete collision snapshot; this does not authorize a company, query the
DB, prevent a race, or replace a transaction/DB constraint. No runtime writer is wired.

### Exact candidate migration plan — NOT applied

[Candidate SQL used only by local tests](../test/fixtures/db/scoped-index-plan.sql):

1. Stop all writers; re-audit data and dependencies while protected from concurrent writes.
2. Confirm trusted (company, internal location, provider, external organization) mapping.
   Resolve any null/orphan/mismatched locations explicitly; never auto-assign them.
3. Review existing matching engine before admitting repeated IDs. It has a null-location
   wildcard and no explicit company predicate. Review sessions store external_review_id
   as text; matches carry row UUID in JSON, not an FK. Reply actions use a real review-row
   FK and unique active action per row. Company-qualified matching/row identity must be
   approved, not assumed merely because the review table is empty.
4. Add UNIQUE(id,company_id) on review_locations; set review location_id NOT NULL.
5. Replace location-only FK with composite (location_id,company_id), deferrable
   NO ACTION. This blocks isolated location deletion while allowing a completed company
   cascade; this change to deletion semantics also requires review.
6. Create UNIQUE(company_id,location_id,provider,external_review_id).
7. Only after validation, drop BOTH broader unique constraints/indexes (not just global).
8. Introduce one atomic scoped writer using the scoped conflict target; never update
   company/location/provider/identity columns on conflict. Verify external organization
   consistency and preserve reply workflow; reject contradictions without partial writes.
9. Test concurrency/replay and matching/reply consumers before enabling persistence.
   Rollback to old unique indexes requires rechecking for newly admitted cross-scope IDs;
   never delete/merge reviews to make a rollback pass.

Candidate DDL and same-scope upsert tests pass in isolated PostgreSQL, including foreign
company/location rejection. They are not proof of live worker concurrency/integration.
Empty DEV data alone does not make this multi-consumer contract change unambiguously safe.

## Yandex page numbering

`createYandexPageNumbering(pageBase)` centralizes configuration, validation and pageAt.
Default is declared once (1); explicit 0/1 are tested. Invalid configuration/indices fail.
Existing offset/limit/total drift checks remain fail-closed, with no partial-success fallback.
**PAGE BASE LIVE CONFIRMATION PENDING**. TYPE CONFIRMATION PENDING remains for timestamps
and public_rating. Only a separately authorized future smoke can confirm live values.

## Verification

- `npm test`: **55/55 PASS**, including 15 PostgreSQL subtests and all Remediation 01 tests.
- `npm run check`: **PASS**, 34 source/JSON/inline-script checks.
- External Fetch disabled in tests; provider/HTTP transports are mocked. PostgreSQL uses
  pinned @electric-sql/pglite 0.5.8 in memory, no disk database or remote connection.
  It is a dev-only dependency, not a runtime/browser import.
- Actual DEV role checks: anon and authenticated direct calls to BOTH enqueue signatures
  -> 42501; status remains readable. service_role new signature -> allowed, 0 enqueued
  for a checked absent fixture-company UUID, transaction rolled back.
- Initial service test using READ ONLY hit PostgreSQL's SELECT FOR UPDATE restriction
  before mutation. Corrected verification used the absent scope + rollback, not a
  real company. See [repeatable DEV verification SQL](../test/review-sync-dev-verification.sql).
- No frontend build script exists; no build/deploy or live cron HTTP endpoint was run.
- `npm ci --ignore-scripts`: PASS, pinned lockfile reproduced; audit reported 0 vulnerabilities.
- Final diff-check: PASS (staged changes checked before commit).

Security advisors were run after DDL. No enqueue function remains in public SECURITY
DEFINER warnings. Public read status is intentionally flagged; its body/grants were
checked. Other existing warnings were not silently changed: unrelated public/admin
RPCs and disabled leaked-password protection. 13 RLS/no-policy notices preserve
default-deny direct table access rather than justify opening policies.
References: [public definer advisory](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable),
[authenticated definer advisory](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable),
[password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Stop condition

Before Yandex Session Transport v1: separate permission for own-account read transport,
DEV code deployment/server-only configuration, and live page/type confirmation.
Before any persisted live sync: resolve scoped-index/atomic writer/matching boundaries.
Scheduler stays paused until separate approval. No Yandex session/auth/write implementation
is part of this commit.
