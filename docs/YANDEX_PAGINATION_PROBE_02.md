# Yandex live pagination probe 02

## Status: PREPARED — awaiting operator execution, no live rule confirmed

Owner reported successful session import and the prior probe result: ERROR,
revision 2, PAGE_BASE_AMBIGUOUS, mocked alerts, persistence OFF. Existing code
produces that code when parsed page 0 and page 1 both have offset 0. The prior
result does not establish ID equality, JSON primitive types or a page base.

Scope: company 13f3cb80-487a-4a19-96a1-fb3103200230,
location 9a95f63b-18e6-447b-a449-8530b67ddbae, org 54309413522.
Scheduler remains PAUSED by prior report; this preparation does not query/change it.

## Boundary and bounded inference

New diagnostic mode in the EXISTING session service uses its private read/decrypt,
revision/disable check before every request, GET-only transport, parser and CAS
status transition. No second transport, normalizer, writer or session engine.
Standalone operator script fixes scope/mode and mocks notification delivery.
It does not import credentials, read/write secret files or set environment keys.
Service state/error/alert-claim bookkeeping still uses existing private RPC;
this is not a promise of zero DB writes. No real review persistence/snapshot,
scheduler calls or full fetch. READY only after successful limited confirmation;
last successful full-sync timestamp is not advanced.

Sequential pages 0..3 only, no retries or fallback after HTTP/parser errors:

- offsets 0,limit with different ordered ID fingerprints: ZERO_BASED, stop at 2 GETs;
- offsets 0,0,limit with identical ordered IDs for first two and different third:
  ONE_BASED_PAGE_ZERO_ALIAS, stop at 3 GETs (page 0 and 1 alias first block);
- if total fits a single page: insufficient evidence, stop at 2 GETs;
- unexpected nonzero offset or changed first-block IDs: OTHER_CONTRACT, stop;
- if 0..2 all alias first block, check page 3 once; never exceed 4 GETs;
- changing total/limit, malformed response, 401/403/login/challenge: fail closed.

Confirmed describes only the observed bounded sample, not full-fetch success or
future stability. Other/insufficient outcomes retain ERROR and safe completed probe
evidence; failed HTTP/parser reads expose no partial raw data. Existing provider
default/status and the old strict probe remain unchanged until live evidence arrives.
PAGE BASE LIVE CONFIRMATION PENDING; TYPE CONFIRMATION PENDING.

## Safe report

Requested page, limit/offset/total, item count, first/last ID HMAC-SHA256 only.
Per-invocation random hash key never leaves memory and is cleared best-effort.
Equality detection uses all ordered IDs internally, not just boundary IDs.
Types and equal/different/missing ID counters count observed ITEMS across responses:
alias pages contribute again; these are not unique-review totals. No raw IDs,
authors, texts, cookies, CSRF, payload or hash key in output. Parser may transiently
normalize text in memory; no plaintext persistence or physical-erasure guarantee.

## Operator action (only after tests)

In the SAME existing key-bearing PowerShell 7, execute once:

```powershell
node 'C:\Users\tasfo\BusinessOS\myasnoy-batya-review-dev\scripts\yandex-pagination-probe-02.mjs'
```

Return only the safe output. Do not re-import session or rerun on error. Agent then
records live pager/types/ID evidence and updates applicable tests/docs. No full dry-run
fetch without the next step. Business OS/production, push/deploy are out of scope.

## Verification

Preparation checkpoint: full suite 269/269 PASS; 72 checks PASS; diff-check PASS.
No live execution by the agent. Post-live verification remains pending.

Synthetic tests cover aliases/zero base/other rules, bounded requests, unchanged
page adapter, salted hashes, empty data, drift, safe output, READY versus ERROR/
REAUTH_REQUIRED, mocked alerts and absence of snapshot/full fetch. Live result,
post-probe session state and actual types remain NOT VERIFIED in this checkpoint.
