# Stage 13 — Yandex Server Browser Foundation

Status: implementation + live acceptance pending.
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
