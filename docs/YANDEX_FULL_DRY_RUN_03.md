# Yandex full live dry-run 03

## STATUS: PASS — owner-reported full live result

Completed at 2026-09-12T19:08:26.752376+00:00: READY, revision 4,
errorCode null; lastSessionCheckAt and lastSuccessfulSyncAt both have that timestamp.
Existing dry-run semantics update the successful-read timestamp; NO reviews persisted.

| Page | limit | offset | total | items |
| --- | --- | --- | --- | --- |
| 1 | 20 | 0 | 67 | 20 |
| 2 | 20 | 20 | 67 | 20 |
| 3 | 20 | 40 | 67 | 20 |
| 4 | 20 | 60 | 67 | 7 |

Received=67, unique=67, duplicates=0. Owner reply objects=54. Ratings:
1 star=9, 2=3, 3=0, 4=0, 5=55. Text null/non-null=0/67; author null/non-null=0/67.
ID consistency equal/different/missing=67/0/0. public_rating boolean=67/67.

time_created confirmed number/UNIX_MILLISECONDS: raw range
1735495043063..1788885653396 -> 2024-12-29T17:57:23.063Z through
2026-09-08T16:40:53.396Z. Milliseconds plausible=67, seconds plausible=0 within
declared 2000-01-01..2026-09-13T19:08:23.679Z window; normalization matched all values.
Existing normalizer already handled this correctly and retains subsecond precision.
Compatibility formats retained; no claim about owner_comment timestamp units.

Plan: inserts=67, update candidates=0, unchanged=0 (no existing matches),
collisions=0, scope failures=0; persistenceEnabled=false, reviewPersistence=OFF.
This is a snapshot preflight, not proof that concurrent persistence would be safe.
Global index/scoped writer hardening is still required before persistence.

Safe sample, hash prefixes only (all provider=yandex, external_location_id=54309413522):

| ID hash prefix | rating | published_at | reply present |
| --- | --- | --- | --- |
| 63b0af450b01 | 5 | 2026-09-08T16:40:53.396Z | false |
| 2fe9d7a1b710 | 5 | 2026-09-06T07:21:28.010Z | true |
| 2828fc0e8be3 | 5 | 2026-09-03T13:11:50.409Z | true |

No texts, names, raw IDs, cookies, CSRF or raw response stored in this report.
No new live fetch in post-result work. Scheduler not touched (PAUSED by prior report),
alerts mocked by the operator entrypoint, no Business OS/production or push/deploy.

## Historical preparation (superseded by result above)

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
