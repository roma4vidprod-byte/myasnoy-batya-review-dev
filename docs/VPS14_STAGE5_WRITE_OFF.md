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
