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
