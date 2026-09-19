# VPS07 off-host backup

The owner confirmed no independent storage account exists. Used explicitly permitted temporary Windows fallback; no subscription, bucket, second server or paid service created.

- Off-host ciphertext: `C:\Users\tasfo\Review-Activator-Recovery\VPS07-20260919\archives\backup.aead`
- VPS original ciphertext: `/var/backups/review-activator-dr/20260919T123103599119Z/backup.aead`
- Returned copy: `/var/backups/review-activator-dr/retrieved-vps07/backup.aead`
- Size: **747570 bytes**.
- SHA-256: `633e55169fef7fc0176ed39b7975e6f3b4d2ab3e8f6bcc5eca8fff2f9c541072`.
- NTFS parent ACL protected, current user and SYSTEM only; child files inherit only these entries. VPS directories root0700/files0600.
- Full independent readback, returned-copy authentication, dump hash and restore: PASS.

## Implementation

`tools/vps07/crypto_backup.py` uses installed trusted `cryptography` AESGCM: 32-byte random key, fresh 12-byte nonce, full 16-byte authentication tag, fixed version header as AAD. Container: `MAGIC || nonce || ciphertext-and-tag`. Maximum payload64MiB. This is a bounded LAB export, not a streaming large-database solution. Authentication completes before parsing plaintext; archive read stays in memory, rejecting unsafe paths, links, duplicate members and mismatched inventory hashes.

`tools/vps07/dr.py` is a fixed-host adapter around existing VPS05 backup/restore/snapshot/ACL routines. It does not introduce a second business or backup scheduling engine. `windows_transfer.py` is one-time administration only; it uses pinned strict SSH and private binary stdin for key transfer, never key arguments. `acceptance.py` gathers safe evidence and invokes only the existing local monitor.

References: [cryptography AESGCM API](https://cryptography.io/en/latest/hazmat/primitives/aead/), [HIP backup documentation](https://hip.hosting/en/docs/how-to-back-up-your-server). Installed versions: Linux cryptography41.0.7 from Ubuntu package, Windows50.0.1 bundled runtime. No new software installed.

## Automation design — deliberately NOT enabled

Local backup remains daily03:30UTC, deletion retention disabled. Off-host timer: **NOT_INSTALLED / NOT_CONFIGURED**, because no durable authorized destination/credentials exist. Windows is not used as a scheduled runtime dependency.

For a separately approved independent S3/server target, reuse this sequence: existing local backup success -> remaining-disk guard -> authenticated encryption -> destination upload -> readback size/full hash verification -> atomic safe receipt. Any failure must produce a failed service/result and monitor code; it must not replace last verified success or delete local backups. Never mark success from an upload response alone. No destructive retention. Destination, credentials, schedule, retry policy, larger-backup tooling and recovery-key escrow require explicit separate approval before implementation/activation.

## Monitoring semantics

Existing five-minute monitor now observes `VPS07_OFFHOST.json`, key **stat only** (root/0600/32 bytes), receipt/config presence, last verified receipt age, hash and restore result. Invalid/missing/stale (>36h) evidence is a failure. It does not read the key, contact Windows, upload, restore, or run worker. `remote_presence=NOT_LIVE_CHECKED`: evidence is the last verified transfer, not a guarantee that the Windows file still exists. Manual copy will become stale without another approved transfer; this is intentional, not continuous DR readiness.
