# Stage 18 — AI-assisted Automatic Recovery Orchestrator

Status: **PASS — deterministic fail-closed live acceptance completed on 2026-09-22**.

Stage 18 adds the deterministic execution layer after the accepted Stage17 AI Ops proposal boundary. AI still cannot execute arbitrary commands. A Stage17 decision must pass a fixed safety gate before a predefined recovery playbook can run.

## Source checkpoint

Implementation commits:

- `5d449dacea9a12c0af59a86fc0fd32f47bb3ddc3` — initial deterministic recovery orchestrator;
- `02e853b1647ce926ad53a2b23503cc592a72188a` — preserve fresh AI decision binding before telemetry refresh;
- `3098831c96249c7ad654dee85ae76db4f1f5cb90` — validate the existing multi-line writer env while still requiring exactly one false write gate.

Final immutable archive SHA-256:

`2c2961f94ae6e4aeae3632d0fe62dde1bc5395782009f0c40633527163343ddd`

Final release:

`/opt/review-activator-ai-ops-recovery/releases/stage18-3098831c96249c7ad654dee85ae76db4f1f5cb90`

Final deployed hashes:

- `ai-ops-recovery.js`: `a0f52d5dec534a73554d896f266c9f7e5f2dd39aece452f5b794b6642318b48a`
- `recovery-cycle.mjs`: `3a9b3bfa3b075486b814f7161401b10b95dc043566f45597b3c8d2cb026e8248`
- `recovery-orchestrator.mjs`: `8554678f4d9677b00f4555b6668cda2f5db657dffd1cb67a795db5580dfaff64`

## Deterministic safety gate

Every recovery requires:

- exact Stage17 decision schema;
- exact Stage17 policy version;
- matching sanitized telemetry SHA-256;
- telemetry and decision freshness <= 30 minutes;
- provider writes = 0 and queue claims = 0 in source telemetry;
- one allowlisted classification/playbook pair;
- normal reply writer gate exactly disabled;
- normal reply writer service inactive.

Recovery fingerprint:

`SHA256(recovery-policy | telemetry-hash | classification | playbook | reason-code)`

Before any external recovery action the fingerprint is persisted as `EXECUTING`.

The same fingerprint is never executed again after:

- `EXECUTING`
- `SUCCESS`
- `FAILED`
- `REQUESTED`
- `ESCALATED`
- `NO_ACTION`

A later run returns `DEDUPLICATED`.

## Playbook execution policy

Stage18 automatic read-only execution is limited to:

- `RUN_READINESS`
- `RERUN_READ_ONLY_HEALTH`
- `RESTART_BROWSER_CONTEXT`
- `REBUILD_EPHEMERAL_PROFILE`

These routes use the existing deterministic read-only lifecycle/readiness boundary and must verify provider writes = 0 and queue claims = 0.

Local deterministic actions:

- `NO_ACTION`
- `REQUEST_RECONCILIATION`

`REQUEST_RECONCILIATION` creates only a root-owned request marker. It does not perform a provider POST.

The following Stage17 proposals are deliberately escalated instead of auto-executed at Stage18:

- `ROTATE_SESSION`
- `OPERATOR_REAUTH`
- `CONTRACT_DIAGNOSTIC`
- `ESCALATE_OPERATOR`

Challenge/2FA/CAPTCHA handling belongs to Stage19. Contract-drift remediation belongs to Stage20.

## RESULT_UNKNOWN rule

`RESULT_UNKNOWN` can only produce:

`REQUEST_RECONCILIATION`

A provider POST retry is not present in the Stage18 action catalog.

The request marker is root-owned and has `no_retry=true`.

## Regression

Before the two narrow live corrective fixes:

- Stage18/17/16/15/Bootstrap targeted regression: **44/44 PASS**;
- full no-network suite: **1008/1008 PASS, 0 fail**.

After the decision-freshness fix:

- Stage18 focused regression: **11/11 PASS**;
- static gate: **189 PASS**.

After the writer-gate parser fix:

- Stage18 focused regression: **12/12 PASS**;
- static gate: **189 PASS**;
- `git diff --check`: PASS.

The corrective changes are limited to decision-refresh ordering and exact parsing of the existing write-gate key.

## Live acceptance

### 1. No AI configuration

With no OpenAI API key and no fresh decision, the scheduled recovery cycle returns:

`WAITING_AI_CONFIGURATION`

No recovery action and no provider request are invented.

### 2. Automatic RUN_READINESS

A root-only synthetic Stage17 decision, hash-bound to current sanitized telemetry, released `RUN_READINESS` through the real hardened Stage18 service.

The existing Stage15/16 readiness dependency currently fails at the Server Browser CSRF step.

Independent direct diagnosis confirmed:

`SERVER_CSRF_NAVIGATION_FAILED`

The Stage18 result was therefore:

- playbook = `RUN_READINESS`;
- status = `FAILED`;
- error = `RECOVERY_VERIFICATION_FAILED`;
- provider write authorization = false;
- `no_retry=true`.

No provider write occurred.

The failed recovery fingerprint was retained as a no-retry outcome. The same fingerprint is not eligible for automatic re-execution.

This is an upstream browser-CSRF navigation issue, not evidence that the Stage18 safety gate failed. The exact Yandex/browser contract cause is intentionally not guessed at Stage18.

### 3. RESULT_UNKNOWN reconciliation

A separate current-telemetry decision:

`RESULT_UNKNOWN -> REQUEST_RECONCILIATION`

was accepted by the deterministic gate.

Live result:

- status = `REQUESTED`;
- provider write authorization = false;
- `no_retry=true`;
- root-only reconciliation request created.

Running the same decision again returned:

`DEDUPLICATED`

No provider POST was issued.

## Final server evidence

- review DB hash unchanged;
- reply-action DB hash unchanged;
- Yandex session = `READY`, revision `6`;
- reply actions = `CANCELLED=1`, `SENT=1`;
- active sends = `0`;
- `RA_YANDEX_REPLY_WRITE_ENABLED=false`;
- normal reply writer inactive;
- no residual Yandex browser process;
- no residual Yandex writer process;
- no Chrome TCP debug listener;
- admin / health / ready = `200 / 200 / 200`;
- Stage18 secret/write journal markers = `0`;
- Stage17 collector timer active + enabled;
- Stage18 recovery timer active + enabled;
- final network-off Stage16 state = `READINESS_DUE`.

Final backup:

`/var/backups/review-activator/20260922T164314358761Z/manifest.json`

## Known dependency finding

The accepted Stage15 Server Browser CSRF path currently times out during navigation with:

`SERVER_CSRF_NAVIGATION_FAILED`

Stage18 does not invent a new URL, relax the browser contract or retry the failed recovery automatically.

The finding is preserved for the later challenge/contract-drift stages. Until that dependency is resolved, read-only recovery attempts that require Stage15 CSRF readiness can safely fail and remain no-retry.

## Next stage

Stage 19 — Challenge / 2FA / CAPTCHA operator fallback — is next and must not start without separate user approval.
