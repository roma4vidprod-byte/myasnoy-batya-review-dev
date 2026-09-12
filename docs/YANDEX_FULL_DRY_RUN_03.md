# Yandex full live dry-run 03

## STATUS: PREPARED — operator execution pending

Preparation verification: 286/286 tests PASS, 75 checks PASS, diff-check PASS.
Post-live checks and factual unit/count confirmation remain pending.

Base checkpoint 9a6184e. Owner authorized one full GET-only read using pageBase=1.
Last live result: org 54309413522 READY/revision 3; total 67, limit 20, page 0 alias
page 1, numeric time_created and boolean public_rating. Not a fresh status query.
Scope: company 13f3cb80-487a-4a19-96a1-fb3103200230;
location 9a95f63b-18e6-447b-a449-8530b67ddbae.

## Existing path, not another sync engine

Operator script calls existing service.run dry_run with safeReport=true. Existing
transport, parser, page adapter, deduplication, snapshot and planReviewPersistence
are reused unchanged. Collector observes only safe scalar aggregates, then formats
unique normalized records after a successful plan. Expected requests 1,2,3,4 if
pager remains 67/20. No page 0, health pre-request, retry, extra read beyond total,
or repeated probe. Existing safety cap 20 pages remains; exceeding it FAILS.

Per-page parser validates exact item count. Provider enforces constant limit/total
and expected offset; report also verifies sum(items)=total. Any failure discards
report/sample, stops requests and leaves no partial success. Collision stops plan.
Safe failure flags distinguish detected scope/collision from NOT_CONFIRMED; no
fabricated zero counts on an incomplete operation.

Session CAS status transition is existing behavior: success READY, sync_ok=true
updates lastSuccessfulSyncAt, meaning successful read-only dry-run, NOT persisted
reviews. Failure records ERROR/REAUTH_REQUIRED and existing alert-claim bookkeeping;
delivery is mocked. These private session metadata writes are not review persistence.
No changes to DB schema, grants, RPC, keys, encryption or server credentials.

## Report semantics and uncertainty

- pages/received/time range/type/ID consistency describe raw fetched observations;
- unique count, owner reply, rating, text/author null counts and sample describe
  first-wins deduplicated normalized reviews; blanks normalize to null;
- owner reply present means owner_comment object exists, not necessarily nonempty text;
- total is reported total, duplicate count=received minus unique;
- sample <=3, per-run salted HMAC ID, rating, published_at, reply presence, provider,
  external_location_id only. No names/text/raw payload/session/CSRF or reusable hash key;
- report is only emitted after successful snapshot/plan AND session CAS transition.

Numeric source times are checked as Unix seconds and milliseconds against explicit
plausibility window 2000-01-01 UTC through invocation time + 24h. This is a declared
validation bound, not proof of business history. All observed times must support
exactly one common unit; normalized timestamps must match it. Unclear/mixed/outside
window values FAIL as contract drift, not a guessed unit. Empty list is NO_EVIDENCE.
Observed source public_rating must remain boolean in this opt-in live report.
Global tolerant parser remains unchanged until actual full-read evidence arrives.

Snapshot RPC returns identity/scope ONLY, not review contents (migration
20260912103803_yandex_session_transport_v1.sql lines 70-79). Existing plan marks
every matching identity update_same_scope and does not compute content equality.
Report plannedUpdates means update CANDIDATES, not proven changes. If no matches,
unchanged=0; otherwise unchanged=null/NOT_COMPUTED_BY_EXISTING_PLAN. No scope
expansion or extra content read to manufacture an unchanged count. Success means
zero collisions/scope failures in this snapshot, not a concurrency-safe writer.

## Operator: one execution only after tests/checks

In the SAME open key-bearing PowerShell 7:

```powershell
node 'C:\Users\tasfo\BusinessOS\myasnoy-batya-review-dev\scripts\yandex-full-dry-run-03.mjs'
```

Only share safe stdout. No secrets/arguments/files/re-import. Stop on failure; no
automatic retry. After result, document actual unit/types/statistics and rerun checks.
Keep review persistence OFF and scheduler PAUSED. No Yandex write/reply, Business OS,
production, push/deploy. Live numbers and current post-run state remain NOT VERIFIED
until the operator returns the result. No real request by agent during preparation.
