# VPS07 reboot acceptance

`REBOOT = NOT_RUN`

`REBOOT_ACCEPTANCE = BLOCKED_BY_OUT_OF_BAND_RECOVERY`

The web console page/canvas exists but the inspected console area was black; no guest hostname/login prompt or working keyboard path was established. A failed browser locator action is not proof of guest input. Rescue configuration/rollback is unverified. Two working SSH keys do not satisfy the OOB requirement.

Current read-only checks: reviewadmin and root-rescue SSH PASS, strict previously pinned host key; original boot ID unchanged. UFWactive22/tcp v4/v6 only; PostgreSQL/Auth/PostgREST/Node active; healthz200/readyz200. SSH service is socket-activated: `ssh.service` active with UnitFileState disabled, **ssh.socket enabled+active**. PostgreSQL wrapper service enabled, cluster enabled-runtime. No enable/disable changes made.

Existing monitor timer active/every5min; local backup timer active/daily03:30UTC; worker timer disabled/inactive. No off-host timer created. No pre-reboot readiness claim while OOB remains unproven.

After a future independently proven console/recovery path, recheck both SSH identities, recorded fingerprint, firewall/socket/service enablement, current LAB digest, timers and backup/key retrieval. Only then request/use applicable permission for one normal reboot. If recovery fails, stop; do not reinstall, reset passwords, power-cycle or overwrite LAB as an improvisation.

`VPS07_REBOOT_PRE.json` records a blocked gate/current observations, not permission to reboot. `VPS07_REBOOT_POST.json` explicitly records NOT_RUN, no fabricated after-reboot tests.
