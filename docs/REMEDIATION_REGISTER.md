> **Локальное дополнение 2026-09-14 (не deployment):** на переданном baseline f848d8ba9cf3e6890eca6ba79e16f210eaa066fa интегрирован патч ASSIST-01–05. См. `ASSISTANT_LOCAL_PATCH_20260914.md`. Runtime остаётся на прежнем f848d8b. Linux full run: 423 PASS / 56 FAIL / 10 existing SKIP; те же PowerShell-ограничения были у исходника (311/56/10). 112 новых проверок PASS; targeted 165/165; 93 JS/JSON/inline checks PASS, 14 PS parse checks NOT_RUN. Windows full gate и live acceptance не пройдены заново. Не переносить прежние PASS на новый runtime и не закрывать все AUD. Final local commit указан в внешнем PATCH_MANIFEST.json, не выдумывается внутри собственного commit.

# AUD-01–AUD-29 Remediation Register

Проверка: 2026-09-14. `PASS` означает только подтверждённую границу, указанную в evidence; `PARTIAL`, `BLOCKED` и `UNKNOWN` не считаются закрытием полного пункта.

| ID | Фактически обнаружено | Root cause | Изменено / evidence | Статус / остаточный blocker |
|---|---|---|---|---|
| AUD-01 | Локальный HEAD воспроизводим; remote main старее | Историческая deployment provenance не полностью доступна | `docs/CURRENT_BASELINE.md`; git baseline | PASS source / deployment provenance UNKNOWN |
| AUD-02 | Исторические проценты готовности не являются приёмкой | Смешение фаз | Статусы разделены в этом реестре и отчёте | PASS documentation / full integration not claimed |
| AUD-03 | Safe provenance/determinism уже есть | Исторический сбой не восстанавливается без snapshot | `docs/YANDEX_CRYPTO_*`, существующие tests | PASS current evidence / historical comparison unavailable |
| AUD-04 | Offline preflight и provider health разделены в коде | Разные режимы требуют разных доказательств | existing preflight/health tests | PASS local / no new live check |
| AUD-05 | Session/connection/job paths имеют scoped reconciliation и CAS tests | State transition must not mutate credentials | existing migrations/tests | PASS targeted / remote state not re-read |
| AUD-06 | Parser has schema-only failure and strict required fields | Silent `[]` on drift is unsafe | existing provider/diagnostic fixtures | PASS local |
| AUD-07 | Pagination consistency checks exist; provider snapshot is not guaranteed | Yandex feed can shift | existing pagination tests/docs | PARTIAL; no strict provider snapshot |
| AUD-08 | Counts/idempotency are computed from snapshot; observed_at excluded | Previous replay bug | existing atomic writer tests | PASS local |
| AUD-09 | Core scoped writer/queue/admin read negative tests exist | Full tenant proof spans unavailable remote schema/callers | existing DB boundary tests | PARTIAL; disabled-admin/company-A/B live matrix not run |
| AUD-10 | Matching implementation is not present in this source tree | No authoritative matching engine to patch | no wildcard path found; no auto-match run | BLOCKED dependency; no promo/matching enabled |
| AUD-11 | Queue claim/enqueue is scoped and tested | Crash/lease acceptance is broader than local tests | existing queue tests | PARTIAL; no natural scheduler acceptance |
| AUD-12 | Scheduler is kept disabled; no Vercel hourly cron added | Platform transport/plan evidence is external | existing migration/checks; no config change | BLOCKED until platform/job audit |
| AUD-13 | Runtime code uses server-side env, not PowerShell | Local bootstrap must not be runtime dependency | existing runtime/import tests | PASS design/local; natural closed-PC acceptance pending |
| AUD-14 | Native Messaging v4 has fixed scope/nonce/metadata tests | Expanded browser boundary needs operator proof | existing extension/native tests | PASS synthetic; no real import this run |
| AUD-15 | Alert taxonomy/dedup and no retry-on-fail are tested | Delivery channels remain external | existing alert tests | PARTIAL delivery evidence is mocked |
| AUD-16 | Feedback persists before independent channel attempts | Durable outbox/idempotency across duplicate POST not evidenced in source | no new delivery engine added | UNKNOWN / requires authoritative DB function and policy |
| AUD-17 | Promo import endpoint exists, but authoritative reservation schema is absent locally | Entitlement policy/ledger not provable | no live promo action | BLOCKED product/DB evidence |
| AUD-18 | Author proof is not established by Yandex payload | No approved identity rule | matching not enabled | BLOCKED business decision |
| AUD-19 | Selective positive-review incentive must not be activated | Policy not approved | promo/mutation fence remains | BLOCKED product decision |
| AUD-20 | DEV auth callback uses exact origin allowlist | Auth SMTP/rate limits are platform state | existing auth redirect tests/docs | PASS code / SMTP live status UNKNOWN |
| AUD-21 | Yandex write/reply transport is absent/read-only | No confirmed write contract | no write path added | BLOCKED separate approval/contract |
| AUD-22 | Endpoint contract is `reviewId`; no frontend caller mismatch found | Historical mismatch was unconfirmed | added safe error regression; endpoint still draft-only | PASS source / paid AI live test not run |
| AUD-23 | Real-data classification is not represented in local schema docs | Former synthetic label can mislead cleanup | no cleanup/destructive query added | PARTIAL; remote metadata audit pending |
| AUD-24 | Escaping and auth checks exist; public form rate/outbox policy not proven | Scope spans external DB/functions | no broad policy invented | PARTIAL / remote schema and abuse tests pending |
| AUD-25 | Current local suite is evidence, not universal harness | Default parallel Node runner intermittently raced Windows PowerShell/native subprocesses | `package.json` uses deterministic `--test-concurrency=1`; 20/20 targeted native runs and serial full suite pass | PASS local gate; QUALITY GATE intentionally not run |
| AUD-26 | Historical/current facts were mixed in handoff | Missing dated state model | baseline/register/decision/report docs added | PASS documentation |
| AUD-27 | Migration files and isolated tests are present | Remote ledger/restore unavailable in this run | migrations not applied remotely | PARTIAL / remote schema ledger and restore pending |
| AUD-28 | No confirmed 2GIS transport contract in source/evidence | Provider capabilities absent | no second engine or invented adapter | BLOCKED dependency |
| AUD-29 | Vercel/Supabase plan and current quotas not verified here | Platform facts are account state | no infrastructure mutation | BLOCKED platform verification |

## New remediation

| ID | Defect | Fix | Evidence |
|---|---|---|---|
| NEW-01 | AI draft catch reflected arbitrary `error.message` to client | Added allowlisted status/code mapping in `api/admin-review-reply-draft.js` | `test/admin-reply-draft-security.test.mjs` |
| NEW-02 | Health execution exceptions before `service.run` completion were collapsed by the outer handler catch into generic `SYNC_OPERATION_FAILED`, `NOT_STARTED`, zero counters and null post-state | Moved the initial session read into the service's classified boundary; added allowlisted stage/CAS/transport telemetry and injectable external fetch boundary; preserved non-health `SESSION_CHANGED` fail-fast semantics | `lib/server/yandex-session/service.js`, `lib/server/review-sync-worker.js`, `lib/server/yandex-session/crypto.js`, `test/yandex-health-execution.test.mjs`; local synthetic regression PASS; live incident equivalence remains unproven without the prohibited repeat |
