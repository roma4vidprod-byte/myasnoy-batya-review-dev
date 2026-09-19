# VPS05 — actual closeout

**PASS_VPS05_LOCAL_BACKUP_RESTORE**

**PASS_VPS05_MONITORING**

Not production-ready. Reboot and disaster-recovery limitations remain open.

## Git and preservation

Starting HEAD `9ed33228bdde2d79b97f4689dacb09d85c03f2e2`, branch `codex/yandex-live-read-smoke-01`. Final local checkpoint is the commit containing this report; its actual SHA is returned in the task response. No push.

Only new `tools/vps05`, five VPS05 documents, this stage's evidence and the local provider-support draft are included. Application/Recovery/native-runner/package files unchanged. All26 pre-existing untracked files retained byte-for-byte: original17 plus9 VPS04A documents/evidence. No reset/clean or restoration from remote main.

## Access

reviewadmin PASS; new dedicated root-rescue key PASS. Old root bootstrap key was expired, not a broken SSH service. One public-key append; existing keys, sshd policy, firewall and passwords preserved. New private key exists only under the Windows owner's restricted directory and was never printed or transferred.

SSH_REDUNDANCY=PASS. OUT_OF_BAND_RECOVERY=NOT_PROVEN. Same unchanged boot ID confirms no reboot.

## Backup and restore

Manual backup: `/var/backups/review-activator/20260919T104112055116Z/review_activator_lab.dump`,451672 bytes,root:root0600,parent0700.

SHA-256 `87aaeccb46a948a966dbb73b61a043c52b2d2dd3efba23149dc2017ac223cc53`.

PostgreSQL/pg_dump17.11,server170011; Auth2.196.0; PostgREST14.17; Node24.21.0. DB custom archive and verified release archive retained; secret config exported only as metadata/hashes. Safe cluster role manifest contains no passwords/hashes.

One actual restore into fresh `review_activator_restore_test`: pg_restore exit0. Five schemas,41 tables,32 functions,175 constraints,123 indexes;70 Auth migration records. Users3,reviews2,companies/locations/admins2; connections/sessions/runs/cronjobs0. All table row counts/digests equal without volatile-field exclusions. Source/restored schema SHA:

`d31e942ec7f3af2e0323652ba52ac3f603d45cb0daa57d73c2b7dbabaec17558`.

Object ACLs, app RLS, review_private FORCE RLS and Auth/app ownership preserved. Five actual runtime roles have no SUPERUSER/BYPASSRLS/CREATEDB/CREATEROLE. Private SELECT denied for anon/authenticated/service_role; no-subject authenticated review SELECT=0. No recovery function invoked. Only disposable DB CONNECT ACL/name/OID differs intentionally; application object ACLs match.

Disposable target removed, not force-dropped. Original LAB snapshot unchanged. Both backup archives retained. Second archive was made by the hardened backup service as a manual service-validation run; its source snapshot equals the first. That second archive was not independently restored and is not mislabeled as a second restore test.

Final disk free37103779840 bytes; backup guard reserves at least5GiB plus a conservative dump budget. No retention deletion. Archive contains sensitive synthetic Auth hashes and remains root-only on VPS, never copied locally.

## Monitoring and timers

`review-activator-monitor.service/.timer`: enabled, every5min. Actual timer triggers observed10:51:28 and10:56:30UTC; latest monitor PASS. Checks cover disk/RAM/load, failed units, PG/Auth/API/Node, health/ready, listeners, backup age/growth. Fixed local HTTP only; no notifications or automatic repair.

`review-activator-backup.service/.timer`: service execution PASS; timer enabled daily03:30UTC,first calendar run2026-09-20,not yet observed. No missed-run catchup. No destructive retention. Initial failed service attempts and their narrow fixes retained in evidence.

No business/provider scheduler enabled. Public TCP remains22 only; DB/Auth/API/Node remain loopback-only. No failed units at final audit. healthz200/readyz200; release and secret-config hashes unchanged. Application service start timestamps predate this task; no app restart performed.

## Actual tests

- Windows VPS05:40PASS/0FAIL/0SKIP.
- Linux VPS05:40PASS/0FAIL/0SKIP, also checked from installed operational directory.
- Existing npm check:125PASS.
- Diff-check and credential-pattern scan:PASS,0 unresolved matches; two pre-existing synthetic markers reviewed by their exact hashes.
- User/source/deployed operational hash preservation:PASS.

No generic quality/regression harness. Full724 suite not rerun for standalone ops changes. Prior VPS04A688PASS/36FAIL remains historical/unresolved, not silently cleared.

## Effects

Authorized effects: one new Windows rescue keypair; one remote public-key append; two local sensitive backups; one disposable restore DB create/restore/verify/drop cycle; operational source/status artifacts; two services/two timers installed and enabled. Six short-lived read-only systemd diagnostic units auto-collected. Temporary staging directory removed; copies remain in repository/installed ops, backups retained. Local commit only.

Yandex reads0,writes0;2GIS0;email0;Telegram0;paid external AI0;promo0;Supabase Cloud writes0;Vercel writes0;Business OS0;Production0;push0;application restarts0;reboot0. LAB business writes0 (restore DDL/data writes were confined to the disposable database). Local health/readiness calls and safe PostgreSQL inventory reads were actually performed.

PRODUCTION_UNTOUCHED=YES.

## Remaining blockers / next safe step

REBOOT_ACCEPTANCE=BLOCKED_BY_OUT_OF_BAND_RECOVERY.

DISASTER_RECOVERY_BACKUP=NOT_CONFIGURED;LOCAL_BACKUP_ONLY.

Off-host storage, credential/config recovery and full-server reconstruction are not tested/configured. HipHosting support draft prepared but not sent. Next safe step: separately obtain and demonstrate provider console/rescue, then approve off-host protected backup strategy. No permission follows for reboot, Yandex, worker or cutover.
