# Stage 20 — Contract Drift Protection + AI Diagnosis

Status: **PASS — fail-closed live acceptance completed on 2026-09-22**.

Stage 20 adds a separate diagnostic boundary for Yandex endpoint/JSON/DOM/auth/CSRF drift. It detects and classifies contract changes without changing the provider contract, inventing replacement URLs/selectors or authorizing provider writes.

## Source checkpoint

Implementation commits:

- `3eca583e3329505947f47bce2f5d6386c5c4e3ae` — Stage20 contract-drift protection and AI diagnosis foundation;
- `f1d2534b4162320e6a85da6a1c89159aedf6218a` — classify the live multi-document navigation chain as an explicit drift category.

Final immutable archive SHA-256:

`2fb85521e9fb3fbd4f0a3b7535762e2ca1c4d8939d75b2b86c61fb596e036692`

Final release:

`/opt/review-activator-contract-drift/releases/stage20-f1d2534b4162320e6a85da6a1c89159aedf6218a`

Key deployed hashes:

- `yandex-contract-drift.js`: `f5a9247e13f3c3b226d4e40accc2a327b4ed9c7bd37abbe140ad26b6d4cedae6`
- `browser-contract-probe.mjs`: `7c3564b14d89b2164f31cbdb04510c054acde8b6b5aef128fe306802e5cdbe22`
- `contract-drift-manager.mjs`: `e23fa8353ee8e98c3e5fede2a7a4be55474f01d86a32b058c8af5ecdd8cf5616`

The Stage20 immutable package also contains unchanged accepted Stage13 session/CDP dependencies needed by the diagnostic browser probe.

## Diagnostic architecture

`fixed safe page probe + accepted API browser probe -> strict sanitized evidence -> deterministic classifier -> optional isolated AI diagnosis`

### Browser page probe

The page probe:

- runs under the existing `review-yandex-browser` role;
- uses an ephemeral Chrome profile and pipe-only CDP;
- disables page JavaScript;
- allows only HTTPS Yandex document `GET/HEAD` requests;
- blocks subresources and all non-GET/HEAD requests;
- counts but never calls the reply endpoint;
- never persists raw HTML;
- never returns URLs, cookies, CSRF values or response bodies.

Safe evidence includes only:

- result/error category;
- HTTP status;
- content type category;
- final path category;
- whether the expected organization segment remains present;
- preload marker presence;
- CSRF key/candidate counts;
- challenge/login marker booleans;
- document/blocked request counts;
- body byte count;
- session revision;
- provider-write count.

### API probe

The API half reuses the already accepted Stage13 Server Browser read-only runtime and exposes only its existing safe output.

## Deterministic classifications

Stage20 supports fixed categories including:

- `NO_DRIFT`
- `CHALLENGE_SURFACE`
- `AUTH_CONTRACT_DRIFT`
- `PAGE_NAVIGATION_CHAIN_DRIFT`
- `BROWSER_NAVIGATION_DRIFT`
- `PAGE_PATH_DRIFT`
- `PRELOAD_CONTRACT_DRIFT`
- `CSRF_CONTRACT_DRIFT`
- `API_CONTRACT_DRIFT`
- `UNKNOWN_CONTRACT_DRIFT`

Allowed actions are diagnosis-only:

- `KEEP_BLOCKED`
- `OPERATOR_REAUTH`
- `OPERATOR_CHALLENGE`
- `CONTRACT_REVIEW`
- `WAIT_AND_RECHECK`

All deterministic results force:

- `contract_change_authorized=false`
- `provider_write_authorized=false`
- `endpoint_change_authorized=false`
- `selector_change_authorized=false`

## AI diagnosis boundary

The isolated AI contract-drift service receives only the sanitized evidence over a Unix socket.

AI must not:

- invent or return a replacement URL/endpoint;
- invent a DOM selector;
- invent a CSRF/auth contract;
- bypass CAPTCHA/2FA/challenge;
- authorize a provider write;
- authorize or deploy a contract patch.

AI output is limited to:

