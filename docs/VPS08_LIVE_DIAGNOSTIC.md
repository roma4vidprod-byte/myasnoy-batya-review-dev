# VPS08 live diagnostic — historical investigation

Current checkpoint supersedes the initial NOT_RUN observations below: VPS08D read-only acceptance PASS with71 unique,4 pages, sessionREADY4; see `VPS08D_MUTABLE_PAGINATION.md` and `evidence/vps08d/VPS08D_RESULT.json`. VPS08 work was committed as `da98ed313a3d12ce9f8b7af7b50541151d74e346`. Subsequent VPS09 persistence attempt stopped before writing on page1 network failure; see `VPS09_MANUAL_PERSISTENCE.md`. Historical failures/NOT_RUN notes are retained, not represented as current state.

No real session can currently cross the approved source-to-VPS boundary. Pre-live acceptance is **BLOCKED**, despite healthy infrastructure.

Read-only observation at `2026-09-19T13:09:19.248200+00:00`:

- healthz/readyz: 200/200; PostgreSQL, Auth, PostgREST and Node services active.
- VPS clock UTC, NTP enabled and synchronized.
- Worker timer inactive/disabled; connections/queue/running: 0/0/0.
- Synthetic LAB users/reviews: 3/2.
- Monitor PASS, safe codes empty; latest observation `2026-09-19T13:08:44.069252+00:00`.
- Backup timestamp `2026-09-19T12:31:04.949250+00:00`, age at audit 2295 seconds.
- Public listeners SSH only. No ports or firewall settings changed.

Installed VPS04 release manifest: 10 file hashes matched. VPS05/VPS07 operations source and VPS06 worker hashes are recorded separately; the VPS is not claimed to contain the entire current source commit. No Yandex module is installed in the inspected release. Manifest commit metadata was not established by the hash probe (`source_sha`/`sourceSha` lookup returned null).

| Stage | Result | Provider requests | Parsed pages | Counts/completeness |
| --- | --- | ---: | ---: | --- |
| A: page 1 | NOT_RUN | 0 | 0 | UNKNOWN |
| B: one full diagnostic | NOT_RUN | 0 | 0 | UNKNOWN |

Historical 69 reviews are not used as today's expected count. Current total, unique IDs, duplicate count, elapsed provider time and historical delta are unknown. No partial results exist. Session auth/read-contract health remain NOT_TESTED; persistence/scheduler health are outside live acceptance. Native VPS session/CAS acceptance is also NOT_RUN.

The existing health mode can transition through CAS with `auth_ok=true`, `sync_ok=false`; full diagnostic requires READY and does not transition. Any future VPS composition must explicitly account for those existing semantics and disable notifications. No state transition or reconciliation was performed here.

## VPS08A update — 2026-09-19

Stage A/B remain NOT_RUN. New private CLI dispatches only `health` or bounded `full` into the existing service; it does not run the queue worker. Health permits only pageBase=1, uses existing CAS and never updates successful-sync timestamps. Full diagnostic retains the stricter five-page cap. Its VPS adapter can record an actual provider failure through existing health CAS, but cannot clear a changed session or claim an uncertain CAS left the old state intact. Attempted/completed counters survive outer CLI errors.

All of the above is synthetic-test evidence, not a live installation. Post-test read-only audit: healthz/readyz 200/200, LAB 3 users/2 reviews, session/queue/running 0/0/0, new runtime roles 0, worker timer disabled, monitor PASS. No Yandex module/key/roles were installed. Do not infer current total or a delta from the historical 69 reviews.
