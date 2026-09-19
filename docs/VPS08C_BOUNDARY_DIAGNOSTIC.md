# VPS08C — fixed page-3/page-4 diagnostic

Base HEAD `12d86e776eaf4bb3a943cd1b42be32a52388b6d7`, branch
`codex/yandex-live-read-smoke-01`. Existing uncommitted work preserved.

Previous page-4 evidence records 11 objects with all known required field
types/presence equal, but not per-item key/type classes or identity sets.
Neither original pages 1–3 identities nor page 3 structural signatures were
retained. Do not recover them from PII logs or claim all eleven are valid
merely from field types. Prior Yandex GET count: 6.

## Diagnostic boundary

Existing private `tools/vps08a/session.mjs boundary34` uses the existing
session store, vps-lab key/context and exact GET transport. Reader OS role
only; exact Asbest scope and ERROR/revision 3 checked before each GET and
after the pair. No `run`, health/CAS, snapshot, persistence, notification,
queue or worker call. Pages are fixed to **3 then 4**, no retry/redirect
follow, existing 10s timeout and 2 MB response cap. Page 3 must pass the
strict parser with limit20/offset40 before page 4 is requested.

Only process memory holds provider bodies, identity sets and raw structural
signatures. Each review is independently checked by the existing normalizer;
stable identity is exactly provider/location/externalReviewId, as in the
existing dedupe. No actual identities or discriminator values are returned.
Structural classes have synthetic labels, counts and a page-3 match boolean.
Unknown property names never leave the process. Cookie values/references
are discarded in finally. This diagnostic does NOT accept malformed pages
for business processing.

The classifier reports A only for exact already-seen boundary overlap,
C for all valid distinct non-overlapping objects with excess cardinality
and the same reported total, E for a currently normal page, otherwise G.
It cannot infer non-review semantics from missing fields/position or invent
an alternate offset contract. New/different unknown type markers block a
definitive ordinary-review classification. Comparison to pages 1–2 remains
UNKNOWN. No production parser acceptance rules are changed.

## Gates and result

Windows and Linux: each **150 PASS / 0 FAIL / 0 SKIP** (31 VPS08C cases).
`npm run check`: **140 PASS**. No general harness/full suite, no Recovery09A
changes. Source package scan: 146 files, no unexpected secret matches; two
unchanged pre-existing synthetic fixtures. All 26 user files preserved.

## Result — stop after two GET

**STATUS: YANDEX_PROVIDER_TOTAL_INCONSISTENT. Reviewed class: C.**

| Page | HTTP | Limit | Offset | Reported total | Items | Unique valid reviews |
| --- | --- | --- | --- | --- | --- | --- |
| 3 | 200 | 20 | 40 | 71 | 20 | 20 |
| 4 | 200 | 20 | 60 | 70 | 11 | 11 |

Both responses application/json; sizes 45,365 and 36,737 bytes. Boundary
overlap **0**; combined unique **31**; within-page duplicates **0/0**.
All eleven page-4 items individually pass the existing review normalizer,
form one key/type structural class also present on page 3, and have no
missing required fields or observed explicit different-type discriminator.
Thus no evidence of a non-review service item or page3/page4 boundary duplicate.

The page-4 count violates the unchanged strict length rule: 11 instead of
min(20,70-60)=10. Additionally the two immediate responses report different
totals (71 versus 70). This proves total inconsistency, not its implementation
cause. Stale cache, concurrent provider mutation and other mechanisms remain
UNKNOWN. No claim that pages1/2 do not overlap: those IDs were not retained or
refetched. The observed 31 unique IDs are only the page3/page4 union, not a
full-feed count.

Transparency: the initial conservative runtime classifier emitted `G_UNKNOWN`
because its C predicate requires equal totals. The raw SAFE diagnostic result
is preserved unmodified in evidence. Reviewed classification is C based on
the stronger directly observed cross-response and within-page inconsistency.
No parser or runtime re-deployment was made to force a classification/result.

Budget exhausted: **+2 GET, cumulative 8**. No further metadata investigation,
verification GET, Stage A, full Stage B or state transition. Parser file hash
unchanged from VPS08B. Session remains **ERROR/3**, timestamps unchanged.

Postflight 17:05:35 UTC: LAB 3 synthetic users/2 reviews, unrelated table hashes
unchanged, queue/runs0, provider connections0, timer disabled, monitor PASS,
NTP synchronized, healthz/readyz200/200, public TCP SSH only. Named journal
credential/provider/envelope patterns and exact-key scan returned zero.
No secret values, ID values, raw provider bodies or plaintext files retained.

One private CLI source update (3 files), 23-file runtime hash match; previous
source checkpoint kept. No DB/session/connection/review/role/key/env mutation,
no Cloud/Vercel/provider write, no notification/promo/AI effect. No commit or
push; base HEAD unchanged and previous working diff retained.

Next safe step: separately design a bounded fail-closed pagination strategy
for inconsistent provider totals, with synthetic acceptance/counterexamples
before requesting another live verification. Do not simply ignore total,
truncate/drop items or dedupe blind. No live-read integration PASS claimed.

Safe report: `docs/evidence/vps08c/VPS08C_RESULT.json`.

Final local diff-check PASS; 362-file secret-pattern scan has zero unexpected
matches and the same two unchanged synthetic exceptions. All 26 user hashes,
three local/runtime source hashes and the unchanged parser hash verified.
