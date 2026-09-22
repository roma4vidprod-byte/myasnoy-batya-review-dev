# Stage 14 — AI Reply Engine Foundation

Status: **PASS — foundation implemented, deployed and fail-closed.**
Date: 2026-09-22

## Goal

Add AI-generated reply drafts to the existing Stage12 admin workflow without giving the model any provider-write, Yandex-session or approval capability.

## Result

- Pointer-style `Сгенерировать ответ` button is present next to the reply textarea.
- AI output only fills the textarea; it never auto-saves, prepares, approves or publishes.
- Exact publish path remains: draft -> save -> prepare -> fingerprint/idempotency -> human approval -> one-shot writer.
- AI prompt treats review text as untrusted data and ignores prompt injection inside reviews.
- Deterministic draft policy rejects URLs, internal AI references, unapproved discounts/refunds/promocodes and overlong/control-character output.
- Manual edits after AI generation are recorded as human-edited AI drafts (`edited_after_ai`).
- Browser never receives OpenAI credentials or direct AI provider access.
- Scoped AI review RPC is exact company/location/org/provider and unanswered-review only.

## Isolation

- AI provider runs in separate `review-ai-draft` service.
- API key is accepted only through systemd `LoadCredential`.
- LAB connects to the AI service through Unix socket `/run/review-ai-draft/ai.sock`.
- Foundation gets only supplementary group `review-ai-client` for socket access.
- AI service has no PostgreSQL/Yandex session/writer capability and cannot read Yandex/browser/reply directories.
- Public gateway exposes only `/api/admin-review-reply-draft`; the scoped DB RPC is not directly browser-callable.

## Verification

- Targeted Stage14 suite: 29/29 PASS.
- Stage14 + Bootstrap targeted suite: 22/22 PASS.
- Full repository regression after guard updates: 966/966 PASS, 0 fail.
- LAB release verifier regression: 2/2 PASS; 11-file manifest accepted, tampering/duplicate paths rejected.
- Bootstrap Pack regression after verifier update: 4/4 PASS.
- Source/config check: 183 PASS.
- `git diff --check`: PASS.

## Live VPS acceptance

- Active LAB release: `/opt/review-activator-lab/releases/stage14-ai-38e876a0637270b28190d13c5fbc7b593dcca0c8`.
- AI release: `/opt/review-activator-ai/releases/stage14-38e876a0637270b28190d13c5fbc7b593dcca0c8`.
- Foundation: active/running with supplementary group `review-ai-client`.
- AI service unit: loaded/static/inactive; runtime socket absent.
- OpenAI credential: ABSENT.
- AI scoped RPC grants: authenticated=true, anon=false, service_role=false.
- Public AI draft route without JWT: HTTP 401.
- Direct browser access to scoped AI DB RPC: HTTP 404.
- Existing Yandex reply writer remains WRITE OFF / inactive / static.
- Existing first real reply remains SENT, attempt_count=1, review state SYNCED_EXTERNAL.
- Reviews: 75; reply actions: CANCELLED=1, SENT=1; active QUEUED/SENDING=0.
- Admin/healthz/readyz: 200/200/200.
- Business review/action hashes were unchanged by Stage14 deployment.

Final backup: `/var/backups/review-activator/20260922T103244730749Z/manifest.json`.

## Provider activation status

Real OpenAI generation was intentionally NOT executed because the VPS does not currently contain `/etc/review-activator-ai/openai-api-key` or model configuration.

This is fail-closed, not a fallback:
- UI is deployed;
- API boundary is deployed;
- isolated service is deployed;
- no provider call is possible until an explicit AI credential/model is configured;
- no Yandex write capability is affected.

Adding the OpenAI credential/model later is an activation/configuration action, not a redesign of the Stage14 architecture.
