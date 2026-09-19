# VPS07 disaster recovery — 2026-09-19

`PASS_OFF_HOST_DR / REBOOT_STILL_BLOCKED`

`DISASTER_RECOVERY = OFF_HOST_RESTORE_PROVEN` — **temporary Windows destination**, not continuous independent storage or a bare-metal recovery certification.

Start: `abcc2769e134636467a852a09957f10a2af07f13`, branch `codex/yandex-live-read-smoke-01`. Review Activator LAB only. No Cloud/Supabase/Vercel/provider operation. Existing 26 untracked files preserved.

## What was actually restored

1. Reused VPS05 `ops.backup()` for a fresh PostgreSQL 17.11 custom dump and release/schema/component manifests.
2. Added encrypted configuration, full selected systemd units/drop-ins, LAB runtime/worker/operations source and a cluster roles dump. Roles may contain password verifiers: they remain inside encryption and are not published or applied to the existing cluster.
3. AES-256-GCM encryption **on VPS** with a dedicated new backup key. No Yandex/JWT/DB key reused or changed.
4. Copied only ciphertext to the restricted Windows destination, closed and independently reopened it; verified exact size and SHA-256.
5. Returned that Windows copy and its externally held key to an isolated VPS area. Used the returned copy, not the original VPS dump.
6. Authenticated/decrypted in memory, verified every archive member and dump hash, restored into new `review_activator_dr_vps07` with PUBLIC CONNECT revoked.
7. Compared complete normalized schema (including owners/grants/policies), all table counts/digests, RLS/forced-RLS, role privilege restrictions and actual private-schema read denials.
8. Dropped only that newly-created test DB. Removed only the redundant returned key. Original LAB snapshot, three users/two reviews and health remained unchanged. Persistent key and all backups retained.

Schema normalization excludes only PostgreSQL-generated psql restriction token lines. No application/data exclusions. Separate database name/OID/database CONNECT ACL are intentionally not equated.

## Boundaries

The restore was a disposable database in the existing native PG17 cluster, whose existing roles were reused. Global role recreation, replacement host boot, application/config deployment from backup, and loss of both Windows and VPS are **NOT TESTED**. Included configs are hash-verified, not installed over active files. The archive is not a full disk image; OS packages/components must be reinstalled from the version manifest on a replacement machine. Provider account access and source checkout remain external requirements.

`OUT_OF_BAND_RECOVERY = NOT_PROVEN`

`REBOOT_ACCEPTANCE = BLOCKED_BY_OUT_OF_BAND_RECOVERY`

See [off-host backup](VPS07_OFFHOST_BACKUP.md), [keys](VPS07_RECOVERY_KEYS.md), [provider recovery](VPS07_PROVIDER_RECOVERY.md), [reboot](VPS07_REBOOT_ACCEPTANCE.md), [tests](VPS07_TEST_EVIDENCE.md), [final evidence](evidence/vps07/VPS07_FINAL_REPORT.md).
