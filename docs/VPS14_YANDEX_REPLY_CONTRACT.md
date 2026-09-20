# VPS14 — Yandex reply contract and explicit approval boundary

Date: 2026-09-20
Status: **SOURCE FOUNDATION READY; LIVE CONTRACT DISCOVERY BLOCKED BY EXPIRED SESSION**
Yandex WRITE: **0**

## Goal

Prepare the provider-write layer for replying to a Yandex review while preserving a
strict human approval boundary. VPS14 must never publish merely because a draft exists
or because an AI draft was generated.

A future execution is valid only for one exact:
- company/location/provider scope
- review ID
- draft action ID
- reply text
- approval fingerprint
- approval TTL

Any edit after approval invalidates execution permission.
## Candidate provider contract

A public third-party reverse-engineered client currently models Yandex Business
review replies as POST to:

`https://yandex.ru/sprav/api/ugcpub/business-answer`

with JSON fields:
- reviewId
- text
- reviewsCsrfToken
- optional answerCsrfToken

and X-CSRF-Token request header.

This is **candidate evidence only**, not an official Yandex write contract.
The endpoint has not been called by Review Activator.

The publish boundary is intentionally stricter than draft storage:
maximum reply text length is 2500 characters.
## Source added

- lib/server/yandex-session/reply-contract.js
  - exact Asbest scope
  - pure candidate request builder
  - no fetch/network code
  - strict response classifier
  - success only for exact HTTP 200 body OK
- lib/server/review-reply-approval.js
  - SHA-256 fingerprint
  - exact review/action/text/scope binding
  - PENDING -> APPROVED only by explicit call
  - 10 minute default TTL
  - edited draft invalidates execution
- tools/vps14/reply-contract-diagnostic.mjs
  - read-only page-1 contract census
  - aggregate evidence only
  - no cookie/token/value output
  - provider_writes=0
- corresponding VPS14 tests

No UI publish control and no provider transport were wired.
## Live diagnostic result

The first VPS14 contract-discovery run stopped before provider transport:

- error: SESSION_PLAINTEXT_SCHEMA_INVALID
- safe rule: SESSION_COOKIE_EXPIRED
- path: cookies[*].expires
- expected: future unix-seconds number
- provider requests: 0
- provider writes: 0
- answer endpoint called: false

The already accepted VPS08A session.mjs health path independently returned the same
SESSION_PLAINTEXT_SCHEMA_INVALID with attempted=0/completed=0.

Therefore the issue is the stored browser session, not the VPS14 diagnostic code.
The validator will not be weakened and expired cookies will not be silently dropped.
A fresh browser-native session import is required before live contract discovery.
## Verification

Targeted VPS14 tests: **11/11 PASS**.
Source/config check: **153 PASS**.
git diff --check: PASS.

The candidate request module contains no fetch/global network execution.
The diagnostic contains no POST method and no business-answer endpoint.
Approval fingerprint changes when text or review identity changes.

## Next gate

1. Refresh the Yandex browser session through the existing native import mechanism.
2. Re-run the read-only VPS14 contract diagnostic.
3. Confirm only aggregate presence/type evidence for review IDs and CSRF fields.
4. Build the guarded transport behind explicit approval.
5. Keep it disabled until a separate user authorization names the exact review and
   exact reply text for the first real write E2E.

Until step 5, **Yandex WRITE remains 0**.
