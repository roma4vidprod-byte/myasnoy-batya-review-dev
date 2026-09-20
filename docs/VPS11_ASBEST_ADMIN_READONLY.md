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
## Real operator onboarding acceptance

A real operator account was created for the approved Asbest admin flow.
The password was supplied interactively through stdin only and is not stored in repository files, helper scripts, command arguments or acceptance evidence.

Temporary signup was enabled only on the loopback Auth service while a local SSH tunnel was active.
Immediately after account creation:

- `GOTRUE_DISABLE_SIGNUP` was restored to `true`
- Auth was restarted and remained active
- the temporary local Auth tunnel on port 19999 was closed
- temporary onboarding helper files were deleted
- the regular admin tunnel on 127.0.0.1:13000 remains available

The account is bound to:

- role: `owner`
- active admin rows: 1
- approved Asbest company memberships: 1
- no additional company membership was added

End-to-end authentication and real review read path:

- direct self-hosted Auth password login: HTTP 200
- login through Review Activator Node proxy: HTTP 200
- `review_admin_profile`: HTTP 200
- `review_admin_reviews_scoped`: HTTP 200
- first page: 20 rows
- total real Asbest reviews: 72
- unanswered reviews: 12
## Backup/restore guard after real operator creation

The existing VPS05 backup preflight originally required exactly three synthetic Auth users.
After adding the approved operator, the first backup correctly failed closed with `SYNTHETIC_SCOPE_FAILED`.

The guard was updated without broadening access:

- allowed Auth set is exactly the historical three synthetic users plus zero or one approved operator
- each synthetic identity must appear exactly once
- the approved operator may appear at most once
- any unknown Auth user fails `AUTH_SCOPE_FAILED`
- when the operator exists, exactly one active `owner` admin row is required
- when the operator exists, exactly one membership is required and it must be the approved Asbest company
- historical pre-VPS11 backup manifests remain restore-compatible

Offline regressions after the guard change:

- VPS05 Python tests: 43/43 PASS
- Python compile: PASS
- `npm run check`: 146 PASS
- `git diff --check`: PASS

Runtime acceptance on VDSina:

- backup after operator creation: PASS
- fresh backup manifest: `/var/backups/review-activator/20260920T090233932138Z/manifest.json`
- first restore attempt reached VERIFY_RESTORE but collided with existing immutable evidence files
- old evidence was archived, not deleted
- restore target database had already been cleaned up
- second restore into isolated temporary DB: PASS
- restore cleanup: PASS
- working source DB remained unchanged
- post-restore monitor: PASS

Final postflight:

- real Yandex reviews: 72
- duplicate review groups: 0
- Yandex timer: active + enabled
- last observed scheduled fire: 12:00:05 MSK
- next scheduled fire: 13:00 MSK
- signup disabled: true
- operator active owner rows: 1
- operator Asbest memberships: 1
## Manual mobile UI acceptance — 2026-09-20

User-performed browser acceptance over a temporary HTTPS preview is **PASS**.

Observed on iPhone:
- real operator login: PASS (`tas.food@yandex.ru`, role `owner`)
- first page: `1–20 of 72`, unanswered `12`
- pagination: page 2 shows `21–40 of 72`
- rating filter `1–3 ★`: `12 of 12`, unanswered `1`
- rating filter `4–5 ★`: `1–20 of 60`, unanswered `11`
- answer filter `Без ответа`: `1–12 of 12`, unanswered `12`

The preview exposed only login/profile/scoped-review read paths.
No reply composer or Yandex write path was present.
Yandex WRITE remained `0`.
Production/public cutover was not performed as part of this acceptance.

**VPS11 MANUAL UI GATE = PASS.**