- allowlisted classification;
- allowlisted action ID;
- bounded reason code;
- bounded summary code;
- confidence.

The AI service cannot read Yandex key/session/browser/reply or root-only ops files directly.

At acceptance the OpenAI key is absent, so the real AI service remains inactive and the one-shot state is:

`AI_NOT_CONFIGURED`

Provider-independent mock-AI tests prove the output policy without an external AI request.

## Live finding

Stage20 resolved the previously generic `SERVER_CSRF_NAVIGATION_FAILED` into a more specific contract observation.

The HTML/CSRF page itself is currently healthy under the diagnostic boundary:

- page result = `PASS`;
- HTTP = `200`;
- content type = `HTML`;
- final path category = `EXPECTED_PAGE`;
- expected organization segment present;
- `__PRELOAD_DATA` present;
- CSRF key occurrences = `23`;
- CSRF value candidate count > 0;
- challenge marker = false;
- login marker = false;
- provider writes = 0;
- reply endpoint attempts = 0.

However the current page navigation requires:

**3 document requests**

The canonical Stage15 resolver was built around an exact single-document request boundary. It therefore remains fail-closed when the navigation chain no longer matches that assumption.

The accepted deterministic diagnosis is:

`PAGE_NAVIGATION_CHAIN_DRIFT -> CONTRACT_REVIEW -> YANDEX_DOCUMENT_CHAIN_DRIFT`

The API Browser read independently still reports:

`BROWSER_NAVIGATION_FAILED`

This evidence does not reveal or persist the intermediate raw navigation URLs.

## What Stage20 did NOT do

Stage20 did not:

- loosen the Stage15 exact navigation allowlist;
- authorize the observed additional document requests for production reply readiness;
- update any endpoint or selector;
- change CSRF extraction;
- change auth/session material;
- call a reply endpoint;
- enable the reply writer;
- pass raw contract material to AI.

A future contract remediation must be an explicit human/developer decision based on reviewed evidence.

## Regression acceptance

Before the narrow live-classification refinement:

- Stage20 focused: **10/10 PASS**
- Stage20 + 19 + 18 + 17 + 16 + 15 + Bootstrap: **65/65 PASS**
- static/check gate: **194 PASS**
- full no-network regression: **1029/1029 PASS, 0 fail**
- `git diff --check`: PASS

After the navigation-chain classification refinement:

- Stage20 focused: **10/10 PASS**
- static/check gate: **194 PASS**
- `git diff --check`: PASS

The refinement changes classification only; browser/network execution is unchanged.

## Live acceptance

A second live diagnostic reproduced the same safe evidence:

- document requests = `3`;
- CSRF key occurrences = `23`;
- deterministic classification = `PAGE_NAVIGATION_CHAIN_DRIFT`;
- action = `CONTRACT_REVIEW`;
- API result = FAIL / `BROWSER_NAVIGATION_FAILED`;
- provider writes = 0;
- contract/endpoint/selector change authorization = false.

A provider-independent AI diagnosis over the actual sanitized evidence returned the same category/action with all modification/write authorizations false.

Additional evidence:

- review DB hash unchanged;
- reply-action DB hash unchanged;
- normal reply writer remains disabled/inactive;
- no residual Yandex browser process;
- no residual Yandex writer process;
- no Chrome TCP debug listener;
- admin / health / ready = `200 / 200 / 200`;
- Stage20 secret/write journal markers = `0`;
- Stage17/18/19 timers remain active;
- Stage20 timer active + enabled;
- Stage20 AI service inactive because the API credential is absent.

Final backup:

`/var/backups/review-activator/20260922T173551892695Z/manifest.json`

## Stage21 prerequisite

Stage21 is the next roadmap stage, but autonomous reply E2E must not proceed while the Stage15 navigation contract remains unresolved.

Before a real Stage21 provider POST, a separately reviewed developer contract remediation must restore Stage15 readiness and pass the existing zero-write readiness gates.

Stage20 itself does not grant that remediation.

## Next stage

Stage 21 — Autonomous E2E on the current reference account — is next, subject to the prerequisite above, and must not start without separate user approval.
