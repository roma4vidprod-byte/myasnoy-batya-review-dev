# VPS09 targeted verification — 2026-09-19

Offline implementation PASS is distinct from live acceptance: **first live sync FAILED; writer NOT_RUN**.

| Gate | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: |
| Windows targeted JavaScript | 203 | 0 | 0 |
| Linux targeted JavaScript | 203 | 0 | 0 |
| Windows Python operational tests | 62 | 0 | 0 |
| Linux Python operational tests | 62 | 0 | 0 |
| Native disposable PostgreSQL17.11 | 31 | 0 | 0 |

JavaScript command: `node --import ./test/support/no-network.mjs --test --test-concurrency=1` with `full-contract-diagnostic`, `persistence-plan`, `review-persistence-writer`, `vps08-readonly-boundaries`, `vps08a-session`, `vps08b-contract`, `vps08c-boundary`, `vps08d-pagination`, `vps09-persistence`, `yandex-pagination-probe`, `yandex-session-persist`, and `yandex` test files. All external boundaries use synthetic inputs/fake responses; network hook remains installed.

Python: existing `tools/vps05/test_ops.py`40, `tools/vps08a/test_backup_scope.py`10, new `tools/vps09/test_ops.py`12. New tests retain prior LAB guards; accept only the explicitly authorized real scope; reject lost synthetic rows, unknown scope, bad ratings and any queued job; verify monitor receipt failure/unknown behavior. Monitoring performs no provider polling.

New10 service tests use the real service and existing JS writer, not a mocked service.run. Cover complete mutable71-row batch with owner reply, malformed item, inconsistent total, session race, network error, wrong state/revision/scope, uncertain database failure and diagnostic-option bypass rejection. In every pre-persistence failure writer calls=0; writer uncertainty never retries.

Native31 exercises unchanged actual SQL migrations/RPC in a NEW Unix-socket-only cluster, not the existing LAB. `server_version_num=170011`; no provider requests or existing LAB connections; cleanupPASS. Covers role denial, exact scope/NULL/revision guards, insert, update, unchanged, observation-time no-op, repeated first refusal, duplicate batch, raw/rating/timestamp validation, collision after earlier insertion, mid-loop constraint error rollback, owner reply/raw preservation, synthetic separation, downstream empty, unique identities, session immutability. [Full named cases and SQL hashes](evidence/vps09/VPS09_NATIVE.json).

## Failures preserved, not hidden

- Initial native fixture failed before acceptance cases: required synthetic location city/address omitted. Added explicitly synthetic fields only. Report retained at `/tmp/vps09-native-20260919.json`; cluster cleanup PASS.
- Native v2:31PASS. Then strengthened same-transaction stored-batch verification; final native report again31PASS against the final SQL hash. Final report `/tmp/vps09-native-20260919-final.json` and safe Git evidence.
- Initial Linux source package:202PASS/1FAIL/0SKIP because `tools/vps06/worker.mjs` was absent from test packaging. No application defect. Included existing source dependency; final203PASS. No assertions weakened.
- An administrative SSH connection timeout occurred during offline packaging/tests; it did not start Yandex. The subsequent administrative connection was not a live retry.
- First live sync: `YANDEX_NETWORK_ERROR`, page1,1 attempted/0 completed. No second sync. This is NOT counted as offline PASS or persistence acceptance.

## Other gates

`npm run check`:142 PASS; no code/network execution by this checker. `git diff --check`:PASS. Source package189 files hash-verified and scanned. Four unchanged, reviewed synthetic secret-pattern fixture exceptions; unexpected matches0. Original26 user files hash-matched and excluded from commits.

Journal since installation and bounded current PostgreSQL log were scanned in server memory: known key/IV/tag/ciphertext matches0; secret/PII patterns0; no provider response body received. Only aggregate scan outcomes left the server. This is a scoped check, not proof about all historical logs. No plaintext session file was created.

General QUALITY GATE/REGRESSION HARNESS and unrelated full suite NOT_RUN. Historical36 Recovery09A failures untouched. Cloud/Vercel/Production not used. No source code changed after the failed live attempt; closeout adds evidence/docs only.
