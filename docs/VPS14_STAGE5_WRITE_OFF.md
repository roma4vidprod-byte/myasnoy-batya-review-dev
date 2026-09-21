# VPS14 stage 5 — disabled writer runtime

Authorized scope: install a separate writer runtime on VDSina with WRITE OFF.
No real queue claim, session material read, provider request or provider write.
Do not change the VPS13 UI, existing reader, scheduler, gateway or database schema.

## Runtime composition

`tools/vps14/writer-runtime.mjs` reuses the existing worker, store, transport and
writer capability. The disabled branch returns before store construction and
before session or CSRF callbacks. The CLI accepts no arguments or credentials.
Missing trusted CSRF/session adapters block BEFORE claim even with write=true.

The live browser PRELOAD diagnostic proved presence (length 51) and organization
match. It did not transfer a token, prove its validity for the server session, or
wire a secure resolver. Stage 5 is NOT READY FOR FIRST APPROVED WRITE.
A protected session adapter and browser-to-server CSRF binding remain prerequisites.
No unsupported POST bootstrap or invented token fallback is permitted.

## Deployment boundary

Dedicated path: `/opt/review-activator-reply/releases/<release>` plus `current`.
Dedicated unit: `review-activator-reply.service`, manual oneshot, no timer/install.
Dedicated OS user: `review-yandex-writer`, locked login, no supplementary groups.
Config: `/etc/review-activator-reply/writer.env`, root-only, write=false.
Systemd denies IP networking and access to existing secret/config/backup paths.
Do not grant key-file access as part of this disabled installation.

The package builder includes committed allowlisted files only and writes a hash
manifest bound to the exact source SHA. No SQL, scratch files, keys or sessions.

## Live checkpoint — 2026-09-21T18:35:55Z

Status: DEPLOYED_WRITE_OFF; end-to-end writer DB/session/CSRF readiness PARTIAL.
Deployed source SHA: `98e02ce40bc1bf6978b5b69f138e394b6ded557f`.
Release: `/opt/review-activator-reply/releases/vps14-stage5-98e02ce40bc1bf6978b5b69f138e394b6ded557f`.
Archive SHA-256: `b070310db22fcacd2563bcc556022eeaf4bb94c8580dac26a8651c5e127e3b10`.
Manifest: 18/18 source hashes PASS before and after installation.

Dedicated OS account created: uid=986, gid=982, only its own group, nologin,
password locked. No existing password, SSH key or Yandex key material changed.
Unit installed; no timer, no [Install], no drop-ins, no automatic restart.
One manual WRITE OFF smoke start: Result=success, ExecMainStatus=0;
final ActiveState=inactive, SubState=dead, UnitFileState=static.
Effective sandbox: PrivateNetwork=yes, RestrictAddressFamilies=AF_UNIX,
NoNewPrivileges=yes, ProtectSystem=strict; secret/config/backup paths inaccessible.
Config: mode 0600 root:root; release files 0444 root:root and directories 0555.

The actual runtime returned DISABLED/WRITE_OFF, claimed=false,
storageCalls=0, sessionReads=0, providerRequests=0, providerWrites=0,
csrfResolver=NOT_CONNECTED, readiness=DISABLED_INSTALLATION_ONLY.
This is NOT evidence that writer-session decryption or provider POST is ready.

A separate identity-only peer PostgreSQL check under the new OS writer account
was blocked by the tool safety layer before execution. It was NOT retried through
an alternative wrapper. OS-to-DB peer login remains NOT_VERIFIED.

Live PostgreSQL catalog checks (administrator, READ ONLY) now confirm all three
worker RPCs exist. Only writer among the six runtime/browser roles tested has
EXECUTE; PUBLIC has no EXECUTE on any of them. This closes the earlier catalog
ACL evidence gap, but does not replace an actual peer-login test.

Data before/after matches:
- reviews: 74; SHA-256 `1f7554e135f078e2711858d4b755eb3da5e46be632ce46d77dea2e297d80cbeb`
- actions: 1; SHA-256 `6574de70b87681c0a2aaebb3b6a7ca2a40c5679239219c6fb1aad61146ec4637`
- only CANCELLED:1; DRAFT/QUEUED/SENDING/SENT/FAILED:0
Stored Yandex state: READY / revision 6 (metadata only, no fresh provider health).
No stage-5 SQL migration or business-data mutation was performed.

Admin HTTPS /admin.html, loopback /healthz and /readyz: 200/200/200.
Foundation, HTTPS gateway, Auth, API and Caddy: active/running.
Existing reader sync/backup/monitor timers remain enabled; old lab worker timer
remains disabled. No scheduler configuration was changed.

Local targeted runtime/package/transport/store/VPS13 regressions: 47/47 PASS,
0 FAIL/SKIP. Source/config check: 176 PASS. git diff --check: PASS.
An initial Windows-only test launcher path error was corrected to a file URL.
Full project QA and actual enabled writer execution were not run in stage 5.

Remaining acceptance gates before real write: verify actual writer peer login;
wire a protected session adapter and short-lived browser CSRF handoff bound to
organization, session and approved action; then run full final QA. An env flag
alone cannot activate this CLI: missing adapters fail closed before store/claim.
Stage 6 and all real write gates remain unauthorized and unstarted here.
