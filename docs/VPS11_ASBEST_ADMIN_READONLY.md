# VPS11 — Asbest admin read-only on VDSina

Date: 2026-09-20
Status: **PASS_VPS11_ASBEST_ADMIN_READONLY_INTERNAL**
Public/production cutover: **NOT PERFORMED**
Yandex write operations: **0**

## Scope

The existing loopback-only admin UI on VDSina now uses a fail-closed runtime scope.
Default remains `synthetic`. The only additional mode is `asbest-readonly`:

- company: `13f3cb80-487a-4a19-96a1-fb3103200230`
- location: `9a95f63b-18e6-447b-a449-8530b67ddbae`
- Yandex org: `54309413522`
- provider: `yandex`

Any other `RA_LAB_ADMIN_SCOPE` value fails startup.

## Release

A new immutable release was derived from the accepted `vps04-initial` release:

`/opt/review-activator-lab/releases/vps11-admin-real-readonly`

Only `lab-config.js` and `start-vps-lab.mjs` differ for runtime scope selection.
The previous release remains intact for rollback.
The new release manifest passed the existing `verify-vps-lab.mjs` hash verifier.
## Authorization boundary

VPS11 does not add a broad browser bypass.
It adds one membership for the existing synthetic owner to the fixed Asbest company.
The existing RPC still requires both `review_is_admin()` and `vps_lab_private.has_company()`.
The RPC allowlists only the two existing synthetic companies plus the exact Asbest company.
For Asbest it additionally requires the exact location ID and external org ID above.
`service_role` execute is explicitly revoked; `authenticated` retains execute.

Claims/RLS acceptance was executed inside a rollback transaction without using passwords or tokens:

- admin profile rows: 1
- Asbest first page rows: 20
- Asbest total: 72
- unanswered: 12
- cross-company access to synthetic company B: denied with SQLSTATE 42501
- acceptance transaction: ROLLBACK

Review rows were not mutated by the policy change.

## UI acceptance

- `/healthz`: 200
- `/readyz`: 200
- `/admin.html`: 200
- injected runtime contains exact Asbest scope
- synthetic `lab-org-a` is absent from the served runtime scope
- reply/AI draft mutation UI is absent
- the app remains loopback-only on 127.0.0.1:13000
## Tests and postflight

- targeted Node tests: 30/30 PASS
- `npm run check`: 146 PASS
- `git diff --check`: PASS
- current real reviews after change: 72
- duplicate review groups: 0
- Yandex hourly timer: active + enabled
- first scheduled fire remains PASS
- post-change backup: PASS
- post-change monitor: PASS with no failure codes
- Foundation/Auth/API/PostgreSQL remain active

## Explicit limitation

A real browser login was not claimed as PASS in this stage.
Tool safety correctly blocked access to the stored synthetic password.
No attempt was made to bypass that protection.
The authorization contract was therefore validated with transaction-local JWT claims
under PostgreSQL role `authenticated`, plus the served UI/runtime checks above.

Next gate: create/approve a real operator admin login and test the UI through a
controlled SSH tunnel or later HTTPS endpoint. Public HTTPS/domain cutover remains
separate, and Yandex reply WRITE remains disabled.