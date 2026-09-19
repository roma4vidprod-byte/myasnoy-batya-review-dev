# VPS05 — remaining disaster-recovery gaps

`SSH_REDUNDANCY = PASS`

`OUT_OF_BAND_RECOVERY = NOT_PROVEN`

`REBOOT_ACCEPTANCE = BLOCKED_BY_OUT_OF_BAND_RECOVERY`

`DISASTER_RECOVERY_BACKUP = NOT_CONFIGURED`

The previous root bootstrap key expired at2026-09-16T16:29:25Z. Its public fingerprint matches the authorized entry. Effective policy for the actual client permits root/public-key/password login; neither password nor policy was changed. A new dedicated ED25519 rescue key was generated on Windows in `C:\Users\tasfo\Review-Activator-Access\vps05-root-rescue-20260919`. Its private file ACL permits only the current Windows user and SYSTEM; never copied/read into evidence. Only the public key was appended remotely, preserving the existing entry and reviewadmin. Options prohibit agent, port and X11 forwarding; PTY remains available. Fresh root and reviewadmin key logins passed.

Both identities still depend on the same SSH/network/host stack. They do **not** prove recovery from a firewall error, boot failure or disk loss. HipHosting console was previously blank/crashed; no independent rescue demonstration occurred. No reboot/power action was performed.

Backups reside on the same VPS. No off-host copy or encryption/key-escrow plan exists. Config inventories retain secret file hashes, not the secret material itself; role manifests omit password hashes. No full-server reconstruction, failed-disk recovery, credential restoration, HTTPS/cutover or real provider acceptance is claimed.

Support draft: `HIPHOSTING_RESCUE_REQUEST_RU.txt`, prepared locally and **not sent**. Next safe step is owner/provider confirmation and demonstration of independent console/rescue, plus a separately approved off-host backup strategy. Do not proceed automatically to reboot, worker, Yandex or cutover.

Separate old test gaps remain: VPS04A full OS-split coverage688PASS/36FAIL; Recovery09A/PGlite line-ending/hash mismatch and subsequent25P02 cascade. VPS05 targeted PASS does not close those failures or imply production readiness.
