# PASS_OFF_HOST_DR / REBOOT_STILL_BLOCKED

2026-09-19. **Temporary encrypted Windows fallback**, not a permanent independent storage service.

## Git and scope

Start `abcc2769e134636467a852a09957f10a2af07f13`, branch `codex/yandex-live-read-smoke-01`. Final SHA is the commit containing this report, returned separately after commit. Initial tracked tree clean; original26 user untracked files preserved by full SHA-256. No reset/clean/push. Business OS working directory not used for changes.

Changed: scoped extension of existing `tools/vps05/ops.py`; new VPS07 crypto/export/retrieved-restore/one-time-transfer/acceptance/test helpers; six VPS07 runbooks and evidence. No business runtime, schema, provider, Cloud or worker modification.

## Provider recovery and SSH

Panel inspected read-only. Console tab/canvas exists, black inspected area; guest identity/input NOT_PROVEN. Rescue/ISO/serial configuration and rollback UNKNOWN. Visible power-off/soft-reboot/forced-reboot/password-reset/reinstall controls not used. Snapshot/provider-backup availability not proven; provider docs conflict. Safe support request prepared in VPS07_PROVIDER_RECOVERY.md, not sent.

reviewadmin and root-rescue SSH both PASS with strict existing pinned fingerprint. They are **SSH redundancy only**. `OUT_OF_BAND_METHOD = NOT_PROVEN`.

Panel security caveat: a provider page inspection incidentally displayed its existing root credential. No value is repeated or saved in source/evidence; it was not used/reset. New backup key and secret-bearing backup contents were never displayed. No blanket zero-exposure claim for the panel credential.

## Encrypted off-host copy

Destination `C:\Users\tasfo\Review-Activator-Recovery\VPS07-20260919\archives\backup.aead`.

AES256-GCM, dedicated new key retained separately outside VPS in the protected sibling keys directory; VPS key root0600/parent0700; Windows current-user+SYSTEM only. No AES/JWT/Yandex/DB application keys changed.

Size747570 bytes. SHA256 `633e55169fef7fc0176ed39b7975e6f3b4d2ab3e8f6bcc5eca8fff2f9c541072`. Whole-file Windows readback and returned-copy hash PASS. Original source ciphertext and local backups retained, no retention deletion.

Included dump, full selected unit/drop-in configuration, component/version/schema/release manifests, LAB env/config, worker/ops source, encrypted cluster roles. No SSH private key or the backup's own decryption key included.

## Actual native disaster restore

Returned Windows ciphertext + externally held key -> authentication PASS -> dump/member hashes PASS -> disposable `review_activator_dr_vps07` on PostgreSQL170011 -> restore PASS.

Normalized schema SHA `420f8b753181b089e466ae8a18f02ed89fcc44435c678a31b8afa008071e4af1` matches; full all-table digests/counts, owners, grants, policies, RLS/forced-RLS and real private SELECT denials PASS. Source LAB remains3users/2reviews/2companies/2locations; connections/runs/sessions/cron0. Original full snapshot unchanged. Only test DB and redundant returned key removed; both persistent key copies and ciphertext remain.

`DISASTER_RECOVERY = OFF_HOST_RESTORE_PROVEN` within this explicit scope. Full replacement-host boot, fresh-cluster global-role restoration and live installation of archived configurations NOT_RUN. Existing cluster roles reused; global roles backup encrypted but not executed.

## Monitoring / automation / application

Existing monitor now reports key/config metadata, receipt status, full-hash verification, restore success and last verified off-host age. Native monitor PASS. No secret-content read by monitor and no live Windows presence probe. Receipt older36h deliberately becomes stale.

Local backup timer remains enabled/active daily03:30UTC; monitor every5minutes active. Existing backup/monitor unit hashes unchanged. Off-host automation NOT_CONFIGURED, no new timer. Worker timer remains disabled/inactive; autonomous synthetic worker capability retained, real provider schedulerOFF.

healthz200, readyz200, PostgreSQL/Auth/PostgREST/Node active. UFWactive only22/tcp IPv4/IPv6; all app/DB/Auth/API listeners loopback. SSH active via enabled `ssh.socket`; disabled ssh.service UnitFileState is not interpreted as missing socket enablement. Boot ID unchanged.

## Exact gates

| Gate | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: |
| Windows VPS07 |28|0|0|
| Linux VPS07 |28|0|0|
| Windows existing VPS05 |40|0|0|
| Linux existing VPS05 |40|0|0|
| npm check |127|0|0|

Actual retrieved-copy restore PASS; three actual encrypted-backup negative checks PASS (wrong key/corruption/hash mismatch). Installed source hashes match; original26 untracked hashes unchanged. Diff-check and existing secret-pattern scan PASS (0 unresolved; two historical synthetic markers explicitly classified). Historical36 Recovery09A failures not relabeled or fixed. Full suite and generic harness NOT_RUN.

## Actual effects

VPS/local infrastructure writes **did occur**: one fresh LAB backup, one ciphertext archive, one Windows off-host copy/readback, one returned-copy restore, one disposable database created+dropped, one dedicated new backup key with two persistent copies, one redundant returned key removed, VPS07 source installed, existing monitor source extended with old source preserved, safe reports written. Existing monitor manually executed once; its usual timer remains unchanged. No plaintext secret-bearing config extraction to disk.

Yandex reads0/writes0;2GIS0;email0;Telegram0;paidAI0;promo0;CloudSupabase writes0;Vercel writes0;BusinessOS0;Production0;worker runs0;worker timer changes0;provider panel mutations0;packages installed0;SSH/UFWchanges0;reboot0;powercycle0;push0.

`PRODUCTION UNTOUCHED = YES`

## Remaining blockers and next safe step

1. OOB console identity/input and rescue rollback unproven. `REBOOT_ACCEPTANCE = BLOCKED_BY_OUT_OF_BAND_RECOVERY`; reboot NOT_RUN. Prepared support request is the next safe action, not a reboot.
2. No durable authorized independent storage or separate offline key escrow. Current Windows copy survives VPS loss but not joint VPS+Windows loss; no unattended off-host guarantee. Choose/authorize a destination separately before automated upload.
3. Full-host disaster reconstruction remains outside demonstrated disposable-DB restore.

Stop here. No Yandex/business scheduler/production cutover follows this partial acceptance.
