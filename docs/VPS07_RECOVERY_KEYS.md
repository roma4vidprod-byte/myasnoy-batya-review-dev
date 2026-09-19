# VPS07 recovery keys — no secret values

New dedicated random AES256 backup key was generated once. It is not a login credential and does not replace application/Yandex/JWT/PostgreSQL keys.

- Outside VPS: `C:\Users\tasfo\Review-Activator-Recovery\VPS07-20260919\keys\backup.key`, current user/SYSTEM NTFS ACL only.
- On VPS: `/etc/review-activator-dr/backup.key`, root0600, parentroot0700.
- The recovery test used a copy returned from Windows in `/var/backups/review-activator-dr/retrieved-vps07/recovery.key`. This redundant returned copy was removed after success; persistent copies remain.
- The backup key is deliberately **not** inside its own archive. No new key bytes printed, placed in command arguments, Git, reports, browser or clipboard.
- Do not open/print these files in chat or logs. Do not rename/regenerate/overwrite the key to retry decrypt. Preserve the key and ciphertext together as an operational set, but arrange a separately approved offline/vault key copy for durable DR.

## Loss scenarios

| Failure | Required external assets / remaining limitation |
| --- | --- |
| VPS disk lost/unavailable | Windows ciphertext + backup key + source/tools + version manifest + provider account + approved replacement host. DB restore proven; full-host rebuild not performed. |
| reviewadmin SSH key lost | Existing independently held root-rescue SSH key currently works. This is SSH redundancy, not out-of-band recovery. |
| root-rescue key lost | Existing reviewadmin key works with sudo. Provisioning any replacement access needs a separate explicit action. |
| Both SSH paths unavailable | Provider console/rescue must first be proven; currently BLOCKED. Do not reboot/reset/reinstall to discover its behavior. |
| Windows and VPS lost together | Current arrangement insufficient; durable independent storage and separate key escrow not configured. |
| Backup key lost everywhere | AESGCM backup is unrecoverable; no recovery-by-reset or brute force. |

Provider account access/MFA and SSH private keys were not added to the archive. Filesystem ACL protection is confirmed; full-disk encryption on Windows is NOT VERIFIED. Protect this computer and do not delete the recovery folder.

## Browser observation caveat

The provider panel automatically exposed its existing root login credential in one tool-generated page inspection. It was not used, changed, copied into source/evidence, or repeated in the report. Consequently this task does **not** claim a blanket zero-exposure result for pre-existing panel credentials. No newly generated backup key or secret-bearing backup content was displayed. Any follow-up credential/security action needs separate authorization; no password reset was performed.
