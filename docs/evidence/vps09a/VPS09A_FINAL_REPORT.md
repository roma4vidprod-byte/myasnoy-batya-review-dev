# VPS09A — STOPPED, historical cause unproven

Verdict: **K. UNKNOWN**, for the exact original VPS09 failure. Current symptoms are measured, not a fabricated historical OS error.

## What is proved

- VPS08 and VPS09 used the same user, env-i/profile/mode, Node path, CWD and transport hash. Both historical cgroups were SSH sessions, not worker/app services.
- Existing app is loopback-only; synthetic worker is Unix-sockets-only/private-network. A transient clone blocks no-auth DNS/TLS as expected. That is NOT evidence the historical direct CLI inherited the same restrictions.
- DNS passes directly; IPv6 returns ENETUNREACH and has no default route.
- IPv4 is intermittent: independent TCP/TLS probes sometimes connected and sometimes hit their5s connect deadline. Final direct-reader default-family TLS with the original10s cap passed88ms, certificate valid, no config changes.
- No proxy/custom CA/Agent/dispatcher/family override in the inspected path. Per-request10s/full-read30s equal in VPS08/VPS09; installed Undici defaults connect10s and headers/body300s. No speculative timeout increase.

## Fix / code status

Network policy fix: NONE; not enough evidence for a specific remediation. No IPv6 disable, pinned IP, firewall/SSH/unit change or restart.

Local safe telemetry patch preserves YANDEX_NETWORK_ERROR plus allowlisted cause/stage metadata. Header vs body failure tested; no raw messages/headers/secrets. It is NOT deployed to the private Yandex runtime. Only credential-free diagnostic files and an isolated test copy were placed on VPS; two transient units collected. Original runtime/unit hashes unchanged.

## Yandex/session/data

Business page1 check: NOT_RUN. Conditional gate (proven and fixed cause) not met. VPS09 manual sync NOT_RETRIED. New business GET0, cumulative13; Yandex writes0.

SessionREADY4 unchanged; writerNOT_RUN; real review INSERT/UPDATE/DELETE0/0/0; LAB3users/2synthetic reviews; all table hashes unchanged; queue/runs0. Provider-failure monitor receipt retained; no persistence success claimed.

healthz/readyz200/200, publicTCP SSH only, business timerOFF. No Cloud/Vercel/BusinessOS/Production/2GIS/email/Telegram/AI/promo/DB mutation or reboot.

No-auth effects:17 socket probes (6 TCP,11 TLS),4 explicit DNS lookups plus TLS's hostname lookups;0HTTP requests. These are not claimed as zero external network activity. Initial administrative SCP connection timed out before install; one later source transfer succeeded, not a Yandex retry.

## Verification

Windows178PASS/0FAIL/0SKIP; Linux178PASS/0FAIL/0SKIP; sourcechecks144PASS. Native systemd/direct-network matrix recorded with actual PASS/FAIL, not disguised as all-green. Source/evidence secret scan and scoped log patterns clean;26 original user files preserved. No full/general quality harness.

Starting SHA0e95c9586a5fa862ddc073c51e15c33cea43a95e; branchcodex/yandex-live-read-smoke-01. A local diagnostic checkpoint does not change deployed SHA or authorize replay. No push.

Next safe step: investigate intermittent outbound TCP with hosting/network evidence. A future authenticated request needs its applicable approval/gate; do not use the conditional budget just because one unauthenticated handshake passed.
