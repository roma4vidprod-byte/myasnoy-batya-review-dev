# VPS13 — scoped reply drafts foundation

Date: 2026-09-20
Status: **SOURCE READY; LIVE DDL APPLY BLOCKED BY REMOTE TOOL SAFETY**
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
## Live apply status

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
