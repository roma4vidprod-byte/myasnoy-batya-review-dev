# VPS08B page-4 investigation

Baseline: `12d86e776eaf4bb3a943cd1b42be32a52388b6d7`, existing uncommitted VPS08A preserved.

Prior live evidence: 5 GET, Stage A PASS; Stage B 4 HTTP 200 responses,
3 parsed pages/60 items. Session ERROR/3. No review persistence.
The CLI discarded the service's parser field. Journals for the original
execution contain no rule-level diagnostic markers. Exact historical rule
is UNAVAILABLE. Page-3 key/type metadata was not retained; no page-3 refetch.

Before any new GET: add value-free parser rule/path/type diagnostics and the
private CLI `page4` operation. It requires explicit vps-lab context, existing
reader OS role, fixed Asbest scope, ERROR/revision 3, and valid encrypted
material. It performs one GET page 4, checks revision before/after, never
transitions state, and uses no writer/queue/notification API. Cloud guards
and parser acceptance rules are unchanged at this stage. Response size is
measured inside the existing bounded transport, not a second HTTP request.

Unknown provider key names are counted, not output. Rule metadata originates
in fixed parser branches. Raw responses, cookies and review values are never
written to evidence. Existing source-only CLI files will be checkpointed
before a narrow runtime update; no key, environment, ACL or schema change.

Initial Windows targeted result: 114 PASS / 0 FAIL / 0 SKIP. Live diagnosis
and any semantic fix remain pending; this is not acceptance.

## Live result (2026-09-19)

One targeted page-4 GET completed, HTTP 200, application/json, 36,737 body
bytes. `list.pager = {limit:20, offset:60, total:70}` but `items.length=11`.
The existing `items.page_length` rule at `$.list.items.length` expects
`min(limit,total-offset)=10`. Types/containers and mandatory field presence
were reported safely; item normalization was not reached because the pager
length check runs first. No claim that every item's value validates.

Verdict: **C / MALFORMED_OR_UNEXPECTED_RESPONSE**, specifically internally
inconsistent pagination cardinality. Provider-side cause (stale total,
duplicate/extra item, moving dataset, or other cause) remains UNKNOWN.
The missing historical rule cannot be retroactively proved identical.
No evidence establishes a legitimate alternate terminal-page contract.

No semantic parser change: accepting eleven here could silently accept a
duplicate/moving/incomplete snapshot. Stop condition reached. No verification
GET or final Stage B; session remains ERROR/3 pending read-only confirmation.

Regression fixture contains only synthetic identifiers/text/timestamps and
the observed structural cardinalities. It must FAIL. Valid ten/70 and
eleven/71 variants PASS; malformed items remain rejected. This proves the
guard is not hardcoded to a historical review count.

Incremental Yandex GET=1; cumulative VPS08 GET=6 (prior 5). All mutation
methods=0. Session transitions/imports/reconciliation/queue/worker/timer
actions=0. Cloud/Vercel/Business OS/production actions=0.

Four private runtime source files updated with a protected source checkpoint.
No key/env/ACL/schema change; no app restart. Base commit unchanged; VPS08B
code/tests/docs are uncommitted because live acceptance is blocked.

## Final checks

Windows: **119 PASS / 0 FAIL / 0 SKIP**. Linux: **119 / 0 / 0**.
Includes 24 VPS08B rule/gate/redaction tests. `npm run check`: **138 PASS**.
No full suite/general quality harness. No unrelated Recovery09A changes.

Read-only postflight at 16:46:55 UTC: session ERROR/3, timestamps unchanged,
LAB 3 users/2 reviews, unrelated-table hashes unchanged, queue/runs 0,
healthz/readyz 200/200, monitor PASS, NTP synchronized, public TCP SSH only,
worker timer disabled. Runtime 22-file hash match confirmed. Named service
journal pattern scan and installed exact-key-value scan returned zero
matches; no raw log/body output. This is scoped scan evidence, not a claim
of a universal historical audit.

Detailed safe evidence: `docs/evidence/vps08b/VPS08B_RESULT.json`.

Final `git diff --check` PASS. Secret-pattern scan: 357 files, zero unexpected
matches; two pre-existing synthetic fixtures are byte-identical to HEAD.
All 26 user files match the saved hash manifest. Local/runtime modified
source hashes match. No new commit or push; prior working changes preserved.
