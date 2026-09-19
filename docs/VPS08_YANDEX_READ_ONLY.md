# VPS08 — controlled Yandex read: blocked before live execution

Date: 2026-09-19. Result: `SESSION_MIGRATION_BLOCKED`, not live acceptance.

Source: `12d86e776eaf4bb3a943cd1b42be32a52388b6d7`, branch `codex/yandex-live-read-smoke-01`. No runtime code, keys, grants, configuration or server data changed. New offline regression tests and this evidence describe the current boundary; they do not implement a VPS importer.

## Concrete blockers

- `lib/server/runtime-profile.js:13` and `lib/server/yandex-session/crypto.js:43`: existing crypto, store and transport require `cloud-dev`; `vps-lab` is explicitly denied.
- `lib/server/yandex-session/crypto.js:51`: authenticated encryption binds AAD to the Cloud DEV project. There is no explicit VPS target context. Changing the profile or copying an envelope is not a migration.
- `scripts/import-yandex-session.ps1:5`: current Native Messaging import targets Vercel and encrypts there. It has no approved VPS destination or export/re-encryption operation.
- VPS read-only audit: session rows **0**, Asbest company and location absent, `review_yandex_session_store` execution denied to both `service_role` and the worker DB role. Current synthetic LAB identities must not be substituted for Asbest.
- Agent environment has no source keyring or Cloud/worker credential. This says nothing about an independently open user PowerShell process. Current browser/Cloud session validity is **UNKNOWN**; no cookies or encrypted Cloud row were requested.

The task explicitly requires STOP when source key/AAD compatibility cannot be established. No key was generated and no import was attempted. No generic `cloud-dev` fallback, privileged application execution or alternate cookie store was introduced.

## Existing components

| Component | Reuse assessment |
| --- | --- |
| GET-only Yandex transport | Reuse exact request/redirect/size/timeout checks after explicit VPS context support; currently blocked by profile guard |
| Business-list parser / normalizer | Reuse; normalized personal data must remain in memory |
| `contractDiagnosticFull` | Reuse bounded diagnostic, not legacy `dry_run`; existing hard cap is five pages |
| Session validation / AES-GCM / CAS | Preserve contracts; explicit VPS AAD, restricted storage adapter and approved scope provisioning are missing |
| Native Messaging flow | Adapt existing flow, not a second importer; current launcher writes to Cloud |
| VPS06 worker | NOT USED: synthetic-only queue processor; not a real-provider diagnostic entrypoint |
| Persistence / notifications / matching / promo / AI | NOT USED; do not inject real implementations into future diagnostic composition |

See [session migration](VPS08_SESSION_MIGRATION.md), [network boundary](VPS08_NETWORK_BOUNDARY.md), [diagnostic](VPS08_LIVE_DIAGNOSTIC.md), [security](VPS08_SECURITY_EVIDENCE.md), [tests](VPS08_TEST_EVIDENCE.md), [final evidence](evidence/vps08/VPS08_FINAL_REPORT.md).
