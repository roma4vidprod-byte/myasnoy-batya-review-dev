# Yandex + AI Autonomy Roadmap — after Stage 17

Status: Stage 13 PASS. Stage 14 AI Reply Engine Foundation PASS and deployed fail-closed. Stage 15 Autonomous CSRF + server-side one-shot writer PASS. Stage 16 Yandex Session Lifecycle Manager PASS. Stage 17 AI Yandex Ops Agent Foundation PASS with sanitized telemetry, allowlisted playbook proposals and fail-closed provider isolation. Live reply execute remains exact-approval gated and was not invoked. Account Bootstrap Pack is maintained.

## Fixed strategy

1. Finish and harden the full Yandex lifecycle on the current Meat Father reference account.
2. Add AI as two isolated capabilities: AI Reply Engine and AI Yandex Ops Agent.
3. AI never owns secrets or bypasses deterministic security gates.
4. The user later creates a separate technical Yandex ID for customer integrations.
5. When that account is supplied, prepare it in one controlled bootstrap stage using the latest Bootstrap Pack.
6. Transfer Meat Father to that technical ID only after no-write acceptance.
7. The customer laptop must not be part of final infrastructure.

## Mandatory portability + AI rule

Every future Yandex/AI stage that adds or changes runtime, DB, browser, session, CSRF, reply, AI policy, safe telemetry, monitoring or recovery files MUST:
- update `tools/yandex-account-bootstrap/bootstrap-manifest.json` when the file belongs in onboarding;
- update the one-stage runbook if gates/order change;
- run `test/yandex-account-bootstrap.test.mjs`;
- preserve the no-secret bootstrap profile;
- preserve Yandex WRITE = 0 during account bootstrap;
- preserve the AI boundaries in `docs/AI_REPUTATION_AND_YANDEX_OPS_ARCHITECTURE.md`.

## Completed

### Stage 13 — Server Browser Foundation — PASS
Isolated VPS Chrome, ephemeral profile, pipe-only CDP, exact GET-only Yandex read, separate DB/OS role and provider writes = 0.

### Stage 14 — AI Reply Engine Foundation — PASS
Pointer-style AI draft composer, exact-scope safe review context, deterministic output policy, isolated Unix-socket AI service and human approval boundary. Provider activation is fail-closed until API credential/model is configured.

### Stage 15 — Autonomous CSRF + server-side one-shot writer — PASS
Root-only VPS orchestration now performs a transient Server Browser CSRF handoff into the existing isolated writer boundary without the customer laptop. Live readiness proved `SERVER_CSRF_READY`, one browser GET, zero writer provider requests, zero provider writes, zero queue claims, exact session/action binding, ephemeral browser cleanup and unchanged DB hashes. The execute path remains exact action/review/text/fingerprint/idempotency bound; no live Stage15 reply POST was performed. Canonical acceptance: `docs/YANDEX_SERVER_REPLY_STAGE15.md`.

### Stage 16 — Yandex Session Lifecycle Manager — PASS
Deterministic `AUTH -> SESSION -> CSRF -> READ` safe telemetry is deployed. A 15-minute network-off monitor records only TTL/count/freshness aggregates, while explicit deep readiness reuses Stage15 CSRF readiness plus Server Browser read and requires one session revision across the chain. Live acceptance proved two GETs, zero provider writes, zero queue claims, unchanged DB hashes and secret-safe telemetry. Successful deep readiness is retained as sanitized `last_readiness_at`, so scheduled snapshots stay network-off instead of repeatedly contacting Yandex. Rotation/recovery action IDs are advisory only; no automatic recovery is executed at Stage16. Canonical acceptance: `docs/YANDEX_SESSION_LIFECYCLE_STAGE16.md`.

### Stage 17 — AI Yandex Ops Agent Foundation — PASS
A root-only network-off collector now converts fixed Stage16 lifecycle and sync evidence into a strict sanitized telemetry envelope. The isolated AI Ops service can classify only into an allowlisted category and playbook ID, while deterministic validation forces `execution_authorized=false` and `provider_write_authorized=false`. `RESULT_UNKNOWN` can only select reconciliation. The OpenAI key is absent, so live provider activation remains fail-closed; mocked-provider E2E proves the classification boundary. Canonical acceptance: `docs/AI_YANDEX_OPS_STAGE17.md`.

## Remaining stages

### Stage 18 — AI-assisted Automatic Recovery Orchestrator
Execute only allowlisted recovery playbooks through a deterministic safety gate.
Examples: restart browser context, rebuild ephemeral profile, rerun read-only health, request reconciliation, or escalate.
`RESULT_UNKNOWN` is always reconciled and never retried by AI.

### Stage 19 — Challenge / 2FA / CAPTCHA operator fallback
Secure human/operator flow for Yandex challenges that cannot be safely automated.
No CAPTCHA/2FA bypass and no secret exposure to AI.

### Stage 20 — Contract Drift Protection + AI diagnosis
Detect endpoint/JSON/DOM/auth/CSRF changes and fail closed.
AI may summarize/classify sanitized drift evidence, but cannot invent or deploy a replacement endpoint/contract.

### Stage 21 — Autonomous E2E on the current reference account
Prove: admin approval → server browser/session → exactly one POST → fresh verification → SYNCED_EXTERNAL with the customer laptop off.
Include an AI-generated draft in the E2E, but the final exact text still requires human approval.

### Stage 22 — AI Reputation Manager
Add sentiment/themes, repeated complaint detection, praise/product/location patterns, unanswered-review prioritization and owner summaries.
Analytics stay separate from provider-write authorization.

### Stage 23 — Operations + reboot/disaster recovery
Monitoring, alerts, reconciliation, backup/restore and full VPS reboot recovery for browser/session/sync/reply/AI telemetry services.

### Stage 24 — NEW TECHNICAL ACCOUNT ONE-STAGE BOOTSTRAP
When the user supplies the new technical Yandex ID and confirms representative access, execute the latest canonical bootstrap runbook as one stage.
Internal gates include isolated keyring/browser/session, server-browser read, full sync, no duplicates, reply readiness with zero writes, admin workflow and AI policy boundary.

### Stage 25 — Transfer Meat Father to the new technical account
Switch the Meat Father organization/session ownership to the new technical Yandex ID without changing review identity, history or reply state.
Run a no-write acceptance before enabling reply execution.

### Stage 26 — Real E2E under the new technical account
One exact review + AI/human-approved exact text + one POST + fresh verification → SYNCED_EXTERNAL.

### Stage 27 — Multi-tenant customer template
Turn the proven technical-account bootstrap into repeatable isolated onboarding: one tenant/account/browser/keyring/audit/AI-policy scope per customer.

### Stage 28 — Multi-tenant AI isolation and policy packs
Per-customer tone of voice, knowledge context, escalation rules and safe Ops telemetry; prove that AI context/actions cannot cross tenant boundaries.

### Stage 29 — Production cutover + Final Autonomous Acceptance
Final auth/RLS/security/domain/HTTPS cleanup and proof that reviews, AI drafts, approved replies, session recovery and monitoring work with no customer laptop dependency.
