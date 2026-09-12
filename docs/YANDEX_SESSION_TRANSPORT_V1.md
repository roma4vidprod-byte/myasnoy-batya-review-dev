# Yandex Session Transport v1 — isolated DEV

Next checkpoint: [Live Read Smoke 01](YANDEX_LIVE_READ_SMOKE_01.md) prepared an explicitly
synthetic Asbest company/location under new owner authorization. Manual session import
is pending; no live request yet. The missing-location evidence below is the v1 snapshot.

Date: 2026-09-12. Baseline: `1289c043efcf736f586497b6ae532f7cadd0a6f5`.
Repository: myasnoy-batya-review-dev. Supabase: `ykiubttldgyjpajmsuas` ONLY.
Business OS and production were not queried or modified. Pointer is not a dependency.

## Status and limits

Server-only implementation is fixture/mocked-HTTP tested. No real session import,
Yandex request, Telegram/email send, hourly execution, push or deployment performed.
No real service key, encryption key or Yandex credential was retrieved/provisioned.
Private storage migration is applied to the dedicated DEV; evidence is recorded below.
Real review persistence is OFF, not a partially enabled writer.

**PAGE BASE LIVE CONFIRMATION PENDING. TYPE CONFIRMATION PENDING.**
Actual technical-account identity/cookie compatibility is NOT VERIFIED live.
The import account label is an operator assertion, not an identity verification API.

Read-only DEV location lookup found no row with city containing Асбест or
yandex_review_url containing `54309413522`. No location/company was created or
silently assigned. Verify the mapping to Асбест, Ленинградская 41А before import;
organization ID is not the internal location UUID.

## Architecture and reuse

Trusted operator stdin -> session service -> encrypted CAS storage RPC.
Approved health/probe/dry-run -> exact GET transport -> existing YandexProvider
(`lib/providers/yandex.js`) -> existing normalization/dedup -> existing scoped
persistence preflight -> safe metadata/counts only.

- `lib/server/yandex-session/crypto.js`: narrow cookie validation and AEAD.
- `transport.js`: only the fixed Asbest reviews endpoint; GET, manual redirects,
  10-second timeout, 2 MB body cap, JSON gate. No login/write/CSRF transport.
- `store.js`: one scoped RPC client over the existing fixed-project service-role boundary.
- `service.js`: lifecycle, revision checks, existing provider orchestration, dry-run.
- `alerts.js`: deduplicated incidents through existing Telegram/Resend senders.
- `scripts/yandex-session.mjs`: trusted server/operator entry, not an HTTP endpoint.

No second review engine, queue, Matching, promo or notification delivery system.
Matching is deliberately not called while review persistence is disabled.
HTTP cron/status remain the existing endpoints and retain their security contracts.
The transport is not automatically wired to queued jobs or public/admin frontend.
Browser pages do not import server code and receive no privileged environment values.

## Storage, encryption and privileges

[Final migration](../supabase/migrations/20260912103803_yandex_session_transport_v1.sql)
and [approved storage design](YANDEX_SESSION_STORAGE_PROPOSAL.md).
Existing review_sessions is a customer reward table, not a Yandex credential store;
provider_connections is company/provider-wide generic config, not private location credentials.

One new table `review_private.yandex_sessions`:

| Columns | SQL / meaning |
|---|---|
| company_id, location_id, external_org_id | UUID/UUID/text, NOT NULL composite PK; org restricted to 54309413522 |
| credential_version, envelope | nullable UUID/JSONB, present together; envelope only v/kid/iv/tag/ciphertext |
| revision | positive bigint, starts 1, compare-and-swap fencing |
| state | NOT_CONFIGURED / READY / REAUTH_REQUIRED / ERROR / DISABLED |
| last_session_check_at | nullable timestamptz, last completed successful health/probe/full read |
| last_successful_sync_at | nullable timestamptz, completed full dry-run read + preflight; NOT proof of review persistence |
| last_error_code | nullable fixed allowlist, no raw message |
| incident_id, alert_claimed | nullable UUID + NOT NULL boolean for at-most-once alert claim |
| updated_at | NOT NULL timestamptz |

