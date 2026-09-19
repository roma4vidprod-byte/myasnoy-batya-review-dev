# VPS05 — actual acceptance evidence

2026-09-19. Application baseline9ed33228bdde2d79b97f4689dacb09d85c03f2e2. No application source, Recovery SQL, UTC fixture or native runner changed. Prior17 untracked files and all uncommitted VPS04A evidence are preserved by hash inventory.

## Actual results

- VPS05 targeted Python tests: **40/40 PASS on Windows;40/40 PASS on Ubuntu**. No skip/failure in final runs. Tests mock external boundaries; real restore evidence is separate.
- Existing `npm run check`: **125 PASS**, parse-only; no external calls.
- Native PostgreSQL17.11 custom backup actually created; root-only permissions verified.
- Actual single-transaction restore into fresh separate DB: exit0; schemas5/tables41/functions32/constraints175/indexes123 preserved. All table count/digest and schema comparisons equal.
- Runtime privileges/private ACL/recovery exclusion/RLS/ownership PASS. Three actual private SELECT attempts refused; no-subject authenticated read returned0.
- Disposable restore database removed; original LAB unchanged. No app restart or secret/config/key mutation.
- `/healthz`=200, `/readyz`=200 after restore. Providers/queue/worker remain absent.
- Monitor and backup units both successfully executed inside their hardened systemd boundaries. Dedicated timers enabled only after the manual backup/restore PASS. Daily scheduled firing itself is future, not claimed as already executed.
- Diff/secret scan and preservation evidence: `evidence/vps05/VPS05_FINAL_CHECKS.json`.

## Preserved initial failures

Monitor: initial LISTENER_MISMATCH from procfs wildcard representation; fixed with AF_NETLINK and narrow SSH-wildcard support, regressions included.

Backup service: initial SQL_FAILED atGUARD before creating another dump. Read-only launch isolation proved explicit `User=root` plus NoNewPrivileges lacked effective UID-switch capability on this system (`runuser: cannot set user id: Operation not permitted`). The same Unix read worked without explicit User, and with explicit User plus bounded/ambient CAP_SETUID+CAP_SETGID. Final unit keeps explicit root, NoNewPrivileges, filesystem/network restrictions, and only those two capabilities; actual backup service then passed. No PostgreSQL grant or HBA change was made. Safe failure evidence is preserved; not counted as a successful run.

## Evidence files

`VPS05_BACKUP.json` (manual archive), `VPS05_BACKUP_SERVICE_RUN.json` (second archive through unit), `VPS05_RESTORE.json`, `VPS05_SCHEMA_COMPARE.json`, `VPS05_MONITOR.json`, `VPS05_MONITOR_INITIAL_FAILED.json`, `VPS05_ACCESS_REDUNDANCY.json`, `VPS05_FINAL_CHECKS.json`, `VPS05_FINAL_REPORT.md`.

Full724 coverage was not rerun: only new standalone operational tooling/tests were changed. Historical688PASS/36FAIL remains unresolved and is not relabeled green. Native09/09A gates and generic quality/regression harness were not run.

No Yandex/2GIS, Cloud DB, Vercel, email, Telegram, paid AI, promo, production or Business OS operation was performed. Readiness makes fixed local dependency reads only. Reboot remains blocked and off-host disaster recovery is not configured.
