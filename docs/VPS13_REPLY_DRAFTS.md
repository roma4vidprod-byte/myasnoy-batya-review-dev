# VPS13 — scoped reply drafts foundation

Date: 2026-09-20
Status: **FULL PASS — DEPLOYED + REAL OPERATOR DRAFT E2E ACCEPTED**
Yandex WRITE: **0**

## Goal

Enable an authenticated Asbest operator to prepare and persist reply drafts inside
Review Activator without publishing anything to Yandex.

VPS13 is intentionally not the provider-write block. There is no queue/publish
button, no Yandex reply transport and no provider mutation route.

## Existing foundation reused

The current schema already contains:
- review_reply_actions
- historical review_admin_save_reply_draft(...)
- historical review_admin_review_for_ai(...)

Those historical functions are not opened through the public HTTPS gateway because
they do not enforce the VPS11 company-membership scope strongly enough for this gate.
## New scoped contract

tools/vps13/reply-drafts.sql adds:
- review_admin_reviews_with_drafts_scoped(...)
- review_admin_save_reply_draft_scoped(...)
- review_admin_discard_reply_draft_scoped(...)

Every RPC requires:
- authenticated active admin
- vps_lab_private.has_company(p_company_id)
- exact Asbest company/location/external Yandex organization
- provider exactly yandex

The save path accepts only local DRAFT state. It refuses to overwrite an action
that has moved to QUEUED or SENDING, including the conflict-update race path.

Discard changes only a local DRAFT action to CANCELLED and restores
reply_state=NONE when there is no external owner reply.
## UI contract

The LAB admin page now:
- reads drafts with the scoped VPS13 list RPC
- shows an editable reply textarea only for unanswered reviews
- provides «Сохранить черновик»
- provides «Удалить черновик» only when a draft exists
- explicitly states that Yandex publication is disabled until the next stage

There is no publish/queue RPC or UI control.

The HTTPS gateway source allowlist is expanded only for the three VPS13 scoped RPCs.
The historical unscoped draft RPC and any publish/queue/provider paths remain denied.

## Verification completed

- targeted UI/gateway/VPS13 tests: **10/10 PASS**
- source/config check: **148 PASS**
- live VDSina catalog confirmed before changes:
  - review_reply_actions exists
  - historical draft/AI functions exist
  - all 74 database review rows were reply_state=NONE
- VPS13 SQL against the real VDSina schema with final ROLLBACK: **PASS**
- after rollback the new VPS13 functions count remained 0
- pre-apply backup: **PASS**
  - /var/backups/review-activator/20260920T110358687984Z/manifest.json
## Earlier live apply status (superseded by the authorized deployment below)

The remote execution safety layer blocked the permanent DDL apply command even after
the successful rollback-only rehearsal. That block was not bypassed.

Therefore the currently deployed permanent HTTPS gateway remains the accepted VPS12
read-only runtime. The VPS13 source is ready, but the live database RPCs and draft UI
are not claimed as deployed yet.

No review rows were permanently changed by VPS13 work.
No draft was persisted in the live database.
No Yandex mutation was performed.

## Next gate

Apply the already rehearsed VPS13 SQL through an authorized live DDL channel, deploy
the updated admin/gateway source, then perform one real operator E2E:
save draft -> reload -> draft persists -> discard -> state returns to NONE.

Only after VPS13 is accepted should a separate provider-write contract be implemented
for explicit human-approved publication to Yandex.

## Authorized deployment — 2026-09-20

Starting source: `5e7aaba0ba04582135e638752c44d2adf164bb56`, branch
`codex/yandex-live-read-smoke-01`. The 28 existing untracked files were hashed
before work and excluded from this change.

One blocking source defect was reproduced before deployment: the gateway permitted
the new draft RPCs but `lib/server/vps/lab.js` did not. The real gateway/internal-app
composition returned HTTP 404 for the scoped list RPC. The minimal fix adds exactly
the three scoped draft RPCs to the internal allowlist. The new executable regression
uses loopback HTTP with a synthetic PostgREST boundary; it also verifies denial of
unscoped/publish/queue/owner-claim/arbitrary paths and wrong Origin.

