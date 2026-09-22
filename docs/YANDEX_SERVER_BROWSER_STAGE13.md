# Stage 13 — Yandex Server Browser Foundation

Status: **PASS — implementation and live server-browser read acceptance complete.**
Scope: current Meat Father reference Yandex account.
Provider reply WRITE: forbidden in this stage.

## Goal

Prove that a browser running on the VPS can use the existing encrypted READY Yandex session and perform one authenticated read without the customer laptop.

## Security model

- separate OS and PostgreSQL identity: `review-yandex-browser`;
- no membership in reader/writer/import groups;
- DB capability: only `vps_yandex_private.browser_session_read()`;
- session key delivered only with systemd `LoadCredential`;
- browser user-data directory is ephemeral under `/run/review-yandex-browser`;
- Chrome DevTools connection uses `--remote-debugging-pipe`, never a TCP debugging port;
- Chrome sandbox remains enabled; `--no-sandbox` is forbidden;
- browser request interception allows only one exact GET to the fixed Reviews API;
- every other target request is blocked before network dispatch;
- any attempt to reach `business-answer` fails Stage 13;
- no timer, socket, Install section or automatic restart;
- stdout/journal contains aggregate evidence only; cookie/CSRF values are never emitted.

## Expected acceptance

- Chrome Stable installed from official Google package and version recorded;
- DB browser role has no table/write/queue capability;
- encrypted session opens as READY at the current revision;
- one server-browser GET returns a valid Yandex reviews payload;
- provider_requests = 1;
- provider_writes = 0;
- reply_endpoint_attempts = 0;
- runtime profile is deleted after the one-shot exits;
- existing reviews/reply actions/session state remain unchanged.

## Live acceptance — 2026-09-22

- Git source SHA: `26b27730fb139f1b4cd7189e6acc6b621d6363e7`.
- Immutable browser release: `/opt/review-activator-yandex-browser/releases/stage13-26b27730fb139f1b4cd7189e6acc6b621d6363e7`.
- Chrome: `Google Chrome 153.0.8010.52`.
- Official package SHA-256: `29e0e4b5af01213915ffdb7f4e49a11956dc5fc591165c85af8688dcdff907ac`.
- Server browser result: `BROWSER_READY`.
- Session revision: `6`.
- Active cookies used by browser: `19`.
- Provider requests: `1`.
- Provider writes: `0`.
- Reply endpoint attempts: `0`.
- Reviews on inspected page: `20`.
- Provider-reported total at the moment of the read: `73`.
- List CSRF presence: true; per-review answer-CSRF presence: `20/20`.
- Chrome sandbox stayed enabled; no `--no-sandbox`.
- DevTools transport used pipe only; no TCP debug port existed after the run.
- Runtime profile was removed after the oneshot.
- Review and reply-action database hashes were unchanged by the browser run.

The local database contained 75 historical/current review rows at this point while the provider reported total 73. Stage 13 is intentionally read-only and performs no deletion/reconciliation of provider-removed reviews.

Final control:
- browser role execute grants: `browser_session_read=true`, writer claim/finish/session-read=false;
- browser service: static/inactive, Restart=no, no timer/socket;
- normal reply writer: `RA_YANDEX_REPLY_WRITE_ENABLED=false`, inactive/dead/static;
- existing first reply remained `SENT`, attempt_count=1, review state `SYNCED_EXTERNAL`;
- Admin 200, healthz 200, readyz 200;
- final backup: `/var/backups/review-activator/20260922T083237258039Z/manifest.json`.
