# Stage 17 — AI Yandex Ops Agent Foundation

Status: **PASS — fail-closed live acceptance completed on 2026-09-22**.

Stage 17 adds an isolated AI Ops classification boundary over the sanitized Stage16 lifecycle/browser/sync telemetry. It does not execute recovery playbooks, mutate Yandex, enable reply writes or expose raw session material to AI.

## Source checkpoint

- implementation commit: `9cd8430`
- branch: `codex/vps14-remediation-from-stage6`
- immutable tar SHA-256: `4d72b2e053a483028acd3e1bb7fd2c0f90dd3f937aaf2cb6241df275a41a13d0`
- release: `/opt/review-activator-ai-ops/releases/stage17-9cd8430`

Deployed source hashes:

- `lib/ai/yandex-ops.js`: `17c3f8e6bb4f480d6ac3bd9ba51ca06210a0455c46891571f2072f1596256096`
- `ops-telemetry-collector.mjs`: `a60e720d446f4c05c384dc5c70ba3ad603754792b73bc4a6d2a6811b1d3c70c9`
- `ai-ops-service.mjs`: `d4154d29604d138f5f192c28627be3e3f80e400637b73b304a7bbd7db2ef28f7`
- `ops-agent-once.mjs`: `f2baee6ac0c8cadf77f97493bbf81a805fb54f38a37350a554dabb35bef8ac4e`

## Accepted architecture

`fixed safe sources -> root-only sanitizer/collector -> strict telemetry envelope -> isolated AI Ops service -> deterministic output validator -> playbook proposal only`

The AI service has no direct access to:

- Yandex passwords or account credentials;
- raw cookie names or values;
- CSRF values;
- session keys or encrypted session envelopes;
- OTP / 2FA / CAPTCHA data;
- Yandex browser/reply runtime directories;
- Review Activator DB;
- root-only ops telemetry files.

## Safe telemetry contract

The collector reads only the fixed root-owned files:

- `/var/lib/review-activator-ops/YANDEX_LIFECYCLE_STAGE16.json`
- `/var/lib/review-activator-ops/VPS09_LAST_SYNC.json`

It emits only a strict versioned envelope containing safe states and aggregates such as:

- lifecycle/auth/CSRF/read state;
- session revision;
- source-age / freshness;
- minimum cookie TTL and bounded expiry counts;
- provider-write / queue-claim counters;
- sync result and allowlisted failure code;
- ages of last successful provider read and persistence.

Tenant/company/location/Yandex organization IDs and exact source timestamps are not passed to AI.

The collector service is network-off with `PrivateNetwork=yes` and `RestrictAddressFamilies=AF_UNIX`.

## AI output contract

AI may return only:

- one allowlisted classification;
- one playbook ID permitted for that classification;
- an uppercase bounded reason code;
- confidence = LOW / MEDIUM / HIGH.

Every accepted decision is forced to:

- `execution_authorized=false`;
- `provider_write_authorized=false`.

Current playbook catalog is proposal-only:

- `NO_ACTION`
- `RUN_READINESS`
- `RERUN_READ_ONLY_HEALTH`
- `ROTATE_SESSION`
- `OPERATOR_REAUTH`
- `RESTART_BROWSER_CONTEXT`
- `REBUILD_EPHEMERAL_PROFILE`
- `CONTRACT_DIAGNOSTIC`
- `REQUEST_RECONCILIATION`
- `ESCALATE_OPERATOR`

`RESULT_UNKNOWN` can select only `REQUEST_RECONCILIATION`; provider POST retry is not a playbook.

## Provider isolation and fail-closed state

AI Ops is a separate Unix-socket service:

- service user: `review-ai-ops`;
- credential: systemd `LoadCredential=openai-api-key`;
- separate model config: `RA_AI_OPS_MODEL`;
- Yandex/reply/runtime/ops paths are inaccessible to the AI service.

At Stage17 acceptance the OpenAI credential is intentionally absent.

Therefore:

- `review-ai-ops.service` remains inactive;
- no AI socket is exposed;
- a real one-shot classification returns `AI_OPS_NOT_CONFIGURED`;
- no external AI provider request is made.

This is the accepted fail-closed foundation. Provider-independent behavior is proven with mocked-provider regression tests.

## Regression acceptance

- Stage17 focused tests: **10/10 PASS**
- combined Stage17/16/15/14/Bootstrap regression: **56/56 PASS**
- static/check gate: **187 PASS**
- `git diff --check`: PASS
- full suite under `test/support/no-network.mjs` and `--test-concurrency=1`: **997/997 PASS, 0 fail**

The historical Recovery09A fixture was used only temporarily and removed after the suite.

## Live acceptance

The deployed network-off collector produced a strict root-owned telemetry file:

`/var/lib/review-activator-ops/YANDEX_AI_OPS_INPUT.json`

Permissions: `root:root 0600`.

Observed safe state during acceptance included:

- lifecycle state = `MONITORING`;
- session revision = `6`;
- provider writes = `0`;
- queue claims = `0`;
- sync result = `FAIL`;
- sync failure = `SYNC_NOT_CONFIRMED`.

A local mocked-provider classification using this actual sanitized telemetry returned:

- classification = `SYNC_DEGRADED`;
- playbook = `REQUEST_RECONCILIATION`;
- confidence = `HIGH`;
- execution authorized = `false`;
- provider write authorized = `false`.

No playbook was executed.

Additional live evidence:

- collector timer active + enabled;
- collector result = success;
- OpenAI key absent;
- real AI provider requests = 0;
- Yandex provider writes = 0;
- review DB hash unchanged;
- reply-action DB hash unchanged;
- normal writer gate remained `RA_YANDEX_REPLY_WRITE_ENABLED=false`;
- no residual Yandex browser process;
- no residual Yandex writer process;
- no Chrome TCP debug listener;
- Stage17 journal secret markers = 0;
- admin / health / ready = `200 / 200 / 200`.

Backups:

- pre-deploy: `/var/backups/review-activator/20260922T155924773630Z/manifest.json`
- final: `/var/backups/review-activator/20260922T160342297149Z/manifest.json`

## Hard boundary after Stage17

Stage17 does **not**:

- execute any recovery playbook;
- restart or rotate Yandex session/browser automatically;
- call a Yandex reply endpoint;
- enable a provider-write gate;
- retry an uncertain provider POST;
- change tenant/scope;
- bypass challenge / 2FA / CAPTCHA;
- give AI raw secrets or unrestricted DB access.

Automatic allowlisted recovery execution belongs to Stage18.

## Next stage

Stage 18 — AI-assisted Automatic Recovery Orchestrator — is next and must not start without separate user approval.
