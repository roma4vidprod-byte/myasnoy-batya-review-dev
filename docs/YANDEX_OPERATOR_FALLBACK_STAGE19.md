# Stage 19 — Challenge / 2FA / CAPTCHA Operator Fallback

Status: **PASS — no-secret live acceptance completed on 2026-09-22**.

Stage 19 adds a deterministic human/operator fallback for Yandex authentication and challenge states that must not be automated. It does not bypass CAPTCHA/2FA, accept challenge answers, expose secrets to AI, or authorize a Yandex provider write.

## Source checkpoint

- implementation commit: `ebda80adae336c07e70d67673ddf806c3d755c6a`
- branch: `codex/vps14-remediation-from-stage6`
- final immutable archive SHA-256: `9fd139f30fbedd317c7dd45769bc0e5ad10e5164e1f1fe90771f0a609432202f`
- release: `/opt/review-activator-operator-fallback/releases/stage19-ebda80adae336c07e70d67673ddf806c3d755c6a`

Deployed hashes:

- `yandex-operator-fallback.js`: `442e3726dd44d465e24d3c8db55afa89dfe63cb87db1ef34ae77ecfac51aa400`
- `operator-fallback-manager.mjs`: `3d9f51029c2f022e3d5e9dd468ec8d7753b55628c5a3879d724d3add6b42736c`
- Stage17 sanitizer dependency is packaged unchanged as `lib/ai/yandex-ops.js`.

The first deployment archive omitted that already-accepted Stage17 sanitizer dependency and failed before the release switch. No Stage19 unit or ticket was left active. The corrected immutable package added the unchanged dependency and passed deployment.

## Accepted operator model

`Stage18 ESCALATED -> Stage19 ACTION_REQUIRED -> human action in Yandex -> approved session import -> revision verification -> RESOLVED`

Recognized fallback kinds:

- `REAUTH`
- `TWO_FACTOR`
- `CAPTCHA`
- `CHALLENGE`

The fallback is created only from explicit, allowlisted Stage18 escalation pairs.

Examples:

- `AUTH_REQUIRED + OPERATOR_REAUTH`
- `CHALLENGE_REQUIRED + ESCALATE_OPERATOR`

Contract drift is not silently converted into an auth fallback.

## Ticket contract

A ticket contains only safe metadata:

- ticket ID;
- source recovery ID;
- fallback kind;
- allowlisted reason code;
- expected session revision;
- state;
- issue/expiry timestamps;
- fixed safety flags.

Hard flags:

- `operator_secret_input_allowed=false`
- `provider_write_authorized=false`
- `no_retry=true`

Ticket states:

- `ACTION_REQUIRED`
- `OPERATOR_CONFIRMED`
- `VERIFYING`
- `RESOLVED`
- `FAILED`
- `EXPIRED`

Operator acknowledgement accepts exactly:

`{version:1, op:"ack", ticket_id:"..."}`

No additional fields are accepted.

## Human boundary

The operator must complete any Yandex challenge, CAPTCHA or 2FA directly in the normal Yandex browser UI.

SLUKH never asks the operator to submit:

- password;
- OTP;
- 2FA code;
- CAPTCHA response;
- cookie;
- CSRF value;
- token.

After the human has completed Yandex authentication, the already-approved native session-import mechanism is reused. Stage19 does not create another cookie/credential transport.

## Revision binding

The ticket records the session revision that existed when human action became necessary.

After operator acknowledgement:

- unchanged revision -> remains `OPERATOR_CONFIRMED`;
- exactly `expected + 1` with `NOT_CONFIGURED` -> `VERIFYING`;
- exactly `expected + 1` with `READY` -> `RESOLVED`;
- revision drift beyond one increment -> `FAILED`;
- expired ticket -> `EXPIRED`.

The manager reads only exact fixed-scope DB fields:

- session state;
- session revision;
- safe last error code.

It never reads session ciphertext/cookies for ticket verification.

## Runtime isolation

`review-yandex-operator-fallback.service` is:

- root-only;
- `PrivateNetwork=yes`;
- `RestrictAddressFamilies=AF_UNIX`;
- writeable only to `/var/lib/review-activator-ops`;
- denied access to Yandex key/session/browser/reply runtime paths.

The scheduled service may ingest a Stage18 escalation or verify an already acknowledged ticket. It never acknowledges a ticket on behalf of the operator.

Timer cadence: 15 minutes.

## Regression acceptance

- Stage19 focused regression: **10/10 PASS**
- Stage19 + Stage18 + Stage17 + Stage16 + Stage15 + Bootstrap: **55/55 PASS**
- static/check gate: **191 PASS**
- `git diff --check`: PASS
- full no-network regression: **1019/1019 PASS, 0 fail**

The historical Recovery09A fixture was used only temporarily and removed after the full suite.

## Live acceptance

No real Yandex challenge, CAPTCHA, 2FA or session reimport was performed.

A root-only synthetic Stage18 challenge escalation was used to exercise the real Stage19 service.

### ACTION_REQUIRED

Observed:

- fallback kind = `CHALLENGE`;
- reason = `YANDEX_CHALLENGE`;
- expected session revision = `6`;
- secret input allowed = false;
- provider write authorized = false;
- no retry = true;
- ticket permissions = root-only `0600`.

### Operator acknowledgement

The live ACK used only ticket ID.

Result:

`ACTION_REQUIRED -> OPERATOR_CONFIRMED`

No challenge answer or credential was supplied.

### Unchanged revision

The real current session remained `READY / revision 6`.

Verification correctly kept the ticket at:

`OPERATOR_CONFIRMED`

It did not falsely claim that human reauthentication had completed.

### Synthetic post-import verification

A separate synthetic acceptance ticket used expected revision `5` while the real read-only DB status was `READY / revision 6`.

The real Stage19 verifier returned:

`RESOLVED`

This proves the production revision/post-condition path without modifying or reimporting the real Yandex session.

## Final server evidence

- review DB hash unchanged;
- reply-action DB hash unchanged;
- session = `READY / revision 6`;
- reply actions = `CANCELLED=1`, `SENT=1`;
- active sends = `0`;
- `RA_YANDEX_REPLY_WRITE_ENABLED=false`;
- no residual Yandex browser process;
- no residual Yandex writer process;
- no Chrome TCP debug listener;
- admin / health / ready = `200 / 200 / 200`;
- Stage17 collector timer remains active;
- Stage18 recovery timer remains active;
- Stage19 fallback timer active + enabled;
- synthetic escalation/ticket removed after acceptance.

Final backup:

`/var/backups/review-activator/20260922T170509675316Z/manifest.json`

## Existing browser finding

The previously identified Stage15 browser-CSRF path still has the independent finding:

`SERVER_CSRF_NAVIGATION_FAILED`

Stage19 does not classify that generic navigation failure as CAPTCHA/2FA by guessing. Contract/browser drift diagnosis remains Stage20 scope.

## Next stage

Stage 20 — Contract Drift Protection + AI diagnosis — is next and must not start without separate user approval.
