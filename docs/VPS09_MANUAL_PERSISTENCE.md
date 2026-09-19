# VPS09 — manual scoped persistence, live acceptance STOPPED

2026-09-19. Status: **STOPPED_FAIL_CLOSED**, not PASS_VPS09_REAL_PERSISTENCE.
VPS08 checkpoint: `da98ed313a3d12ce9f8b7af7b50541151d74e346` (parent `12d86e776eaf4bb3a943cd1b42be32a52388b6d7`). Branch `codex/yandex-live-read-smoke-01`; no push.

## Existing engine and explicit private entrypoint

`tools/vps08a/session.mjs manual-first|manual-replay` → existing session read/decrypt → `createYandexSessionService.persistManual()` → existing `fetchYandexReviews()` in explicit `MUTABLE_OFFSET` mode → complete batch normalization → existing `createReviewPersistenceWriter()` → private scoped capability adapter → **unchanged** `public.review_persist_external_reviews(uuid,uuid,text,text,jsonb)`.

No second writer, queue, provider transport or HTTP endpoint. This manual flow does not create a sync run: queue/claim/complete/fail are NOT_USED. The default worker is not called. Cloud behavior and default strict legacy reader are unchanged.

The private session CLI at `/opt/review-activator-yandex/tools/vps08a/session.mjs` runs as `review-yandex-reader`, Node `/opt/node/bin/node`, profile `vps-lab`, explicit private mode. No Windows, Cloud credentials or Vercel fallback. The Yandex key was not changed or reimported. Session must remain READY/revision4 before and throughout reading; the database rechecks that state under a row lock during persistence.

Page cap10, page size20, short-page termination, existing response-size/time/HTTPS/host/GET-only/redirect guards remain in force. Persistence is possible only after `STRICT_STABLE_COMPLETE` or `MUTABLE_TOTAL_COMPLETE`; malformed/incomplete pages produce zero writer calls. No page-by-page write. Review identity/item validation is unchanged. Only count metadata is returned.

## Local PostgreSQL capability boundary

`tools/vps09/persistence-access.sql` is a VPS-only adapter, applied once in `review_activator_lab`; historical migrations and the original writer were not rewritten. Its original function-definition hash was equal before/after installation.

Fixed scope: company `13f3cb80-487a-4a19-96a1-fb3103200230`, location `9a95f63b-18e6-447b-a449-8530b67ddbae`, provider `yandex`, external organization `54309413522`.

- `vps_yandex_owner`: NOLOGIN, NOSUPERUSER, NOBYPASSRLS; exact-scope RLS and SELECT/INSERT plus provider-column UPDATE only, no DELETE/local reply-state UPDATE.
- `review-yandex-reader`: execute private `persist_call` only; direct table INSERT and original public writer execution denied.
- anon/authenticated/service_role/web/import roles: private wrapper, original writer and direct INSERT denied. No public API exposure.
- NULL-safe scope/revision/phase guards, maximum200 input rows, no user triggers permitted.
- Transaction advisory lock `(1380013908,9)` serializes this acceptance; session FOR SHARE prevents concurrent credential/state replacement during the atomic writer.
- `first` requires zero existing real rows; `replay` requires existing rows. Duplicate input, collision, malformed batch and database errors roll back through the existing writer.
- Within that same transaction, the adapter verifies each persisted provider field and owner reply equals the submitted normalized batch. Observation-time-only differences remain no-ops under the accepted writer contract.

The three synthetic users and two synthetic reviews remain separately identified by their existing synthetic companies and lab organization IDs, and their row hashes are compared before/after. No real reviews replace synthetic fixtures.

## One-shot administration and uncertainty

`tools/vps09/control.py` pins the LAB host/database/version, installed manifests, first-phase zero real rows, READY4, healthy app, monitor and disabled timer. It creates a protected backup before installing the capability adapter. Source package and native SQL hash must match.

A root0600 durable `VPS09_FIRST.json`/`VPS09_REPLAY.json` attempt marker is created **before** invoking the private CLI. A timeout, missing result or failed first run never authorizes another invocation. Do not delete the marker or bypass it. Replay requires first PASS. Separate read-only metadata can determine effects after uncertainty; it must not invoke Yandex again.

No session transition, provider reconciliation or successful-sync timestamp update is added. A failed transport leaves the previously verified READY4 record unchanged; that is not a fresh health proof. Safe successful-read/persistence timestamps are receipt metadata only, populated only after a confirmed success. No matching, promo, notification, AI, reply queue or owner-reply mutation API can be reached by this path.

## Installed snapshot

Archive SHA256: `808389c2fc21fbea369d3771d555e0e06390fe3ff3ab1a99deac1e7c8f42fc56`.
Source manifest SHA256: `351425aa25c94e4e98ed0d9162ce930cbf08b1bf8da44df84a73ae3fa4076cca`.
This is the VPS08 checkpoint plus explicitly hashed VPS09 working-tree files, not a claim that the unchanged VPS08 commit already contained VPS09.

Installed changes: existing session service, private CLI and peer adapter; added existing writer module to the private release; updated operational backup/monitor module. All24 private runtime file hashes verified after install. Other dependencies were already installed and matched. No service restart, port, SSH, env, key, timer or Cloud change.

## Actual live result and remaining gate

At 18:06:13 UTC exactly one first manual sync was attempted. Page1 failed `YANDEX_NETWORK_ERROR` at TRANSPORT; attempted1/completed0, no HTTP status, parsed0. Underlying DNS/connect/TLS/timeout cause is **UNKNOWN** from the safe error boundary. Do not invent a provider status or assume the request did not reach the provider.

Writer NOT_RUN. All LAB table hashes remain equal, real review INSERT/UPDATE/DELETE=0/0/0. Second sync NOT_RUN. Session READY4 unchanged; 3 users/2 synthetic reviews; no connection rows, queue/runs0; business timer disabled/inactive. Backup after successful persistence NOT_RUN because no accepted persistence occurred.

Next gate requires a separately scoped network-cause investigation and explicit new live attempt budget. No automatic retry, idempotency run, session reimport, provider scheduler or real business workflow is authorized by this stopped attempt.

See [test evidence](VPS09_TEST_EVIDENCE.md), [result](evidence/vps09/VPS09_RESULT.json), and [final report](evidence/vps09/VPS09_FINAL_REPORT.md).

VPS09A follow-up: [network/context diagnostic](VPS09A_NETWORK_DIAGNOSTIC.md) reproduced intermittent no-auth TCP connectivity but did not prove the original OS cause. No new business GET or sync; runtime and failed receipt unchanged. Safe error metadata changes exist locally with targeted regressions, not deployed to the private reader.
