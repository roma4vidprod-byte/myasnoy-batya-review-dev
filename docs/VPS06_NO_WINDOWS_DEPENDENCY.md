# VPS06 — no Windows runtime dependency

| Runtime component | Server location |
| --- | --- |
| Entrypoint | `/opt/review-activator-lab/worker/vps06/tools/vps06/once.mjs --once` |
| Shared lifecycle | `/opt/review-activator-lab/worker/vps06/lib/server/single-sync-run.js` |
| Node | `/opt/node/bin/node` (24.21.0) |
| Native PG client | `/usr/lib/postgresql/17/bin/psql` (17.11) |
| Profile selectors | `/etc/review-activator-lab/worker.env` (root0600, no provider secrets) |
| Unix DB socket | `/var/run/postgresql`, database review_activator_lab, peer role review-activator |
| Unit/timer | `/etc/systemd/system/review-activator-worker.service` / `.timer` |
| Safe local status | `/var/lib/review-activator-worker/latest.json`, `success.json` |
| Monitoring | `/opt/review-activator-lab/ops/vps05/ops.py` |

Installed artifacts contain all imports required for execution: four JS/MJS source files plus module-type package.json. No npm install, PowerShell, local env, Desktop Commander, PuTTY, laptop-mounted path, local keyring or Windows file is required. Runtime source scan found **0 operational Windows dependencies**. Normal worker uses no SSH; SSH was only the development/acceptance administration channel.

Actual timer-triggered execution, independent PostgreSQL backends and separate systemd invocations prove server scheduling capability. The user's PC was not physically powered off as a test; that is not claimed. Timer does not wait for SSH/Windows input. Final timer intentionally disabled; server autonomy is a verified capability, not a claim that hourly business processing is currently enabled.

`WINDOWS_RUNTIME_DEPENDENCIES = 0`

`REAL_PROVIDER_SCHEDULER = OFF`

`REBOOT_ACCEPTANCE = BLOCKED_BY_OUT_OF_BAND_RECOVERY`

`DISASTER_RECOVERY = LOCAL_BACKUP_ONLY`

Backup/restore from VPS05 remains historical accepted evidence. VPS06 did not perform another restore, off-host backup, boot test or out-of-band rescue verification. Those gaps remain. The existing backup archive policy does not yet bundle this new worker release or new cluster-global role for full-host disaster rebuild; ordinary local DB backups capture LAB SQL changes. Do not label full DR solved.
