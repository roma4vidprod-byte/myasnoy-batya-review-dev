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

## Safety

The builder is offline and does not log in to Yandex.
It never authorizes a reply POST.
Real provider writes always require the later exact-review/exact-text approval gate.
