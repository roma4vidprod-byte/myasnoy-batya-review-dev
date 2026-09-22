# Stage 16 — Yandex Session Lifecycle Manager

Status: **PASS — live read-only acceptance completed on 2026-09-22**.

Stage 16 adds deterministic, secret-safe Yandex lifecycle telemetry around the already accepted Server Browser and Stage15 server-CSRF boundary. It does not add AI execution, automatic recovery, challenge bypass or provider-write authorization.

## Final source checkpoint

- implementation commit: `9805a9685baed7e2676e937c81fc5b279d59d297`
- readiness-freshness corrective commit: `afd45419ee9e5c262a7d734bda3b8fde52739e48`
- branch: `codex/vps14-remediation-from-stage6`
- final immutable tar SHA-256: `447cec07458dc2c211d621606be11e3a1ed49f8a623645587f72fe0083c9e30f`

Final deployed runtime hashes:

- `session-lifecycle-snapshot.mjs`: `0610b67cc392b32ed2eeb63d5d695993f38af72b1e76b93b42d332247355eba1`
- `session-lifecycle-manager.mjs`: `4c5ee002a60b392bd29528e53a0cac38c2a59f376bdac57ff4783742905a2a0f`

Final immutable releases:

- Server Browser: `/opt/review-activator-yandex-browser/releases/stage16-afd45419ee9e5c262a7d734bda3b8fde52739e48`
- Lifecycle Manager: `/opt/review-activator-lifecycle/releases/stage16-afd45419ee9e5c262a7d734bda3b8fde52739e48`

## Accepted lifecycle model

Deep readiness is deterministic:

`AUTH -> SESSION -> CSRF -> READ`

Accepted safe states:

- `AUTH_OK`
- `SESSION_READY`
- `CSRF_READY`
- `READ_OK`

The deep readiness chain reuses:

- Stage16 network-off session snapshot;
- accepted Stage15 `mode=readiness` CSRF flow;
- accepted Stage13 Server Browser read flow.

A successful deep readiness requires the same session revision across all three runtime observations.

## Network-off monitor

`review-yandex-lifecycle.timer` is enabled and runs every 15 minutes.

Its scheduled operation is snapshot-only:

- session material is opened only inside the isolated `review-yandex-browser` role;
- `PrivateNetwork=yes`;
- provider requests = 0;
- provider writes = 0;
- queue claims = 0;
- raw cookie names/values are never emitted;
- CSRF values, session keys, encrypted envelopes and credential identifiers are never emitted.

The snapshot exposes only safe aggregates such as cookie count, persistent/session cookie count, min/max TTL and bounded expiry counts.

## Deep-readiness freshness

The first implementation exposed a semantic issue: after a successful deep readiness, a timer snapshot could still derive `READINESS_DUE` from the older DB health timestamp even though Stage16 had just proved the complete chain.

Commit `afd4541` fixed this without mutating the Yandex session row:

- successful deep readiness records only sanitized `last_readiness_at`;
- timer snapshots carry this timestamp forward;
- freshness window is 24 hours;
- scheduled snapshots remain network-off;
- after fresh deep readiness, the monitor reports `MONITORING`;
- the timer does not repeatedly contact Yandex every 15 minutes.

Legacy DB fields such as `last_session_check_age_seconds` remain telemetry only. Stage16 deep-readiness freshness is represented by `last_readiness_at` and `last_readiness_age_seconds`.

## Rotation telemetry

Stage16 classifies session-cookie lifetime without exposing secrets.

Current allowlisted action IDs are:

- `RUN_READINESS`
- `ROTATE_SESSION`
- `OPERATOR_REAUTH`
- `CONTRACT_DIAGNOSTIC`

All are proposals/typed action IDs only at Stage16:

- automatic execution = false;
- provider write = false.

Automatic recovery execution belongs to Stage18, not Stage16.

## Regression acceptance

Final local gates:

- Stage16 + Stage15 + Server Browser + Bootstrap targeted regression: **28/28 PASS**
- static/check gate: **185 PASS**
- `git diff --check`: PASS
- full no-network suite with `--test-concurrency=1`: **987/987 PASS, 0 fail**

The historical Recovery09A fixture was copied byte-for-byte only for the full regression and removed afterward. It is not committed.

## Final live acceptance

Initial network-off snapshot:

- operation = `snapshot`
- provider requests = 0
- provider writes = 0
- queue claims = 0
- session revision = 6
- rotation state = `CURRENT`

Deep readiness:

- state = `READY`
- `AUTH_OK -> SESSION_READY -> CSRF_READY -> READ_OK`
- provider requests = 2
- provider writes = 0
- queue claims = 0
- session revision = 6
- no real reply POST

Immediate scheduled-service snapshot after readiness:

- state = `MONITORING`
- last readiness age = 4 seconds
- provider requests = 0
- provider writes = 0
- queue claims = 0
- `RUN_READINESS` not requested

Additional evidence:

- lifecycle telemetry file = root:root 0600
- Stage16 secret markers in journal = 0
- no residual browser process
- no residual writer process
- no Chrome TCP debug listener
- review DB hash unchanged
- reply-action DB hash unchanged
- normal writer gate remained `RA_YANDEX_REPLY_WRITE_ENABLED=false`
- session remained `READY`, revision 6
- actions remained `CANCELLED=1`, `SENT=1`, active sends = 0
- admin / health / ready = `200 / 200 / 200`
- lifecycle timer = active + enabled

Backups:

- corrective pre-deploy: `/var/backups/review-activator/20260922T130049157406Z/manifest.json`
- final: `/var/backups/review-activator/20260922T130254139112Z/manifest.json`

## Hard boundaries after Stage16

Stage16 did not:

- run Stage15 `mode=execute`;
- send a Yandex reply POST;
- rotate session credentials automatically;
- give AI any telemetry;
- execute automatic recovery;
- bypass CAPTCHA/2FA/challenges;
- change tenant/company/location/organization scope.

## Next stage

Stage 17 — AI Yandex Ops Agent Foundation — is next and must not start without separate user approval.
