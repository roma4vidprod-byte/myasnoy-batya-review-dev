# AI Architecture — Review Activator / SLUKH

Status: canonical design decision after Stage 13.

## Two separate AI contours

### 1. AI Reply Engine
Purpose: generate, improve and validate reply drafts for customer reviews.

Allowed inputs:
- review text, rating, author name;
- location/company context;
- approved tone of voice and business rules;
- safe product/menu/promo context;
- previous published replies and reply-history metadata;
- internal policy flags such as negative-review escalation.

AI output is always a draft/proposal.
Default path: AI draft -> deterministic policy validation -> human approval -> exact fingerprint/idempotency -> one-shot writer.
Automatic publication may be considered later only for explicitly allowlisted low-risk scenarios.

### 2. AI Yandex Ops Agent
Purpose: diagnose browser/session/CSRF/sync/contract problems from sanitized telemetry and select an allowlisted recovery playbook.

Allowed telemetry examples:
`AUTH_OK`, `SESSION_DEGRADED`, cookie TTL aggregates, `CSRF_INVALID`, HTTP 401/403, browser health, contract-drift codes, queue/send states.

The AI never receives raw passwords, cookies, CSRF values, session keys, OTP/2FA codes, CAPTCHA material or unrestricted database access.

## Hard AI safety boundaries

AI MUST NOT:
- enable a provider write gate;
- choose or change tenant/company/location/Yandex organization scope;
- directly call Yandex reply endpoints;
- retry a provider POST after `RESULT_UNKNOWN` or other uncertain delivery;
- invent a replacement endpoint or auth contract;
- bypass CAPTCHA, 2FA or other Yandex challenges;
- persist or expose secrets;
- mutate production DB outside allowlisted typed actions.

An uncertain provider POST is always reconciled, never repeated by AI.

## AI Ops execution model

`Safe Telemetry -> AI classification -> allowlisted playbook ID -> deterministic safety gate -> executor -> fresh verification`

The model may recommend/choose only a predefined action such as:
- restart isolated browser context;
- create a fresh ephemeral browser profile;
- refresh safe session-health evidence;
- rerun a read-only health check;
- rotate an already-authorized session credential through an approved mechanism;
- request reconciliation;
- escalate to operator for 2FA/CAPTCHA/contract drift.

Every action has strict input schema, tenant binding, idempotency/audit metadata, timeout and post-condition verification.

## Review intelligence direction

Later AI Reputation Manager capabilities may include sentiment/themes, repeated complaint detection, location comparisons, unanswered-review prioritization, rating drivers and weekly owner summaries.
These analytics never weaken the publication/security boundary above.
