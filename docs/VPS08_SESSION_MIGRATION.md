# VPS08 session migration — not attempted

`SESSION_MIGRATION_BLOCKED`. Source material validity and source-to-target key/AAD compatibility are not established. This is not evidence of AES corruption or a confirmed expired browser login.

Target scope, if later explicitly provisioned on VPS:

- Company: `13f3cb80-487a-4a19-96a1-fb3103200230`
- Location: `9a95f63b-18e6-447b-a449-8530b67ddbae`
- Organization: `54309413522`; provider `yandex`; account `myasnoibatya-zakaz`.

Read-only VPS audit found neither company nor location and no stored session. No session revision exists on this VPS; historical Cloud revisions must not be described as VPS revisions. Both before and after this non-mutating stage: session state/revision **absent**, not manually `READY`.

## Existing security contracts

`validateSession()` accepts only bounded allowlisted Yandex cookie fields/domains/paths and the fixed technical account. Persistent expiry is Unix seconds; expired values are refused. Supported session-cookie expiry uses the existing `null`/`-1` form. No expiry was replaced, extended or omitted. No live material was read to test this.

AES-256-GCM uses an envelope and credential version bound to scope/AAD. The current AAD includes Cloud project `ykiubttldgyjpajmsuas`. `store.js` defaults to the Cloud RPC and enforces the Cloud profile. The existing SQL boundary checks company/location and uses expected-revision CAS. Replace resets state to `NOT_CONFIGURED`; ordinary state transitions preserve credentials. LAB policy intentionally revokes broad session access.

The known candidate path `/etc/review-activator-lab/yandex.env` does not exist. This is a path-presence observation, not proof that no key could exist anywhere on the server. No arbitrary environment files or private keys were inspected or copied.

## Required next safe step

First provide a reviewed VPS-specific context and restricted adapter **inside the existing session/import architecture**, plus explicit Asbest scope provisioning without changing synthetic reviews/users. Keep the public LAB app and synthetic worker provider-disabled. Take a protected checkpoint before any session-store mutation. Use a dedicated new VPS Yandex key, never JWT/DB/backup/Cloud keys. This work and actual import were not performed in this stage.

Only after that path exists: use the Chrome profile for the technical account with Asbest access and the existing extension via the adapted protected Native Messaging flow. Re-login/MFA is only needed if the normal browser scenario requires it; the user enters credentials. Plaintext stays in trusted process memory, encryption occurs for the VPS target context, and import uses CAS. No cookies/JSON/token submission through chat.

**Do not run the current `start-yandex-local-import.ps1` as a VPS remedy**: its remote adapter writes to Vercel/Cloud. No correct executable VPS import command currently exists. Do not extract Sensitive Vercel env or relabel Cloud AAD/profile to work around this blocker. No session backup/rollback checkpoint was needed because no session-store mutation occurred.

## VPS08A update — 2026-09-19

The preceding text records the unchanged VPS08 checkpoint. VPS08A now adds an **uninstalled candidate**: explicit private VPS crypto context, scoped RPC capability, SSH/stdin adapter for the same Native Messaging listener, and read-only operation adapter. See [crypto profile](VPS08A_CRYPTO_PROFILE.md) and [import boundary](VPS08A_IMPORT_BOUNDARY.md). Cloud defaults remain unchanged.

Two approved read-only DEV catalog queries confirmed the exact company/location IDs and minimal required metadata; no session/key/review row was extracted. Current valid source material is still UNKNOWN. Browser inventory exposed only an empty in-app browser, not the ordinary Chrome profile. The operator must confirm the technical account and installed extension; ordinary login/MFA is only required if the browser requests it. No evidence presently proves an expired login.

`REAUTH_REQUIRED / SOURCE_CONFIRMATION_REQUIRED`. Real import attempts = 0. No new VPS key, runtime roles, scope rows or session row. New helper `start-yandex-vps-import.ps1` is **not ready to run against this server** until protected backup, installation, peer-role setup and key provisioning are completed. Do not run it prematurely and do not run the old Cloud-default launcher. Import or live acceptance is not claimed.
