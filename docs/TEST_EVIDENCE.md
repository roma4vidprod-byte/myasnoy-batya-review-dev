# Test evidence — AUD remediation

Проверка: 2026-09-14. Environment: local checkout, network interception enabled by the existing test harness. No production/DEV remote write was performed.

## Baseline before the remediation patch

- `npm test` — 356 passed, 0 failed.
- The suite is the existing project suite; historical `356/98` claims were not copied as current evidence.

## Targeted remediation

- `test/admin-reply-draft-security.test.mjs` — verifies no raw exception text is reflected and `reviewId` remains the only accepted request field.

## Post-patch results

- `npm test` — 359 passed, 0 failed.
- Native-host failure root cause: default Node test concurrency intermittently raced Windows PowerShell/native subprocess groups; the diagnostic child returned `status=null`. The isolated case passed 20/20, and the full suite passed with `--test-concurrency=1`.
- Fix: `package.json` makes the existing test command deterministic and sequential. This changes only test orchestration; the one-shot host lifecycle, strict exit assertion, nonce/origin/destination checks and production code remain unchanged.
- `npm run check` — PASS: 100 source/fixture/inline-script checks; configuration JSON valid; no code executed or network called.
- targeted native-host diagnostic — 20 PASS / 0 HANG / 0 FAIL.
- `git diff --check` — PASS.
- tracked secret-pattern scan — PASS.

## Required reruns

The final report must record the post-patch `npm test`, `npm run check`, and diff-check output separately. No live Yandex, enqueue, worker, scheduler, email, Telegram, promo or AI operation belongs to this evidence.

## Scope of evidence

Local tests, deployed checks and live acceptance are separate. A local PASS does not claim a current Vercel or Supabase state. The general QUALITY GATE / REGRESSION HARNESS was not run.

## Rev12 health execution-fix checkpoint

- Source starting SHA: `9c6c3e1b421919782e21d8dcf23da6bc85c943de`; branch: `codex/yandex-live-read-smoke-01`; working tree was clean before this change.
- Targeted health execution regression: PASS, 7 tests in `test/yandex-health-execution.test.mjs` (real handler + real session service; synthetic storage/transport/clock only).
- Targeted session/concurrency regression: PASS, 53 tests with `--test-concurrency=1`.
- Full local suite after the final patch: `npm test` — 377 passed, 0 failed.
- `npm run check` after the final patch — PASS: 102 source/fixture/inline-script checks; configuration JSON valid; no code executed or network called.
- `git diff --check` after the final patch — PASS.
- tracked secret-pattern scan after the final patch — PASS; no matching credential-shaped tracked value was found, and no environment value was read.
- The regression covers: NOT_CONFIGURED → page-1 GET → parser → READY CAS; storage failure at `SESSION_READ`; synchronous and rejected transport failures; parser failure after an HTTP response; CAS failure; and revision conflict.
- Reproduction before the fix: the same real handler/service composition with synthetic `store.read` failure returned `health_get=NOT_STARTED`, `error=SYNC_OPERATION_FAILED`, `state_after=null`, `revision_after=null`, `yandex_requests=0`; no transport or CAS ran. After the fix, the executable regression returns `health_get=FAIL`, `error=SESSION_STORAGE_FAILED`, `failure_stage=SESSION_READ`, `health_cas=NOT_ATTEMPTED`, and no fabricated counters/state.
- No live health/preflight was executed. No Yandex/2GIS request, remote DB write, enqueue, worker, scheduler, session import, environment/key change, email, Telegram, AI or promo action was performed by this checkpoint.