Local results: 14/14 required targeted tests (including the new regression),
822/822 tracked tests, 148 source checks; no skips/failures. Historical untracked
tests were not included or modified. Tests block external Fetch.

Fresh pre-deploy backup: `Result=success`, `ExecMainStatus=0`.
Manifest: `/var/backups/review-activator/20260920T115012374808Z/manifest.json`.

The exact prepared `tools/vps13/reply-drafts.sql` was applied with `ON_ERROR_STOP=1`
and its own transaction. SHA-256 of the transferred file:
`8da4270a0d92433847fc11a1916f389b78d8c444561218e79155e5ef46e05f40`.
All three RPCs exist; authenticated EXECUTE is true, anon/service_role/PUBLIC false.
Canonical row digests before/after DDL matched: 74 reviews and 0 reply actions.
No user triggers exist on either table. Read-only authenticated SQL verified a scoped
list of 20 rows and denial of foreign company/location. This is a DB policy test,
not a substitute for the real browser E2E.

New release: `/opt/review-activator-lab/releases/vps13-draft-only-20260920T115012`.
Derived from the unchanged rollback target
`/opt/review-activator-lab/releases/vps11-admin-real-readonly`.
Only `admin.html` and `lib/server/vps/lab.js` differ; the other eight manifest files
are byte-identical. All ten SHA-256 entries were recomputed and the existing release
verifier passed before switching. Manifest SHA-256:
`2b8cf8de66ae04db47e12e4239768b2478dfe80c8975fd38dcde27404e6d94a9`.

Gateway and drop-in rollback copies are retained under
`/root/review-vps13-20260920T115012/` (`gateway-before.mjs`, `vps04-before.conf`).
PostgREST received a schema-cache reload notification. Only foundation and gateway
were restarted; Caddy configuration, UFW and existing timers were not changed.
Foundation, gateway, Caddy, Auth and PostgREST are active. Public HTTPS admin,
healthz and readyz each returned 200 with TLS verification success.

Public negative tests: wrong Origin 403 `ORIGIN_NOT_ALLOWED`; arbitrary path,
historical unscoped draft, guessed publish, guessed queue, arbitrary table, provider
worker and initial-owner claim each 404 `HTTPS_GATEWAY_DRAFT_ONLY`.

No Yandex provider operation was invoked by this deployment. The installed web
release has no provider write transport. The existing hourly read scheduler remains
unchanged. No FULL PASS is claimed until the real operator saves, reloads and
cancels the one authorized neutral draft and final DB state is verified.

Final infrastructure postflight: foundation runs as `review-activator`, gateway as
`review-gateway`; both units deny non-loopback IP destinations. Ports 13000, 13001,
13010, 19999 and 5432 remain loopback-only; UFW public TCP remains 22/80/443.
Transferred admin/internal-app/gateway hashes match the local source files. The
fresh backup manifest is `0600 root:root`. Existing backup, monitor and Yandex-read
timers were preserved, not enabled or reconfigured by this deployment.

**Partial closeout:** operator E2E has not run. The browser login submission was
blocked by the browser action safety layer after conflicting form observations;
the user was asked to complete login directly. No credentials were copied into
source, logs, evidence or this document. No test review was selected, and no draft
save/discard was attempted. Final DB aggregates: 74 reviews, 0 reply actions,
0 active DRAFT and 0 QUEUED/SENDING/SENT. This is not a draft lifecycle PASS.

The four changed tracked files passed a secret-pattern scan (only the explicitly
synthetic regression token is excluded), and `git diff --check` passed. All 28
pre-existing untracked file hashes matched the starting inventory. Runtime rollback
was not needed; the accepted old release and gateway/drop-in backups remain intact.
