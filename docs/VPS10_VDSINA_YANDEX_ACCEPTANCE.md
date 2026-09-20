# VPS10 — VDSina real Yandex scheduler acceptance

Date: 2026-09-20
Status: **PASS_VPS10_REAL_YANDEX_SCHEDULER_ON_VDSINA**
Production cutover: **NOT PERFORMED**
Supabase Cloud / Vercel: **UNTOUCHED**
Yandex write operations: **0**

## Target VPS

- Provider/location: VDSina, Moscow, Russia
- IPv4: `83.217.214.29`
- Hostname: `v3248121.hosted-by-vdsina.ru`
- Ubuntu: 24.04.4 LTS
- Capacity: 2 vCPU / ~4 GiB RAM / 100 GB virtual disk
- Root ext4 expanded online to ~99 GB usable
- PostgreSQL: 17.11 from official PGDG
- Node.js: 24.21.0, official nodejs.org artifact with SHASUMS256 verification

## Network acceptance

A bounded no-HTTP comparison against `yandex.ru` completed before migration:

- DNS: 61/61 PASS
- TCP/TLS: 60/60 PASS
- 5.255.255.77: TCP 10/10, TLS 10/10
- 77.88.44.55: TCP 10/10, TLS 10/10
- 77.88.55.88: TCP 10/10, TLS 10/10
- Successful TLS version: TLS 1.3
- HTTP/provider requests during network diagnostic: 0
This contrasts with the old HipHosting VPS, where the repeated comparable
series showed severe TCP-connect loss. The old VPS remains intact and running.

## Migration and backend

A fresh custom-format PostgreSQL backup from the old VPS was transferred with
SHA-256 verification. Runtime/config/systemd assets were transferred separately.

Restored database pre-persistence state:

- schema version: `vps04-auth-api-v1`
- PostgreSQL server_version_num: `170011`
- synthetic auth users: 3
- synthetic reviews: 2
- encrypted Yandex sessions: 1
- Yandex session: READY, revision 4

The database-specific Auth role setting
`supabase_auth_admin ... search_path=auth` was restored explicitly because
it is not part of a normal database dump.

Active loopback services:

- PostgreSQL: 127.0.0.1:5432
- Auth: 127.0.0.1:19999
- PostgREST: 127.0.0.1:13001
- Foundation: 127.0.0.1:13000
- `/healthz`: 200
- `/readyz`: 200
## Real Yandex persistence

Controlled `manual-first` acceptance:

- pages: 4
- HTTP statuses: 200 / 200 / 200 / 200
- received: 72
- unique: 72
- pagination classification: STRICT_STABLE_COMPLETE
- pagination duplicates: 0
- scope validation: PASS
- contract validation: PASS
- inserted: 72
- updated: 0
- unchanged: 0
- session mutations: OFF
- Yandex writes: 0

Controlled `manual-replay` acceptance:

- received/unique: 72 / 72
- inserted: 0
- updated: 0
- unchanged: 72
- DB duplicates: 0
- session remained READY / revision 4

Current DB aggregate at acceptance:

- real Yandex reviews: 72
- synthetic reviews preserved: 2
- duplicate external review keys: 0
- with owner reply: 60
- without owner reply: 12
## VPS10 scheduler

New isolated units:

- `review-activator-yandex-sync.service`
- `review-activator-yandex-sync.timer`
- wrapper: `tools/vps10/provider_once.py`

The wrapper reuses the accepted private `session.mjs manual-replay` path.
It does not implement a second provider/parser/persistence engine.

Guards:

- root + exact hostname guard
- Yandex session must be READY / revision 4 before and after
- nonblocking file lock
- no automatic retry
- only HTTP 200 responses accepted
- scope/contract/pagination checks required
- DB synthetic rows and duplicate checks required
- safe root-owned monitoring receipt only
- no Yandex writes or notifications

Tests:

- Windows VPS10 validation tests: 7/7 PASS
- Linux VPS10 validation tests on VDSina: 7/7 PASS
- Python compile: PASS
- staging/runtime SHA-256: MATCH
- `systemd-analyze verify`: PASS
- manual service acceptance: PASS
- manual service result: unchanged 72/72, provider requests 4
- lock contention: ALREADY_RUNNING, provider requests 0
- receipt unchanged during lock contention: PASS
- provider-watch positive test: PASS
- provider-watch timer-off negative test: PROVIDER_TIMER_NOT_ACTIVE
- service restarts: 0

Scheduler state after acceptance:

- real Yandex timer: **active + enabled**
- cadence: hourly
- old VPS06 synthetic worker timer: **inactive + disabled**

## Backup, restore and monitoring

A sensitive backup containing the 72 real public reviews was created after
scheduler acceptance.

Latest accepted backup:
`/var/backups/review-activator/20260920T074029753450Z/manifest.json`

Restore acceptance against a separate temporary PostgreSQL database:

- restore command: PASS
- schema equal: PASS
- row counts/hashes equal: PASS
- RLS/ACL/security checks: PASS
- cleanup: PASS
- source DB unchanged: PASS
- health after restore: 200 / 200

The first attempt to record this final restore produced a false
`OPS_INTERNAL_FAILURE` only because an older immutable evidence file already
existed. The older evidence was archived, not deleted, and the same restore
was rerun successfully without weakening the no-overwrite guard.

Final local monitor: PASS, no failure codes.

VPS10 also installs a local `provider_watch.py` gate as `ExecStartPre`
for the existing 5-minute monitor. It performs no DB/provider access and
requires:

- real Yandex timer active + enabled
- last real Yandex service result = success
- last provider read/persistence receipt = PASS
- provider receipt freshness <= 3 hours

A stopped real timer was detected immediately as
`PROVIDER_TIMER_NOT_ACTIVE`; the timer was then restarted and the monitor
returned PASS.

## Network/security postflight

- UFW: active
- default inbound: deny
- default outbound: allow
- allowed inbound: SSH/22 only
- public listeners: SSH only
- Review Activator/PostgreSQL/Auth/PostgREST: loopback only
- preinstalled empty Docker/containerd runtime: disabled, packages not removed
- SSH host-key verification: enabled
- SSH password authentication: disabled
- root SSH login: public-key only
- fresh post-reload key login: PASS

The root password shared during setup was never used by the migration tooling
and is no longer accepted for SSH authentication.

## Remaining gates outside VPS10 ingestion

VPS10 completes autonomous hourly Yandex **read + database persistence** on the
new VDSina host. It does not perform a public/production cutover.

Still separate future gates:

- automatic operator workflow for expired Yandex session / re-auth
- public HTTPS/domain and admin UI cutover
- Yandex reply WRITE flow with explicit approval/audit
- permanent automated off-host DR for the new VPS
- old HipHosting decommission only after explicit cutover approval
