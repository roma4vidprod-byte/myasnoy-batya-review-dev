# VPS04 failure and local regression results

## Native LAB

`VPS04_FAILURE_TESTS.json`: **8 PASS / 0 FAIL / 0 SKIP**.

* Stop Auth → readiness 503; restart → 200.
* Stop PostgREST → readiness 503; restart → 200.
* Stop PostgreSQL → readiness 503; restart → 200.
* Remove synthetic schema-version marker → readiness 503; restore exact marker → 200.
* Restart existing foundation/app service → readiness 200.
* Run as Node Unix identity → signing/service config reads denied.
* Real Auth table ownership and authenticator role memberships/flags match contract.
* cron jobs, sync runs, Yandex session rows all zero.

Liveness remained 200 during dependency failures. No fallback destination. All components restored. Two deliberate LAB version-marker writes; no Cloud DB writes. JWT key/issuer/audience/expiry and cross-scope negative tests are in Auth/API/RLS reports.

## Local Windows

2026-09-19 Node 24.19.0, `--test-concurrency=1`, existing no-network import guard:

* targeted VPS04 + existing foundation + admin redirect: **88 PASS / 0 FAIL / 0 SKIP**;
* `npm run check`: **125 PASS**;
* `git diff --check`: PASS;
* full `npm test`: **479 PASS / 10 file-level FAIL / 0 SKIP**, exit 1, 126.9 seconds.

All ten failing files terminated at V8/PGlite startup with `Fatal process out of memory: Zone`: database-boundary, reconciliation-boundary, review-fail-sync-null-guard, scoped-writer, yandex-connection-reconciliation-07a4b, yandex-contract-recovery, yandex-enqueue-rpc-07a1, yandex-scheduler-acl, yandex-session, yandex-smoke-scope.

Measured Windows available physical memory 411888 KiB; available virtual commit 869252 KiB. No unrelated processes killed, swap changed or tests weakened. Therefore the earlier VPS03 **669 PASS / 36 Recovery09A FAIL** is historical, NOT today's test result. Current OOM prevented enumeration of those 36; it does not close them. PowerShell/native-host framing, timeout, cancel and roundtrip tests executed successfully in today's suite; original guard/concurrency unchanged.

Remaining test blocker: free sufficient local memory, then rerun the unchanged full suite. No general quality-gate harness created or run.
