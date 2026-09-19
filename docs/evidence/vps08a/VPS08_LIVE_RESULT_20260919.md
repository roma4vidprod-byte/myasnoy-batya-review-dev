# VPS08 live result — 2026-09-19

STATUS: **YANDEX_PAGE1_PASS / FULL_DIAGNOSTIC_BLOCKED**.

Exact safe error: `YANDEX_CONTRACT_DRIFT`. No retry or automatic remediation.

## Actual sequence

| Step | Requests/result | Session |
| --- | --- | --- |
| Prior native import | One effective encrypted replacement; no repeat in this step | NOT_CONFIGURED / revision1 |
| Immediate preflight | One exact scoped row; runtime22 hashes match; 200/200, LAB3/2, queue/running0/0, timer OFF | NOT_CONFIGURED /1 |
| Stage A | One GET page1; HTTP200;20 items; parser/contract PASS;1302ms | Existing health CAS: READY /2 |
| Stage B | One full invocation; GET pages1–4; all HTTP200; first3 pages parse,60 validated items;2900ms | Existing failure CAS: ERROR /3 |
| Read-only post-check | One scoped row, unrelated table hashes unchanged, LAB3/2, queue/running0/0, 200/200 | ERROR /3; YANDEX_CONTRACT_DRIFT |

Stage A succeeded through the existing strict transport/parser: HTTPS exact allowlisted yandex.ru read path, manual redirects, JSON check, login/challenge rejection, 2MB cap and10-second request timeout. No alternate parser/provider transport or credential fallback was used. Health timestamp `2026-09-19T16:19:24.088114+00:00`; successful-review-sync timestamp remains null. This was not a persisted sync.

Stage B retained the existing stricter five-page/30-second diagnostic cap (user maximum10). Page4 is the first unparsed page after four sequential completed GETs, with no retry. The **exact field/item/type is UNKNOWN**: the existing service builds rule-level parser metadata, but the installed CLI projects it away (`tools/vps08a/session.mjs:61`, `lib/server/yandex-session/service.js:239`). Raw response is not retained. No new GET, parser patch, session reset, reconciliation or READY override was attempted.

60 is the number on validated pages, **not** the full provider total. Unique count, duplicates, pager total, completeness and deltas versus69/API and70/UI are not established. Do not infer a completed70-review snapshot from UI or the partial count. The historical Cloud contract failure is not proven to have this same cause.

## Boundaries and effects

- Exact Yandex network budget used: **5 GET** (1 Stage A +4 Stage B), hostname yandex.ru; mutation methods0, redirect following0, retries0.
- Real review INSERT/UPDATE/DELETE **0/0/0**. Scoped reader has no review table/write RPC capability; the application-table hashes match the protected pre-install baseline, excluding only deliberately introduced company/location and session metadata.
- Session CAS writes **2**, so total DB writes are **not zero**. Material/key/envelope were not replaced in this step; real import had already completed in the preceding step.
- 2GIS, email, Telegram, AI, promo, matching, enqueue, business worker, scheduler changes, Supabase Cloud/Vercel operations, Business OS and Production changes: **0**.
- Normal web/API session access remains denied. Key is root-owned0640; no key values in report.
- Post-check healthz/readyz **200/200**, monitor PASS, public TCP SSH only. Worker timer disabled. Reboot NOT_RUN; out-of-band blocker unchanged.

Named app/Auth/PostgREST/PostgreSQL/worker journals since installation were scanned server-side. Exact key/ciphertext matches0; credential-header/raw-provider/raw-envelope patterns0. No raw logs or cookies were emitted. Imported browser plaintext was only in the approved process/channel; this live CLI emits safe aggregates only. This is bounded scan evidence, not a claim to have inspected every log on the machine.

## Git / tests

Start/current HEAD `12d86e776eaf4bb3a943cd1b42be32a52388b6d7`, branch `codex/yandex-live-read-smoke-01`; runtime snapshot is the previously installed manifest, not a new deploy. Runtime logic unchanged in this live step. No commit/push because full live acceptance failed; prepared VPS08A diff retained.

Previously executed synthetic gates remain separately recorded: Windows96, Linux56, native30 then deployed31; updated backup tests50 on both Windows/Linux; check136. These are **not rerun or relabelled as live acceptance** here. This step ran preflight, one Stage A, one Stage B, post-check and bounded log scan. General quality harness and historical full suite NOT_RUN.

Next safe step: a separately scoped rule-level page4 diagnostic, after addressing the existing CLI's safe-field projection. No new request is made here. Full VPS08 PASS, persistence/scheduler readiness and historical root cause are **not claimed**.
