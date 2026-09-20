# VPS14 — Yandex reply contract and explicit approval boundary

Date: 2026-09-20
Status: **PARTIAL PASS — SESSION REFRESH + LIVE READ-ONLY REPLY CONTRACT DISCOVERY PASS; PROVIDER WRITE DISABLED**
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

## Session refresh foundation

The expired session blocker is handled by a separate one-shot refresh path rather than by relaxing cookie validation.

Added source:
- `tools/vps14/session-refresh.mjs` — exact current session guard, `revision 4 -> 5`, Native Messaging payload only, CAS replacement via existing `prepareVpsImport`, provider requests/writes = 0.
- `scripts/yandex-vps-refresh.ps1` — pinned VDSina SSH target, strict host-key checking, no password/keyboard auth, no Cloud fallback.
- `scripts/start-yandex-vps-refresh.ps1` — explicit human-started refresh entrypoint.
- `scripts/start-yandex-local-import.ps1` now accepts a separate `vps-refresh` target while preserving `cloud-dev` as the default and the historical `vps-lab` path.

Verification: VPS14 targeted tests 14/14 PASS, PowerShell parser PASS, source/config checks 156 PASS.

A successful refresh is expected to produce `NOT_CONFIGURED / revision 5`. It must then pass the existing health path before any VPS14 contract discovery continues.

### Refresh transport preflight

The first Windows adapter attempt reproduced the known local OpenSSH failure (`ssh.exe` exited 255 without usable stderr). The refresh path does not depend on that binary anymore.

A fixed Node `ssh2` bridge now pins:
- VDSina host `83.217.214.29`
- root key file already used by the project
- exact SHA-256 host fingerprint
- one fixed remote `review-yandex-import` command

The bridge only forwards bounded stdin/stdout; it does not parse, log or persist session material. PowerShell parser checks PASS. A real challenge-only preflight against VDSina returned `VPS_REFRESH_PREPARE_PASS revision=4 provider_writes=0`, then the child was closed before any browser session was submitted. Database/session state was not changed by this preflight.

Remaining refresh gate: the installed Chrome extension must collect a fresh session from the active Yandex Business Reviews tab and submit it through the same-user Native Messaging pipe. This requires the human browser action by design.

### Native Messaging host repair

Chrome reported `NATIVE_HOST_START_FAILED` before any import call. Safe status confirmed the VDSina session stayed at revision 4.

The historical registration pointed to `host.cmd`. A compiled local console wrapper was added as source in `tools/vps14/native-host-launcher.cs`. It starts the unchanged `yandex-native-host.ps1`, forwards raw stdin/stdout bytes, suppresses no protocol content, and restricts Chrome argv. The generated local `host_v2.exe` passed the exact Native Messaging diagnostic frame both with the extension origin and with a synthetic `--parent-window` argument: native response PASS, import_calls=0.

HKCU still points to the same manifest. The manifest now points to the absolute `host_v2.exe` path. Code Integrity, Defender and Application logs showed no launch block/crash for the wrapper. Because the currently running Chrome process continued to report `NATIVE_HOST_START_FAILED`, the remaining gate is a full Chrome process restart so it reloads the Native Messaging host configuration.

Verification after wrapper source: VPS14 targeted 16/16 PASS; source/config checks 157 PASS. Yandex WRITE remains 0.


## Live session refresh and contract discovery — 2026-09-20

The Chrome Native Messaging failure was resolved without weakening cookie/session
validation. The final extension diagnostic reported:
- stage: METADATA_ONLY
- code: PASS_VALUES_NOT_CHECKED
- import calls: 0
- total cookie records observed: 140
- metadata eligible: 22
- partitioned records excluded: 118
- eligible duplicate-name groups/excess: 0/0
- expired: 0
- scope mismatch: 0
- counts complete: true

The one-shot browser-native refresh then completed:
- session imported: true
- state after replace: NOT_CONFIGURED
- revision after replace: 5

A single existing read-only health call followed:
- state before: NOT_CONFIGURED
- revision before: 5
- final state: READY
- final revision: 6
- Yandex requests: 1
- HTTP statuses: [200]
- received reviews: 20
- review persistence: OFF
- notifications: OFF
- state CAS: SUCCESS

The VPS14 read-only reply-contract diagnostic then completed on the refreshed real
session:
- provider requests: 1
- provider writes: 0
- answer endpoint called: false
- page items: 20
- review IDs present: 20/20
- list CSRF present: true
- business_answer_csrf_token present: 20/20
- author privacy metadata present: 20/20
- unanswered reviews on the inspected page: 1

This confirms the per-review/list token fields needed for the candidate reply
contract without calling the reply endpoint.

## Approval/queue foundation

A separate local-only publication state foundation is now prepared in
`tools/vps14/reply-publish-foundation.sql`. It extends the existing
`review_reply_actions` skeleton rather than introducing a parallel engine.

The foundation provides:
- exact-scope preparation of an approval fingerprint for a DRAFT
- SHA-256 binding of action ID, review ID, exact reply text, company, location and provider
- bounded approval TTL
- automatic invalidation when the DRAFT text changes
- explicit approval transition DRAFT -> QUEUED
- per-action idempotency key
- cancellation QUEUED -> DRAFT before any provider send
- no SENDING/SENT transition
- no HTTP/provider transport
- no Yandex endpoint call

The browser-facing approval RPCs are authenticated-admin only; anon, PUBLIC and
service_role execution are revoked.

**Current provider-write status remains Yandex WRITE = 0.**
