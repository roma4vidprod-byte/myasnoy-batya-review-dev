# VPS05 — local-only monitoring

VPS06 extension (2026-09-19): optional worker/timer observations are now included when the dedicated unit is installed. This does not activate a worker. See `VPS06_FAILURE_MODEL.md` and actual `evidence/vps06/VPS06_MONITORING.json`. Existing backup/monitor timer definitions are unchanged.

`review-activator-monitor.service` and `.timer` are enabled. Timer: five minutes after boot and five minutes after activation, accuracy30s. These are **operational monitoring**, not review/provider scheduling.

Fixed checks: filesystem free>=5GiB; RAM available>=256MiB; one-minute load<=2×CPU count; no failed systemd units; PostgreSQL17/main, Auth, PostgREST and Node active; fixed loopback `/healthz` and `/readyz` return200; expected TCP listeners; backup growth<=5GiB and completed-manifest age<=36h.

Expected public TCP is22 only. Required internal listeners:127.0.0.1 ports5432/19999/13001/13000. Local resolver127.0.0.53/54:53 is allowed. Unknown loopback or public ports fail. SSH wildcard `*:22` and `[::]:22` are equivalent accepted renderings; wildcard database/application ports still fail.

No SQL, Auth login, provider request, notification, queue, worker or business-row mutation. Python HTTPConnection only reaches fixed127.0.0.1:13000 paths, without proxy, retries or redirects. Responses are reduced to status; body is not logged. Failure is represented by safe codes; unavailable HTTP status is null, not fabricated zero.

Service isolation: read-only system, secret-config directory inaccessible, root-owned state dir,128MiB memory,45s limit, nonblocking overlap lock, localhost-only IP policy. AF_NETLINK allows kernel-local socket inventory, not an external endpoint. Backup files are measured by size, not opened by monitoring. The status report is atomically replaced at `/var/lib/review-activator-ops/VPS05_MONITOR.json`, root0600, and the journal receives safe codes only.

## Failure regressions

Injected test fixtures detect health503, ready503, missing HTTP result, redirects, unexpected IPv4/IPv6/wildcard listener, missing required listener, low disk, failed service/unit, low RAM, high load, backup growth and stale/missing backup. No real LAB service was stopped for a failure test.

The initial hardened service run failed LISTENER_MISMATCH: without AF_NETLINK, `ss` fell back to procfs and rendered IPv6 SSH as `*:22`. Evidence preserved in `VPS05_MONITOR_INITIAL_FAILED.json`. Added AF_NETLINK and narrowly accepted SSH wildcard rendering, with regressions proving `*:5432` remains denied. Do not hide that first failure.

## Operational response

Inspect the safe status file or this service's journal. Do not publish auth journals, environment or private keys. Alert codes require operator review; monitoring never restarts components or repairs DB/state. A failed monitor or backup leaves a failed unit visible until a successful operator/systemd run. Off-host alerts and an external dead-host monitor are **not configured**. A dead VPS cannot report through this local monitor.

No retention deletion is enabled. Backup-size/age/free-space alerts make growth visible, but an off-host retention/alert plan still needs separate authorization.
