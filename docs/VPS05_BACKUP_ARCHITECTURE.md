# VPS05 — synthetic LAB local backup

Date: 2026-09-19. Starting source: `9ed33228bdde2d79b97f4689dacb09d85c03f2e2`, branch `codex/yandex-live-read-smoke-01`. Application release remains `vps04-initial`. This stage installs operational tooling only, not a new review/auth/queue engine.

## Scope and storage

Only `review_activator_lab` on `hiplet-120706`, PostgreSQL 17.11 (`170011`). No Cloud database access. Host/root/database/version guards refuse other environments. Synthetic users=3, reviews=2, companies/locations/admins=2 each. Connections, Yandex sessions, runs, cron jobs and other application business tables remain empty.

`/var/backups/review-activator/<UTC timestamp>/` is root:root 0700. Files are 0600. Auth password/session hashes in the custom database archive remain sensitive: never copy these archives into Git, ordinary reports or chat. No private keys are included in the release archive. The database backup is unencrypted at rest, protected by OS permissions; this is a documented limitation, not a claim of encrypted disaster recovery.

Each completed backup contains:

- `review_activator_lab.dump`: PostgreSQL17 custom archive, preserving data, owners and object ACLs.
- `release.tar.gz`: only the ten files verified against the existing release manifest, plus that manifest.
- `configuration.json`: service accounts/paths/states and allowlisted structural unit directives; secret configuration is represented only by path, numeric owner, mode, size and SHA-256.
- `VPS04_COMPONENTS.json`, `VPS04_SCHEMA.json`: existing pinned component and migration provenance.
- `manifest.json`: UTC time, versions, sizes, hashes, source schema fingerprint, per-table counts and server-computed row digests, safe role attributes and memberships. No role password hashes.

The complete secret-bearing `/etc/review-activator-lab` content is deliberately **not** backed up here. Systemd inline environment/commands are not blindly exported; exact source unit hashes and safe structural projections are retained. This permits the tested same-cluster database restore and release verification, not unattended reconstruction of a new server. Missing credentials/configuration and cluster-global roles are explicit full-disaster gaps.

## Execution and guards

Implementation: `tools/vps05/ops.py`, deployed at `/opt/review-activator-lab/ops/vps05/ops.py`. PostgreSQL commands use fixed `/usr/lib/postgresql/17/bin` and local Unix peer authentication, with a sanitized environment. No DB password, network host or database name is accepted from an operator argument. The restore manifest path is constrained beneath the root-only backup directory.

Before creating any archive, free space must exceed **5 GiB + 2 × current DB size + 256 MiB**. Check after dump additionally requires 5 GiB remaining. Source row/schema snapshot must be unchanged during the backup. An interrupted/incomplete directory has no completed manifest and is not accepted for restore. No automatic retention deletion exists.

The fixed synthetic row guards intentionally stop backups if this LAB scope changes. Review and separately authorize a broader operational profile before introducing additional real/synthetic application data. Do not weaken this guard to conceal a scope change.

`review-activator-backup.service` was actually executed successfully after the manual restore gate. It is root-only with `NoNewPrivileges`, a read-only system except backup/status paths, Unix/kernel-local address families, no external network, 384 MiB memory cap, 50% CPU quota and idle I/O priority. Only `CAP_SETUID`/`CAP_SETGID` are bounded and ambient: they permit `runuser` to become postgres for peer authentication. It cannot restart/stop the application on failure. A nonblocking file lock prevents overlap.

`review-activator-backup.timer`: enabled, daily **03:30 UTC**, `Persistent=false`. First calendar run is 2026-09-20; it has not yet happened at acceptance. The service itself has been tested. No provider/business scheduler was enabled.

## Evidence and limitations

Manual dump: 451672 bytes, SHA-256 `87aaeccb46a948a966dbb73b61a043c52b2d2dd3efba23149dc2017ac223cc53`.

Manual service-validation dump: 451672 bytes, SHA-256 `596fa204195064bdfa5f2cef5a0bad974fc14b57fd1da88e8d65b4576986680a`.

These are two separate archives. Only the first was used for the actual disposable restore; the second proves the hardened service execution path. Archive hashes may differ despite equal logical source snapshots. See `evidence/vps05/VPS05_BACKUP.json` and `VPS05_BACKUP_SERVICE_RUN.json`.

`LOCAL_BACKUP_ONLY`; `DISASTER_RECOVERY_BACKUP = NOT_CONFIGURED`.

References checked: [PostgreSQL17 pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html), [PostgreSQL17 pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html). Custom format supports restoration through pg_restore; cluster-global roles are outside a single-database dump. The safe role manifest does not export passwords or automatically recreate roles.
