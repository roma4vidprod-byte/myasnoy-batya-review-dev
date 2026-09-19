# VPS05 — exact tested isolated restore

Scope: synthetic `review_activator_lab` on `hiplet-120706` only. This is **not** a production restore or permission to overwrite LAB. Do not run this against Cloud. No application service configuration is switched.

## Tested archive

`/var/backups/review-activator/20260919T104112055116Z/review_activator_lab.dump`

SHA-256: `87aaeccb46a948a966dbb73b61a043c52b2d2dd3efba23149dc2017ac223cc53`

Owner root:root, mode0600, size451672 bytes; containing directory0700. Native pg_dump/pg_restore17.11; source server170011. The archive stays on the VPS. Never inspect or publish its contents.

## Operator procedure

Use the existing verified reviewadmin SSH identity and sudo. Check the manifest metadata and verify this known archive hash without reading its content into output:

```sh
sudo sha256sum /var/backups/review-activator/20260919T104112055116Z/review_activator_lab.dump
sudo stat -c '%U %G %a %s' /var/backups/review-activator/20260919T104112055116Z/review_activator_lab.dump
```

The **already executed** controlled operation was:

```sh
sudo flock --nonblock /var/lib/review-activator-ops/backup.lock python3 -B /opt/review-activator-lab/ops/vps05/ops.py restore --manifest /var/backups/review-activator/20260919T104112055116Z/manifest.json
```

Do not repeat merely to regenerate evidence: the existing restore report is exclusive-create, deliberately preventing overwriting the proof. A future exercise needs separately preserved/new evidence paths and an explicit operator action. Do not delete reports to bypass this safeguard.

The operation performs these exact stages:

1. Fixed-host/root/PG17.11/LAB-version checks, strict manifest path, file ownership, mode and SHA validation.
2. Verify the source snapshot still matches the backup's synthetic snapshot and disk budget. Refuse an existing target `review_activator_restore_test` rather than dropping it.
3. Create that separate DB from template0, owner postgres; revoke PUBLIC database access. No active service points to it.
4. Root opens the archive; `pg_restore --exit-on-error --single-transaction --no-password -h /var/run/postgresql -p 5432 -d review_activator_restore_test` reads the inherited stdin under postgres. No `--create`, `--clean`, `--no-owner` or `--no-acl`; source ownership/ACLs are preserved.
5. Compare source/restored schema SHA, all41 table counts and row digests, schemas5, functions32, constraints175, indexes123, version and synthetic-scope predicates.
6. Verify public/private RLS; FORCE RLS on both review_private tables; Auth ownership by supabase_auth_admin versus app ownership by postgres. Verify all five actual Auth/API runtime roles lack SUPERUSER/BYPASSRLS/CREATEDB/CREATEROLE. Check private/recovery/auth/raw-payload ACLs. Execute private SELECT refusal for anon/authenticated/service_role and no-subject RLS SELECT returning zero rows.
7. Drop **only the newly created disposable target**, without force. Confirm it is absent. Compare source snapshot again and request fixed local `/healthz` and `/readyz` (both200). Keep both backups.

On a failed restore, cleanup still targets only that fresh DB. Unexpected timeout/cleanup failure must be investigated read-only; never force-drop an unknown database. Errors contain fixed safe stage/code only, not SQL payload or stderr.

## Fingerprint semantics

Schema SHA `d31e942ec7f3af2e0323652ba52ac3f603d45cb0daa57d73c2b7dbabaec17558` matches source and restored DB. Canonical pg_dump schema output includes owners, grants, constraints, indexes, policies and functions. Only random psql `\restrict`/`\unrestrict` control-token lines and CRLF serialization are normalized. SQL/comment content is not discarded. Database name, OIDs and database CONNECT ACL are distinct for the isolated target and not compared. Object ACLs are compared.

All table row data is hashed **inside PostgreSQL**, with stable sorted row digests; no plaintext Auth/session rows leave the DB. No volatile columns were excluded. Source, restored and source-after snapshots were equal. Auth users3, reviews2, Auth migrations70; no connections/session credentials/sync runs/cron jobs.

## Future actual-disaster restore — NOT TESTED

Requires an off-host protected backup, trusted host/rescue access, pinned component installation, reviewed cluster role recreation, secure restoration of secret configuration, private/public key continuity, networking and application cutover verification. These steps are not covered by this test or authorized for execution. The safe role/config manifests alone cannot restore credentials. See `VPS05_DISASTER_RECOVERY_GAPS.md`.
