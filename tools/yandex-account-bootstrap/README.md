# SLUKH Yandex Account Bootstrap Pack

Canonical runbook: `docs/YANDEX_TECHNICAL_ACCOUNT_ONE_STAGE_BOOTSTRAP.md`.
Canonical file allowlist: `bootstrap-manifest.json`.

## First new technical account for Meat Father

1. Copy `meatfather-profile.template.json`.
2. Replace only `technical_yandex_login` with the new Yandex ID.
3. After the account is added as Yandex Business representative, set `representative_access` to `CONFIRMED`.
4. Do not add password, cookies, CSRF, OTP/2FA, CAPTCHA or tokens.
5. Build the evidence/bundle:

`node scripts/build-yandex-account-bootstrap.mjs <profile.json> <output-directory>`

If representative access is still PENDING, the generated plan remains BLOCKED.
If it is CONFIRMED and validation passes, the plan reports READY_FOR_ONE_STAGE_ACCOUNT_PREPARATION.

## Current portability baseline

The pack includes the accepted Stage13 Server Browser, Stage15 server-CSRF/root-orchestrator runtime and Stage16 Session Lifecycle Manager.
During technical-account bootstrap, Stage15 is exercised only in `mode=readiness`: one exact browser GET may obtain CSRF, while writer provider requests, provider writes and queue claims must remain zero.
Stage16 then runs a network-off lifecycle snapshot plus the explicit `AUTH -> SESSION -> CSRF -> READ` readiness chain. Scheduled lifecycle monitoring remains network-off and stores only safe TTL/count/freshness aggregates.
The accepted Stage15/16 entrypoints are symlink-safe so `/current` may point to immutable releases without turning a CLI into a silent no-op.
Canonical acceptances: `docs/YANDEX_SERVER_REPLY_STAGE15.md` and `docs/YANDEX_SESSION_LIFECYCLE_STAGE16.md`.

## Safety

The builder is offline and does not log in to Yandex.
It never authorizes a reply POST.
Real provider writes always require the later exact-review/exact-text approval gate.