Composite location/company FK prevents foreign-company location assignment. Supporting
UNIQUE(id,company_id) is added only to review_locations; external review indexes remain
unchanged. The deferred index-plan fixture now reuses this exact constraint after
validating its definition; it still is NOT a deployable/applied migration.

RLS ENABLE + FORCE, zero policies. No client schema/table/RPC grants. Private schema
is not added to Data API exposed schemas. RPC is SECURITY INVOKER with empty search_path.

| Role | Private schema/table | Session RPC | Public sync status | Enqueue |
|---|---|---|---|---|
| PUBLIC / anon | denied | denied | anon read only | denied |
| authenticated, including admin browser | denied | denied | read only | denied |
| service_role (trusted server) | USAGE + SELECT/INSERT/UPDATE; no DELETE | allowed | read | scoped only |
| postgres owner | administrative access | allowed | read | scoped only |

The service role is privileged across scopes; it is not per-user authorization.
Never expose it through an arbitrary RPC proxy or accept browser-selected scope.
One RPC `review_yandex_session_store(uuid,uuid,text,text,bigint,jsonb)` actions:
read (ciphertext to server only), replace, transition, claim_alert, snapshot.
Snapshot reads only company/location/provider/external IDs across matching identities,
needed to detect global-index collisions; no review text/raw_payload/session material.

AES-256-GCM via Node crypto, 32-byte server key, fresh random 12-byte IV and 16-byte
authentication tag. AAD binds project/provider/company/location/org/account/version.
The DB receives ciphertext, never raw cookies. Keys live outside DB in a protected
server secret manager/environment. Envelope CHECK rejects extra/plaintext fields and
JSON-null/type bypasses; application validates GCM authentication before parsing.
No password, SMS/2FA, CSRF, Authorization or whole browser storage import.

DB/backup access alone does not decrypt; combined app-key + DB compromise does.
This is application AEAD, not KMS/HSM. Avoid request-body/header tracing, process dumps,
shell tracing and stdin capture on the operator host. Plaintext JS strings necessarily
exist in memory and cannot be reliably zeroed; temporary plaintext Buffers are cleared.
Do not place secrets in repository files, command arguments, browser, chat or shell history.

## State machine, replace and failure behavior

- Missing row -> NOT_CONFIGURED; no HTTP and no alert.
- Import -> validate -> encrypt -> CAS(expectedRevision=0 for first insert) -> NOT_CONFIGURED.
- Successful approved health/probe/full dry-run -> READY; health does not stamp full sync.
- 401/403/login redirect/login HTML/captcha/challenge -> REAUTH_REQUIRED.
- Decrypt/malformed JSON/contract/pagination/network/collision errors -> ERROR.
- DISABLED -> erase current envelope/version; no HTTP. Re-enable requires fresh import.
- Replace/key rotation -> new credential version + IV, resets health/error/incident;
  previous successful full-sync timestamp remains historical, not proof of new validity.
- Check revision before every page and CAS final transition. Replaced/disabled sessions
  fence stale reads; SESSION_CHANGED does not overwrite state or emit a stale alert.

Failure returns no partial reviews/counts, does not mark sync successful, does not
delete/update any reviews, preserves prior successful timestamps. Errors/logs expose
only fixed codes. Captured upstream objects, headers and business_answer_csrf_token
are never persisted or returned. JSON type/ID-consistency evidence contains counts,
not raw values, authors, review IDs or session material.

Alert claim is persisted atomically before send. One attempt per channel/incident;
same state (including 401 -> 403) does not spam. Recovery/new state or explicit import
opens a new incident. Telegram has no assumed idempotency: crash after claim or a
delivery failure can lose an alert. No automatic retry; inspect status and explicitly
reimport/rearm after fixing channel config. Resend receives an incident idempotency key.
No new queue/outbox table; this is at-most-once attempt, NOT exactly-once delivery.

