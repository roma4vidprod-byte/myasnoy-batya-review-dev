# VPS06 — failure model

Only fixed safe codes/stages and booleans/counts/timestamps are emitted. No raw error/message/stack/cause, SQL payload, credentials or provider data. Provider calls are structurally absent and systemd blocks IP sockets. Reports cannot substitute for packet capture; evidence is the installed graph, explicit mode checks and OS network boundary.

| Condition | Result / evidence |
| --- | --- |
| Wrong/cloud profile | PROFILE_DENIED, before DB connection; Windows/Linux tests and native units |
| Missing/real/ambiguous mode | SYNTHETIC_MODE_REQUIRED, no fallback; native units |
| Cloud/provider env present | CLOUD_ENV_DENIED before child spawn; targeted regression |
| DB unavailable | DB_OPERATION_FAILED / DB_READINESS; actual isolated-unit Unix socket denial, live PG stayed up |
| PostgREST unavailable | NOT_APPLICABLE: worker does not use PostgREST; no simulated dependency claim |
| Lock busy | ALREADY_RUNNING exit0, no queue/RPC work; actual parallel workers |
| Claim RPC failure | rollback; DB_OPERATION_FAILED / CLAIM, no retry |
| Processing/stale/invalid job | fail RPC once with existing SYNC_OPERATION_FAILED code; PROCESS_FAILED exit1 |
| Complete RPC failure | rollback; DB_OPERATION_FAILED / COMPLETE, no second finalization attempt |
| Unexpected processor exception | sanitized PROCESS_FAILED, exactly one fail; real PG acceptance injection |
| Timeout | systemd records timeout; Node SIGTERM aborts PG child; claim rolled back |
| SIGTERM/SIGKILL | rollback/released lock; systemd failure/stopping evidence preserved |
| Unknown commit outcome | stage COMMIT, stop; read-only investigation before any retry |

Temporary fault injection affected only the new worker role/units and its disposable fixture. Actual PostgreSQL/Auth/PostgREST/Node services were not stopped. Timer and fixture cleanup ran in finally blocks. No real company/location/session/review data entered the processor.

## Monitoring

Existing `tools/vps05/ops.py` now adds optional worker observation via systemctl show and safe local status files. It reads last execution/success, result, timer active/enabled state and lock refusal. Disabled timer is accepted. A failed latest worker result becomes WORKER_FAILED. Monitoring **never runs the worker**, claims a job, queries the queue or sends notifications.

An actual injected guard failure was detected by the hardened monitor service. After a successful empty worker, monitor returned PASS. That expected monitor failure was saved, then explicitly acknowledged; it was not erased from evidence. Historical failures remain in journal/evidence; no total failure counter is fabricated. Latest status can be overwritten by a later invocation, and lock-refusal evidence also resides in the worker journal/native report.

No user notification, external alerting or automated recovery was added.
