# VPS03 test evidence

## Native PostgreSQL 17

- server version: PostgreSQL 17.11;
- `server_version_num`: `170011`;
- clean bootstrap A: PASS;
- clean bootstrap B: PASS;
- normalized A/B application schema diff: `0`;
- normalized fingerprint: `77e288e5494551a2d51d6e2cda34500c|359`;
- synthetic application row counts: six checks, all `0`;
- clean-up: both bootstrap databases destroyed after evidence capture.

## Privilege/RLS negative gate

PASS markers:

- `ROLE_SEPARATION=PASS`;
- `RLS_CONFIGURATION=PASS`;
- `ANON_RLS_DENY=PASS`;
- `PRIVATE_SCHEMA_RUNTIME_DENY=PASS`;
- `RECOVERY_HISTORY_RUNTIME_DENY=PASS`;
- `SERVICE_ROLE_PLATFORM_BYPASS=EXPECTED`.

The synthetic privilege database was destroyed after the test.

## Recovery09A probe

The candidate probe returned exit code `3` and the safe SQL code
`RECOVERY09A_BASELINE_MISMATCH`. `HELPER_PRESENT=0`. No helper or scheduler row
was created.

## Local gates

- targeted VPS03 baseline regression: `3/3 PASS`;
- application suite excluding the unsupported PGlite Recovery09A model:
  `669/669 PASS`;
- `npm run check`: `PASS` (`119` source/fixture/inline-script checks);
- `git diff --check`: `PASS`.

The unfiltered `npm test` result was `669 PASS / 36 FAIL` out of `705`.
All 36 failures are the existing `test/yandex-scheduler-acl.test.mjs` PGlite
managed-cron simulation after the candidate correctly rejects the absent
Recovery09A baseline capability. They are not substituted for the native gate
and are not evidence that the native PostgreSQL result failed.

## Foundation boundary

The prior VPS foundation gate remains the applicable runtime evidence:
loopback health is available, readiness is blocked by the foundation profile,
business routes and worker/timer are disabled. This stage did not connect the
foundation service to the synthetic database.

## Remaining gates

Local application tests/checks and diff checks must be reported from the final
working tree. Supabase Cloud migration/deployment, Auth platform bootstrap,
managed scheduler supportability, and live provider acceptance remain outside
this stage.

## Hashes

- canonical baseline: `71aa35c22cb2aa99a39491b22de8f0f56d390dd53d6165223a8c61f15126176c`;
- Recovery09 SQL: `e2880f7d19ca777f4ca0e2e4585a7f1b44595b60955f0afe3ff94d6e3c1a9331`;
- Recovery09A SQL: `e5532ec5709805724df7451d55e657cb72ea6b8768101ed8e4502e8b6f0241dc`;
- UTC/local fixture: `7d4fcd4834afbe49583d212bb92d999cb957b6ec891b658fbaceea807e32baa3`;
- existing native runner: `f990c4ae05286aa7d3af34135471bbc48d24f2e1a6ef9e3e33acf88163a4a619`;
- scheduler native runner: `c8ce7aa935c461ff4732baa5b825e52ac45f6d025229cb4f061314c7f7831588`.
