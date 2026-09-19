# VPS06 — systemd capability, business scheduler OFF

Installed `/etc/systemd/system/review-activator-worker.service`: Type=oneshot, User/Group=review-activator, Restart=no, TimeoutStartSec25, TimeoutStopSec5, KillMode=control-group. Node watchdog20s; PG statement timeout10s, idle-in-transaction timeout15s. StartLimitBurst60 per60s bounds excessive manual activation; there is no automatic restart.

Hardening: PrivateNetwork=yes, AF_UNIX only, IPAddressDeny=any, empty capability set, NoNewPrivileges, ProtectSystem=strict, ProtectHome, kernel/control-group protections, private temp, 128MiB, 32tasks. No listening socket. Writable operational state only `/var/lib/review-activator-worker` (0700); report files0600. Root-only environment file has only two nonsecret synthetic profile selectors. Source directories755/files644 are traversable by the service user; secret dirs are not relaxed.

## Timer acceptance and final state

- Timer initially installed disabled.
- Native manual scenarios passed before timer testing.
- Temporary **runtime** drop-in: `OnCalendar=*-*-* *:*:0/2`, `AccuracySec=100ms`; no boot enablement. It was started only for synthetic acceptance.
- Timer started a worker with a7s synthetic delay. More than two timer deadlines passed while the same InvocationID remained `activating`. One completion, no duplicate business processing.
- A separate concurrent unit also proved the PG lock; systemd alone is not assumed to cover every entrypoint.
- Runtime test drop-in removed, timer stopped and disabled. Final template: `OnCalendar=hourly`, `Persistent=false`, accuracy1s. This is a dormant configurable template, not an active business schedule.
- Final worker service inactive/success, timer inactive/disabled. An inactive completed oneshot is healthy, not a stopped daemon failure.

`SYSTEMD_SCHEDULER_CAPABILITY = PASS`

`REAL_PROVIDER_SCHEDULER = OFF`

The existing backup timer remains daily03:30UTC, enabled; monitor timer remains every5min, enabled. Their unit hashes are unchanged. No SSH/UFW/public-port/app-service changes or reboot.

## Observed test corrections

Initial install: restrictive installer umask made new source directories root-only, causing systemd200/CHDIR before work. Explicit source755/file644 fixed this without relaxing secrets. Initial test report retained.

Initial duplicate-unit assertion compared InvocationID after completed oneshot unload, when systemd clears it. Corrected measurement compares while activating and then verifies exactly one completed run. This was a test-observation defect, not evidence of duplicate execution. Original report retained.
