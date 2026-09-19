# VPS06 — acceptance evidence

2026-09-19, fixed synthetic LAB only. Baseline `fd44c0d5e3c721c739e16a4a252cae39d1f2d164`; original26 user untracked files preserved by SHA-256. No reset/clean/force/push.

## Actual final runs

- Windows Node relevant tests: **90 PASS /0 FAIL /0 SKIP**, `--test-concurrency=1` with existing no-network preload. Includes new30 worker tests and existing worker, review-sync, persistence writer/planner, VPS04 profile/backend and native-host guard regressions.
- Linux new Node worker tests: **30 PASS /0 FAIL /0 SKIP**.
- Windows Python: existing VPS05 **40 PASS**, new monitor **6 PASS**, duplicate-unit observation regression **1 PASS**: **47/47**, no failures/skips.
- Linux Python: same **40+6+1 =47/47 PASS**, no failures/skips.
- Native PostgreSQL17.11 + systemd: **18 primary +5 guard/exception +4 RPC edge cases =27 PASS**, no skipped cases. These are real backends/units, not PGlite or offline substitutions.
- `npm run check`: **127 PASS** (actual current run); diff and existing credential-pattern scan recorded in final checks.
- Full historical suite not rerun; historical688PASS/36FAIL Recovery09A/PGlite mismatch remains unresolved, not reclassified green. Generic QUALITY GATE/REGRESSION HARNESS not run.

## Preserved failures / corrections

1. Initial native empty_queue failed before worker execution: systemd200/CHDIR from installer umask. Corrected explicit public source directory modes; runtime/app secret permissions unchanged.
2. Subsequent native run passed9 scenarios, then the test incorrectly compared InvocationID after systemd unloaded the completed oneshot. Corrected measurement while activating; native duplicate count remained0. Original failed report retained.
3. First Linux VPS05 test staging omitted two existing unit definition files, causing2 FileNotFound errors. Copied unchanged fixtures; final40/40 PASS. No application fix was made for this test-packaging error.

## Evidence inventory

- `evidence/vps06/VPS06_WORKER.json`: actual primary native report, hashes, fixture cleanup.
- `VPS06_CONCURRENCY.json`: lock/claim/finalization/scope results and native RPC edges.
- `VPS06_TIMER.json`: actual short-lived calendar activation/overlap and final disabled state.
- `VPS06_FAILURES.json`: final safe failures plus original failed acceptance reports.
- `VPS06_MONITORING.json`: actual failure detection/recovery, LAB preservation, health/listeners/role/timers.
- `VPS06_FINAL_CHECKS.json`: local gates, secret scan, original file preservation, installed hash comparisons.
- `VPS06_FINAL_REPORT.md`: consolidated result and remaining limits.

All pre-existing table counts/digests compare equal to before installation. Synthetic fixture removed: companies/locations/admins/reviews2 each, Auth users3, connections/runs/sessions/cron jobs0. Claim/complete/fail function definition hashes unchanged. App healthz/readyz200; public TCP22 only. Backup/monitor units unchanged, backup and monitor timers remain enabled. Boot ID unchanged.

No provider/Cloud/production acceptance is implied. No real Yandex/2GIS request, reply, email, Telegram, paid AI, promo, Supabase Cloud write, Vercel action, SSH/firewall change or reboot was performed.