If storage is unavailable, return a fixed failure, do not start an untracked Yandex
read. A storage outage during finalization cannot reliably persist state/alert; it
must be visible to the trusted operator, never reported as successful sync.

## Safe import, reauthentication and rotation

Server-only configuration names (values never documented):
SUPABASE_SERVICE_ROLE_KEY, YANDEX_SESSION_KEYS_JSON (kid -> base64 32-byte key),
YANDEX_SESSION_ACTIVE_KID. Existing Telegram/Resend environment names are reused.
No new environment values were installed in this stage.

Operator commands: `node scripts/yandex-session.mjs status|import|health|probe|dry-run|rotate-key|disable`.
Choose one command, not the literal pipe expression. Input is bounded noninteractive
stdin JSON; no secret command arguments, disk export or terminal echo. Envelope:

```text
{scope:{companyId:<verified UUID>,locationId:<verified UUID>,organizationId:"54309413522"},
 expectedRevision:<current revision>,pageBase:<0 or 1>,session:<import only>}
```

Import material: account exactly `myasnoibatya-zakaz`, cookies array restricted to
name/value/domain/path/secure/httpOnly/expires. Only yandex.ru/.yandex.ru and paths
applicable to /sprav/api; secure=true; no expired cookies, duplicate names or header
injection. CSRF/password/SMS/2FA-named cookies/extra fields fail, not silently retained.
This narrow shape must be prepared on a trusted server from the owner's authorized
technical-account session; whole DevTools/browser exports are deliberately rejected.

Import itself performs no Yandex request and leaves NOT_CONFIGURED. Read operations
also require explicit operator setting YANDEX_LIVE_READ_APPROVAL=asbest-read-only-v1
for that approved invocation. Absence fails closed. This is an operator safety gate,
not a replacement for OS/server authorization; do not leave it globally enabled.

Rotation: retain old and new key in server keyring, select new active kid, read current
revision, invoke rotate-key. CAS re-encrypts without returning plaintext; new health
required. Remove old key only after every encrypted row is rotated. Decide backup key
retention/crypto-shredding separately; erasing a row does not revoke upstream Yandex
session or erase encrypted database backups. Reauth is manual, never automated login.

## First live smoke — separate approval REQUIRED, not executed

1. Confirm technical-account ownership and exact existing internal company/location mapping.
   Missing mapping must be resolved explicitly, not seeded by this transport.
2. Provision isolated server secrets and operator access without sending them through chat.
3. Obtain separate permission to import current session and read Asbest only. Import via
   protected stdin; verify safe status NOT_CONFIGURED and encrypted DB envelope.
4. Permit the read for that invocation. Run probe with explicitly configured pageBase.
   It inspects page 0 and 1. Offset 0 then limit -> base 0. Explicit JSON HTTP400/404
   for page 0 plus valid page1 offset0 -> base1. Both offset0 -> ambiguous FAIL.
   Other behavior/config mismatch -> FAIL, not fallback success. A small/empty dataset
   may not prove page base; retain pending status and inspect authorized safe evidence.
5. Record real time_created/public_rating JSON type histograms and id/cmnt equality;
   units/meaning and differing-ID semantics still require review, not automatic guessing.
   Update anonymized fixture/docs/tests from confirmed evidence, not raw captured secrets.
6. Health then full dry-run through existing pager total/offset checks. Review persistence
   stays OFF. Do not invoke matching/rewards/replies. Clear live-read approval afterward.

Mock tests cannot change the two live-confirmation statuses. A failed probe must not be
described as completed live confirmation, even if an independent health request works.

## Persistence and scheduler remain blocked

Existing global UNIQUE(provider,external_review_id) plus company-wide unique constraint
are unsafe for unrestricted upsert. Identity-only DB snapshot + existing pure preflight
reject cross-company/location collisions, but are not an atomic writer/race protection.
No real review writes exist in this service, including on valid empty results.
Before persistence: approve scoped indexes/FK, atomic conflict writer, company-qualified
matching and review-row identity, concurrency/replay tests and reply-state preservation.

Job 1 `review-provider-due-check-hourly` remains active=false. Schedule `0 * * * *`
and old no-arg command are untouched; no Vercel cron added. Prepared future target:

