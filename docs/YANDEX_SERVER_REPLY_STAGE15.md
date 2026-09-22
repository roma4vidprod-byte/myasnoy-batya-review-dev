# Stage 15 — Autonomous CSRF + Server-Side One-Shot Writer

Status: **PASS — readiness-only live acceptance completed on 2026-09-22**.

Stage 15 removes the customer-laptop dependency from the CSRF handoff path and installs the server-side orchestration boundary required for an exact approved Yandex reply. A real provider reply POST was **not** executed during Stage 15.

## Final source checkpoint

- implementation commit: `307848ceb7a619cdd59d9015190870e1ad188793`
- live symlink-entrypoint fix: `57cb8acbf6a29a68832621cd31011096f7e4c381`
- final branch: `codex/vps14-remediation-from-stage6`
- final immutable tar SHA-256: `71efade1ec8a5929f6cc4f5de37be99d20fad2c0234d275a330ae28d0dac8837`

Final deployed source hashes:

- `browser-csrf-resolver.mjs`: `8c38dfd4886a762d28cad8a25df3b7d4e96c9f92838da55aa546430c75beea32`
- `server-reply-orchestrator.mjs`: `edddab0a1ebb9b23457f35a6a0ec5f8191c906fc9a9e23f2a035568715646cb1`

## Final deployed releases

- Server Browser: `/opt/review-activator-yandex-browser/releases/stage15-57cb8acbf6a29a68832621cd31011096f7e4c381`
- root-only server reply orchestrator: `/opt/review-activator-server-reply/releases/stage15-57cb8acbf6a29a68832621cd31011096f7e4c381`

The normal reply writer remains a separate OS/DB capability and remains disabled outside an exact one-shot execution:

- `RA_YANDEX_REPLY_WRITE_ENABLED=false`
- writer service inactive/static
- browser and writer roles remain separate

## Architecture accepted

`root-only orchestrator -> transient review-yandex-browser -> Chrome pipe CSRF -> transient review-yandex-writer -> existing exact-bound writer`

The browser side:

- uses the encrypted READY VPS session;
- uses Chrome Stable with `--remote-debugging-pipe`;
- uses an ephemeral runtime profile;
- permits the exact Reviews page GET only;
- obtains global CSRF from `window.__PRELOAD_DATA.initialState.env.csrf`;
- verifies the intended Yandex organization;
- has no queue/write DB grants.

The writer side:

- receives the CSRF handoff only through the orchestrator;
- readiness mode performs zero queue claims and zero provider requests;
- execute mode remains exact action/review/fingerprint/idempotency bound;
- uncertainty after execution release is reconciliation-only and no-retry.

## Regression acceptance

After the final fix:

- Stage15 targeted/regression set: **25/25 PASS**
- static/check gate: PASS
- `git diff --check`: PASS
- full suite under `test/support/no-network.mjs` and `--test-concurrency=1`: **975/975 PASS, 0 fail**

The historical Recovery09A fixture was used only temporarily for the full suite and was removed afterward. It is not committed.

## Live issue found and fixed

The first deployment from commit `307848c` produced an empty readiness result. No browser/writer process remained, no action was claimed, the writer gate stayed false, and the server was rolled back to the Stage13 browser release.

The cause was a real deployment-path defect: the ESM CLI guard compared `import.meta.url` with the unresolved `/current` symlink path. Node resolved the module to the immutable release path, so the entrypoint silently did not execute.

Commit `57cb8ac` made both Stage15 CLI guards symlink-safe by resolving the entry path before comparison and added a regression proving `/current` can resolve to an immutable release path.

## Final live readiness acceptance

Exact live request used:

`{"version":1,"mode":"readiness"}`

Safe aggregate result:

- `ok=true`
- `state=SERVER_CSRF_READY`
- organization `54309413522`
- session revision `6`
- browser provider requests = `1`
- writer provider requests = `0`
- provider writes = `0`
- queue claims = `0`
- session binding = `true`
- action binding = `true`
- persistent browser profile = `false`

Additional acceptance evidence:

- journal secret markers = `0`
- no browser process remained
- no Chrome TCP debug listener
- review/action DB hashes unchanged
- writer gate remained `false`
- admin / health / ready = `200 / 200 / 200`
- session remained `READY`, revision `6`
- reply actions remained `CANCELLED=1`, `SENT=1`, active sends `0`

Backups:

- pre-deploy: `/var/backups/review-activator/20260922T122058768945Z/manifest.json`
- final: `/var/backups/review-activator/20260922T122225477569Z/manifest.json`

## Write boundary after Stage 15

Stage 15 did **not** run live `mode=execute` and did **not** send a new Yandex reply POST.

A future real execution still requires:

1. one exact review;
2. one exact approved reply text;
3. the existing fingerprint/idempotency/TTL/session binding;
4. a separate explicit human approval;
5. one-shot execution;
6. fresh post-write verification;
7. reconciliation instead of retry if the POST result is uncertain.

## Next stage

Stage 16 — Yandex Session Lifecycle Manager — is next, but must not start without separate approval.
