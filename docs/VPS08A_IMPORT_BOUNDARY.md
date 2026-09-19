# VPS08A secure import boundary — installed, awaiting real import

Status: real native import PASS; one row NOT_CONFIGURED/revision1. Subsequent Stage A PASS -> READY/revision2; Stage B failed page4 -> ERROR/revision3. See `docs/evidence/vps08a/VPS08_LIVE_RESULT_20260919.md`. No repeated import is authorized or needed for a contract error.

The owner confirmed ordinary Chrome Default, account myasnoibatya-zakaz, Asbest org54309413522, current Reviews page and installed extension. The former source-confirmation blocker is resolved. UI count70 is informational, not API acceptance. No manual cookie/browser-storage access is used.

## Prepared code

- `scripts/start-yandex-vps-import.ps1`: explicit VPS entry, reuses existing launcher and same-user pipe. Old Cloud entry/default unchanged.
- `scripts/yandex-vps-import.ps1`: fixed pinned reviewadmin SSH, no terminal/secret argv, no HTTP/Cloud fallback. The server process supplies the nonce; reply stays on the same connection.
- `lib/server/yandex-session/vps-import.js`: bounded single-use/TTL candidate validation, VPS encryption, one existing CAS replace, safe result only; rejects duplicate/expired/invalid attempts.
- `tools/vps08a/session.mjs`: intended private OS-role CLI. No default operation; import first-row semantics require current row absent, expectedRevision=0. Candidate expires/shape validated before any write. Key and plaintext buffers are discarded/zeroed where practical; JS strings are GC-managed, not falsely claimed reliably zeroed.
- `tools/vps08a/pg.mjs`: exact Unix socket/LAB DB/OS role; encrypted JSON through psql stdin, safe errors only. No inherited PG/Cloud config or external database target.
- `lib/server/yandex-session/vps-diagnostic.js`: dispatches existing health/full parser/pagination; never queue/persistence/notification. CAS uncertainty reports unknown state instead of old READY.

## Trusted minimum scope

Two read-only queries against `ykiubttldgyjpajmsuas` confirmed:

Company `13f3cb80-487a-4a19-96a1-fb3103200230`, slug `review-dev-yandex-smoke-01-asbest`, name `[DEV SYNTHETIC] Review Activator — Asbest smoke 01`.

Location `9a95f63b-18e6-447b-a449-8530b67ddbae`, name `[DEV SYNTHETIC] Асбест — Yandex 54309413522`, city `Асбест`, address `Ленинградская 41А`. Its company relation matches. Org/account are additionally fixed by existing reviewed configuration.

Continuation installed exactly these two catalog rows on VPS; location active=false. No provider connection, auth user, review, customer session, promo or matching row was copied. Private RPC/role installation and catalog inserts were one transaction.

## Stop / resume boundary

Installed source-only runtime: `/opt/review-activator-yandex`; Node `/opt/node/bin/node`. Two nologin-shell OS accounts share restricted primary group review-yandex. New server key root:review-yandex0640, directory0750; web account cannot read it. DB logins use Unix peer auth and explicit CONNECT only to LAB; no pg_hba/SSH/firewall changes.

Existing HKCU Native Messaging registration points to the current repository's yandex-native-host.ps1. It remains unchanged. VPS launcher must run as the same non-elevated Windows user as Chrome. Explicit entrypoint: scripts/start-yandex-vps-import.ps1. Human action, if required: extension button **Подключить Яндекс Бизнес** with the confirmed Yandex Reviews tab active.

Protected backup + server setup + deployed synthetic gates PASS. Next: one native import -> metadata/decrypt/permission verification -> one Stage A -> only after PASS one Stage B. Stop on uncertain import/CAS/provider failure, no automatic retry. Existing five-page diagnostic cap remains stricter than the ten-page maximum.

Deployed synthetic smoke used installed crypto/store primitives and a disposable PG17.11 cluster: 31 PASS, including encrypted synthetic source through SSH, re-encryption, CAS, cross-profile/wrong-key/AAD rejection. A separate private CLI invalid synthetic candidate was rejected before LAB writes; key loading and actual peer status succeeded. This is not a real browser import attempt. All unrelated LAB row hashes remain unchanged.

Daily backup compatibility: the old guard permitted only two companies/locations and zero sessions. It now permits the exact additional catalog scope and zero/one encrypted session only when the private VPS schema exists; real reviews/users/queue guards are unchanged. Explicit DB CONNECT was added to the two private logins because LAB revokes PUBLIC CONNECT. Regressions: native30 before installation, deployed31, backup40+10 on Windows/Linux.
