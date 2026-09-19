# PASS_VPS06_AUTONOMOUS_WORKER

Date2026-09-19. Start `fd44c0d5e3c721c739e16a4a252cae39d1f2d164`; branch `codex/yandex-live-read-smoke-01`. This report is committed with the VPS06 implementation; final SHA is the containing Git commit. No push. Original26 user-untracked files preserved by exact SHA-256; tracked start clean. Historical36 Recovery09A/PGlite failures not changed or relabeled PASS.

## Accepted capability

- Server-only entrypoint `/opt/review-activator-lab/worker/vps06/tools/vps06/once.mjs --once`, Node24.21.0.
- `review-activator-worker.service`: non-root user review-activator, explicit vps-lab + synthetic-vps06, oneshot, no restart loop.
- Persistent native psql backend / peer role; PG17.11 transaction advisory lock `(1380013908,6)`.
- Same queue/RPC lifecycle, shared JavaScript orchestration. LAB enqueue adapted; claim/complete/fail sources identical by hashes before/after.
- Native parallel worker refused with ALREADY_RUNNING. Native independent claimants use SKIP LOCKED. Duplicates0.
- Complete/fail once; duplicate/stale/null/foreign scope denied. No real reviews, sessions, clients or accounts processed.
- Failure/timeout/SIGTERM/SIGKILL rollback and lock release proven. DB unavailability tested in isolated socket namespace, not by stopping DB.
- Timer fired autonomously with temporary 2-second calendar for one overlap acceptance. One7-second run remained the same invocation across timer deadlines; one completion.
- Final worker inactive/success. Timer inactive/disabled, runtime drop-ins removed, dormant template hourly/Persistent=false.
- New role is NOSUPERUSER/NOBYPASSRLS/NOCREATEDB/NOCREATEROLE/NOINHERIT, RLS/column-restricted. No Auth/review/session/cron access.
- OS boundary: PrivateNetwork, AF_UNIX only, IPAddressDeny=any. No provider imports or provider secrets in installed graph.

`SYSTEMD_SCHEDULER_CAPABILITY = PASS`

`REAL_PROVIDER_SCHEDULER = OFF`

`WINDOWS_RUNTIME_DEPENDENCIES = 0`

## Final application and operations

healthz200, readyz200; Auth/PostgREST/Node/PostgreSQL still active, originalbootID unchanged. Public TCP onlySSH22; DB/Auth/API/Node loopback only.

Existing LAB preserved by all-table count/digest comparison. Final users3/reviews2/companies2/locations2; connections0/runs0/sessions0/cron_jobs0. All VPS06 fixture rows removed.

Existing monitor actually detected injected worker failure, then PASS after a successful empty execution. It observes last execution/success, result, timer state and lock refusal; never invokes worker. Existing backup and monitor unit hashes unchanged; both timers remain enabled, daily03:30UTC and5minutes respectively. Backup retention deletion stays disabled. No new restore is claimed. New worker source/role is not included in the older VPS05 full-host disaster-reconstruction coverage.

## Exact final gates

| Gate | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: |
| Windows relevant Node regressions |90|0|0|
| Linux new worker Node regressions |30|0|0|
| Windows Python ops/monitor/observation |47|0|0|
| Linux Python ops/monitor/observation |47|0|0|
| Actual PG17/systemd distinct native scenarios |27|0|0|
| Source/fixture checks |127|0|0|

Diff-check PASS; established credential-pattern scan0 unresolved findings (two pre-existing reviewed synthetic markers remain classified explicitly). Installed runtime hashes match local source; original26 user-untracked hashes unchanged. No generic QUALITY GATE/REGRESSION HARNESS or unrelated full-suite repair.

Initial CHDIR install failure and test-observation failure are preserved in VPS06_FAILURES.json. Linux test-staging omission of two unchanged unit fixtures was corrected; final run40/40 passed. Those failed attempts are not claimed successful.

## Actual effects and boundaries

VPS-only: one transactional schema/role install; one peer role; scoped RLS/grants; LAB adaptation of existing enqueue; dedicated service/timer/source; monitor extension; temporary test units/overrides and RPC permission-fault injection (restored); disposable synthetic row creation/processing/cleanup. These **are** local VPS writes, not zero DB mutations. Timer test activation1; final real-business schedulingOFF. Safe operational/evidence files retained root-only on VPS.

Yandex GET0; Yandex writes0;2GIS0;email0;Telegram0;paidAI0;promo external0;Supabase Cloud writes0;Vercel writes0;BusinessOS0;Production0;push0;reboot0;SSHchanges0;UFWchanges0;newbackup/restore0. No public listener added. PRODUCTION UNTOUCHED=YES.

## Remaining limits / next safe step

No blocker remains for the requested synthetic worker acceptance. Provider/business execution remains unauthorized and disabled. A future provider-worker gate must separately review provider/session readiness, transaction/lease design, limits and explicit live permission. Do not simply enable the timer with live credentials.

`REBOOT_ACCEPTANCE = BLOCKED_BY_OUT_OF_BAND_RECOVERY`

`DISASTER_RECOVERY = LOCAL_BACKUP_ONLY`

Out-of-band recovery and off-host full disaster recovery remain unproven. Recovery09A runtime remains BLOCKED/SUPERSEDED; historical migrations retained. Stop after VPS06; do not proceed to Yandex.
