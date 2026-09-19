# VPS08A explicit crypto profiles

## Provenance map

```text
Current operator-confirmed Chrome / existing extension
  -> existing same-user Native Messaging pipe (single-use nonce, 120s TTL)
  -> authenticated pinned SSH process stdin (plaintext in trusted memory only)
  -> existing validateSession + encryptSession with explicit VPS context
  -> private role wrapper -> existing review_yandex_session_store replace/CAS
  -> reader-only private role -> existing decryptSession/transport/service
```

This native source is already plaintext in Chrome memory: there is no source AES envelope to relabel/decrypt. No cached Cloud envelope or Cloud key is used. The encrypted-Cloud-source alternative is NOT IMPLEMENTED/NOT USED; no source key was extracted.

Cloud API signatures retain optional trailing context defaults and the original Cloud AAD bytes. Existing `keyringFromEnv()` remains Cloud-only. VPS context requires `RA_RUNTIME_PROFILE=vps-lab` plus explicit private `RA_YANDEX_MODE=read-only-admin`; it rejects Cloud credentials and cannot be forged by passing an object literal. Missing context does not select VPS.

VPS AAD identity: `vps-lab:review-activator-lab:yandex:v1`, followed by provider, fixed company/location/org, technical account and credential version. The original Cloud identity remains unchanged. No fallback/try-both path. Same-key-byte synthetic tests deliberately prove cross-profile rejection via AAD. Wrong key, credential version, scope and capability also fail closed.

Continuation created a new independent VPS key only on the server. Loader reads `/etc/review-activator-yandex/session-key.json`, root-owned mode0640, at most1024 bytes, restricted importer/reader primary group matching process gid, no links. Key loading and web-role denial PASS. No Cloud JWT/service credential or local PowerShell keyring is used. Protected pre-mutation backup PASS. No real session has been imported at the pre-import checkpoint.

`tools/vps08a/session-access.sql` is VPS-only infrastructure SQL, not a Cloud migration. After native tests it was applied to LAB. Existing CAS function/table are unchanged. Private owner is non-login and has no superuser/RLS bypass; scoped RLS and exact-action wrapper constrain access. Normal web/API roles and synthetic worker remain denied. No private schema is exposed through PostgREST.

The wrapper is privileged only relative to its restricted logins, which have no direct table/underlying RPC access. Reader permits read and health transition with sync_ok=false, never replace/disable. Importer permits status/replace, never raw read/transition. Actual OS/group/peer configuration and negative public/API grants were verified on LAB. No public endpoint, root application execution or business scheduler is introduced.

The protected pre-import backup predates the new key. Subsequent DB dumps can contain the encrypted VPS session, but the dedicated encryption key is outside the DB dump. VPS07 off-host recovery evidence remains historical; it does not yet cover this new key/runtime. If this key is lost, use a new explicitly approved browser re-auth/import; do not claim current off-host evidence proves restoration of this new credential.
