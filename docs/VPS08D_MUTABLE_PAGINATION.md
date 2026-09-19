# VPS08D — bounded mutable offset diagnostic

Base HEAD `12d86e776eaf4bb3a943cd1b42be32a52388b6d7`, branch
`codex/yandex-live-read-smoke-01`. Existing VPS08A/B/C diff and user files retained.

## Proven cause and narrow contract

VPS08C observed page3 total71/count20/offset40, page4 total70/count11/offset60.
All eleven page4 reviews individually valid; boundary overlap zero. Provider
total is inconsistent; cache/concurrent-provider-change mechanism UNKNOWN.
The old `min(limit,total-offset)` terminal length rejects this valid item set.

Explicit `MUTABLE_OFFSET` reuses the existing parser, normalizer, transport,
pagination loop, session service/store and CAS. The private VPS CLI operation
is `mutable-full`. No new sync engine, HTTP endpoint or default worker path.
Cloud and persistence paths retain their existing default strict behavior;
only this VPS diagnostic opts in. Item validation/raw-field allowlist and
network transport code are unchanged. No new credentials or role grants.

Every page requires requested offset, limit20, array length0..20, nonnegative
integer total, valid review objects and unique identities within the page.
Cross-page identities are deduplicated in memory (first valid occurrence wins),
with explicit raw/new/duplicate counts. Every duplicate object is validated.
No review values or identities are emitted.

Termination: short/empty page only, never a total comparison. Ten full pages
fail `YANDEX_PAGINATION_LIMIT_EXCEEDED` / `NO_TERMINAL_PAGE`; existing per-request
10s, total30s, 2MB response guards and no redirects/retries remain.

Completeness: a short page AND deduped count within this run's observed
`[min_total,max_total]`. Equal totals/count yield `STRICT_STABLE_COMPLETE`;
otherwise compatible changing totals yield `MUTABLE_TOTAL_COMPLETE`.
Outside the envelope: `INCONSISTENT_INCOMPLETE`, no partial acceptance.
No percentage tolerance, no duplicate exception: duplicate observations alone
cannot prove that unobserved reviews are absent. First/last/min/max/change
count, all observed totals, terminal length and per-page counts are explicit.

## State and effect boundary

VPS context/capability only, exact Asbest scope, ERROR/revision3 before/between/
after requests. The full diagnostic itself never mutates anything. Only an
accepted complete result allows its adapter to call existing scoped health CAS
once with expectedRevision3, READY/auth_ok=true/sync_ok=false/error=null.
CAS failure/uncertainty is not retried or reported as READY. No failure-state
transition for this operation. Material, sync timestamp, connections, review
tables, queue, scheduler and notifications are outside the write boundary.

One live invocation authorized, Stage A not rerun. Cumulative GET before
this task:8. Final results below are actual, not historical test counts.

## Reproduction

New synthetic regression on old code: 13 PASS /20 FAIL /0 SKIP, including the
observed71/71/71/70 case rejected with `YANDEX_CONTRACT_DRIFT` at old page-length
rule. After patch:33 PASS /0 FAIL /0 SKIP. These use fake transport/storage,
never real cookies/provider/DB. Historical item and default-mode tests retained.

## Accepted live result — stop

**PASS_VPS08_YANDEX_READ_ONLY**. One invocation, four consecutive GETs,
HTTP200 each, no retry. Mode `MUTABLE_OFFSET`; current-run classification
`STRICT_STABLE_COMPLETE`: totals **71/71/71/71**, first/last/min/max71,
raw71/unique71/duplicates0, terminal page11. Every review and exact scope
validated. Historical delta from69:+2; UI reference70:+1 (informational only).

Do not hide drift or falsify the current measurement:

- Prior proven VPS08C run: `provider_total_stable=false` (71 then70).
- Synthetic observed-case regression: `MUTABLE_TOTAL_COMPLETE`, stable=false.
- This actual final run: `provider_total_stable=true`, change_count0.

The latest stable run does not prove provider totals immutable or erase the
earlier anomaly. The new bounded mutable model remains explicit.

Existing CAS succeeded once: **ERROR/revision3 -> READY/revision4**.
`last_session_check_at=2026-09-19T17:28:38.977004+00:00`;
`last_successful_sync_at=null` remains unchanged. This is read/auth health,
not persistence or business sync acceptance. No import, key/crypto change,
connection reconciliation, enqueue, worker or scheduler execution.

Read-only postflight 17:29:20 UTC: one exact-scope encrypted session row;
LAB3users/2reviews, unrelated table hashes unchanged, queue/runs0,
provider_connections0, worker timer disabled/inactive, monitor PASS,
NTP synchronized, healthz/readyz200/200, public TCPSSH only.
Real review insert/update/delete **0/0/0**. No notifications, promo, AI,
provider writes, Cloud/Vercel/BusinessOS/Production actions.

New YandexGET4, cumulative12. Only `GET` to `yandex.ru` over HTTPS. Read
transport remained unchanged (manual redirects, response-size/time caps).

## Gates / provenance / security

Windows: **183PASS/0FAIL/0SKIP**. Linux: **183PASS/0FAIL/0SKIP**.
New VPS08D cases33; `npm run check`:141PASS; diff-check PASS.
General quality harness/full suite NOT_RUN; unrelated Recovery09A not touched.

One private source update:4files, previous source checkpoint preserved at
`/var/lib/review-activator-ops/vps08d-runtime-before`; all23runtime hashes match.
Individual item contract prefix unchanged, LF-normalized SHA256:
`7e8c46c2d2817b2647ca6fa47ac6e5bd9f5612cb022bdf05a9535654067ccb97`.
Source manifest SHA256:
`cdfe2e1653480ff0a4b6e768398bfe7bb3db86ba1ec1fc1d74ba72709375a856`.
Source archive SHA256:
`adf7b6498c2c710380c98706e4b406c18f18031da9886f99bcd442bbc734052d`.
No runtime depends on Windows; installed private Node CLI performs all reads
and CAS on VPS. Windows used only for administration/tests/source transfer.

148-file source package hash/secret scan:0unexpected matches,2unchanged
pre-existing synthetic exceptions. Scoped application/auth/postgrest/worker/
Postgres journal since17:25UTC:0credential-header/provider-field/envelope
pattern matches. Existing server audit:0exact key matches in journal since
install. This is scoped evidence, not a claim to scan every historical log.
Diagnostic output contains aggregates only; regression verifies no fixture
secret, author/text/identity leakage. No plaintext session artifact created.

All26user files hash-preserved. HEAD unchanged; source update is the verified
working snapshot, not a fabricated new commit. Prior work is still in the
working tree; no push. Safe evidence: `docs/evidence/vps08d/VPS08D_RESULT.json`.

No VPS08D read-only blocker. Real review persistence/business scheduling remain
unaccepted and OFF. Reboot remains blocked by unproven out-of-band recovery;
DR remains the previously proven encrypted Windows-copy restore, not a durable
off-host service. Next step requires a separate scoped persistence acceptance;
do not initiate it from this PASS.