```sql
-- TEMPLATE ONLY: replace with independently verified company UUID, never execute as-is.
select public.review_enqueue_due_syncs('<VERIFIED_COMPANY_UUID>'::uuid);
```

This target is the SAME existing scoped queue engine; it does not by itself read
Yandex. Existing HTTP CRON_SECRET/service-role adapter remains the external scheduler
interface. Future trusted worker must consume existing queue/status using this transport;
no duplicate job or parallel sync engine. Separate permission required to deploy/configure,
update the paused job target, and finally reactivate it after worker verification.

## Verification / migration evidence

Before apply: npm test PASS; npm run check PASS; git diff --check PASS. All external
Fetch disabled in tests, injected mocks only, PostgreSQL in-memory PGlite. SQL testing
includes the exact migration, forced RLS, anon/auth denial, service access, envelope
constraints, CAS, AAD isolation, failure cases, dedup alerts, dry-run and pending probes.
Existing cron fail-closed/security/status/provider tests are retained.
No separate build script exists in this static HTML + server-function project.

`20260912103803_yandex_session_transport_v1` applied successfully to the dedicated DEV
after owner approval, final migration presentation, **97/97 tests PASS** and **42 checks PASS**.
CLI-generated filename was aligned to the version assigned by Supabase MCP; SQL was
not rewritten. Normalized applied/local SQL MD5: `da7f8e207713179cff21def012b0f88c`.

Actual catalog and [read-only DEV verification](../test/yandex-session-dev-verification.sql)
PASS at 2026-09-12 10:38:33 UTC:

- anon/authenticated: no schema USAGE, no SELECT/INSERT/UPDATE/DELETE, no RPC EXECUTE.
  Actual SELECT/RPC calls and EXPLAIN INSERT/UPDATE/DELETE attempts fail with 42501;
  no write statements were executed against DEV session storage.
- service_role: schema USAGE, table SELECT/INSERT/UPDATE, RPC EXECUTE; DELETE denied.
  Actual SELECT returns count0; server RPC is entered and rejects null scope as expected.
  Real server write/import is intentionally NOT smoke-tested; exact DML/CAS is tested
  in isolated PostgreSQL. ACLs and forced-RLS/BYPASSRLS boundary are verified in DEV.
- Session table ACL: postgres owner + service_role=arw only. RPC ACL: postgres and
  service_role EXECUTE only; SECURITY INVOKER, empty search_path. RLS enabled + forced.
- Session rows=0, external review rows=0, existing global/company indexes retained.
- Jobid1 remains paused; name/schedule/command unchanged. Zero job starts and zero
  new queue rows since pause at 09:42:45 UTC. No scheduler invocation was performed.

Security advisors after DDL: no new WARN; one new expected INFO for private RLS with
no policy (intentional default-deny, not an invitation to add client access).
Existing 6 anon/11 authenticated SECURITY DEFINER warnings and disabled leaked-password
protection remain outside this change; no unrelated grants/auth configuration was changed.
References: [RLS no policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy),
[public definer](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable),
[authenticated definer](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable),
[password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Changed files

New: five modules under lib/server/yandex-session (crypto, transport, store, service,
alerts), scripts/yandex-session.mjs, api/_telegram.js, the additive
session migration, test/yandex-session.test.mjs, test/yandex-session-dev-verification.sql,
this runbook and YANDEX_SESSION_STORAGE_PROPOSAL.md.
Updated: lib/server/review-sync.js shared service RPC; api/feedback.js Telegram sender
reuse; api/_email.js timeout/redirect protection; deferred scoped-index-plan fixture
constraint reuse. Documentation: README.md, BACKEND_FOUNDATION.md, SUPABASE_DEV.md,
docs/YANDEX_REVIEW_PROVIDER.md. Existing YandexProvider/Matching are not duplicated or changed.

## Stop point

Implementation does not authorize first real session import/read. Stop here until owner
confirms the scope, secure session provisioning and read-only smoke explicitly.
