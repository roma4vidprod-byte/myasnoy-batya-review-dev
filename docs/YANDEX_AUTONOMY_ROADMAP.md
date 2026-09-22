# Yandex Autonomy Roadmap — after Stage 12

Status: Stage 12 PASS. Account Portability / Bootstrap Pack prepared.

## Fixed strategy

1. Continue finishing Yandex reviews on the current Meat Father reference account.
2. The user creates a separate technical Yandex ID intended for customer integrations.
3. When that account is supplied, prepare it in one controlled bootstrap stage using the canonical Bootstrap Pack.
4. Then grant/connect the Meat Father Yandex Business organization to that technical ID and switch the integration without review duplication.
5. The customer laptop must not be part of the final infrastructure.

## Mandatory portability rule

Every future Yandex stage that adds or changes runtime, DB, browser, session, CSRF, reply, monitoring or recovery files MUST:
- update `tools/yandex-account-bootstrap/bootstrap-manifest.json` if the file belongs in onboarding;
- update the one-stage runbook if gate/order changes;
- run `test/yandex-account-bootstrap.test.mjs`;
- preserve the no-secret profile rule;
- preserve Yandex WRITE = 0 during bootstrap until a separate exact reply approval.

## Remaining stages

### Stage 13 — Server Browser Foundation on current reference account
Build the isolated VPS browser/profile foundation and prove safe read/session evidence with no provider write.

### Stage 14 — Autonomous CSRF + server-side one-shot writer
Move CSRF acquisition and exact one-shot reply execution off the customer laptop while preserving exact action/review/text/fingerprint/idempotency binding.

### Stage 15 — Yandex Session Lifecycle Manager
Continuously maintain AUTH → SESSION → CSRF → READ health, cookie/session rotation and readiness.

### Stage 16 — Automatic Recovery
Recover ordinary browser/session/network failures automatically without repeating an uncertain provider POST.

### Stage 17 — Challenge / 2FA / CAPTCHA operator fallback
Handle non-automatable Yandex challenges through a secure operator path; do not bypass CAPTCHA/2FA.

### Stage 18 — Contract Drift Protection
Detect endpoint/JSON/DOM/auth/CSRF changes, fail closed, keep safe subsystems alive and emit sanitized diagnostics.

### Stage 19 — Autonomous E2E on the current reference account
Prove: admin approval → server browser/session → exactly one POST → fresh verification → SYNCED_EXTERNAL with the customer laptop off.

### Stage 20 — Operations + reboot/disaster recovery
Monitoring, alerts, reconciliation, backup/restore and full VPS reboot recovery for browser/session/sync/reply services.

### Stage 21 — NEW TECHNICAL ACCOUNT ONE-STAGE BOOTSTRAP
When the user supplies the new technical Yandex ID and confirms representative access, execute the entire canonical bootstrap runbook as one stage.
Internal gates include backup, account scope, isolated keyring/browser/session, read health, full sync, no-duplicate persistence, reply readiness with zero writes, admin workflow and evidence freeze.

### Stage 22 — Transfer Meat Father to the new technical account
Switch the Meat Father organization/session ownership to the new technical Yandex ID without changing review identity, history or reply state.
Run a no-write acceptance before enabling any reply execution.

### Stage 23 — Real E2E under the new technical account
One exact review + exact text, separate approval, one POST, fresh verification and SYNCED_EXTERNAL.

### Stage 24 — Multi-tenant customer template
Turn the proven technical-account bootstrap into repeatable isolated onboarding for future customers: one tenant/account/browser/keyring/audit scope per customer.

### Stage 25 — Production cutover + Final Autonomous Acceptance
Final auth/RLS/security/domain/HTTPS cleanup and proof that reviews + approved replies work with no customer laptop dependency.
