# VPS08 offline tests — 2026-09-19

New file: `test/vps08-readonly-boundaries.test.mjs` (16 tests). No runtime implementation was modified. These tests document the current fail-closed boundary; they are not a VPS live gate.

Executed on Windows with the existing network-deny preload and serial test setting:

```text
node --import ./test/support/no-network.mjs --test --test-concurrency=1 test/vps08-readonly-boundaries.test.mjs test/yandex.test.mjs test/yandex-session-decrypt-classification.test.mjs test/yandex-health-execution.test.mjs
```

| Actual gate | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: |
| Selected Node regressions, including 16 new | 57 | 0 | 0 |
| npm run check | 128 | 0 | 0 |

Coverage: VPS profile rejects transport/store/Cloud encryption before network; unknown profile refusal; method/host/path/scope/approval checks; expired synthetic cookie; simulated fetch failure; redirect/login/challenge/malformed/oversize responses; full diagnostic no writer/transition/notification; redacted output; five-page cap; missing row/state/revision guard. Relevant existing tests exercise real handler/service with fake storage/CAS and transport, health READY transition and safe error stages.

Fixtures use only synthetic cookies/keys/reviews. The explicit `cloud-dev` test context exercises existing source contracts with injected fake boundaries; it does not switch any installed VPS process to Cloud. The test described as timeout simulation injects a fetch exception; it does not prove wall-clock cancellation against a real provider.

Linux/VPS targeted session tests and native positive session/CAS acceptance: NOT_RUN, blocked before session/runtime adaptation. No full historical suite or general QUALITY GATE/REGRESSION HARNESS was run. Historical Recovery09A failures were not changed.

Safe local logs: `C:\Users\tasfo\BusinessOS\Review-Activator-Tools\reports\vps08-20260919\targeted.txt` and `check.txt`. Final checks record hashes, diff check, original 26-file preservation and existing secret-pattern scan. No live test count is inferred from offline PASS.

## VPS08A update — 2026-09-19

| Final targeted gate | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: |
| Windows Node + actual PowerShell Native dispatch/regressions | 96 | 0 | 0 |
| Linux Node (no-network preload; Windows-only cases excluded) | 56 | 0 | 0 |
| Native PostgreSQL 17.11 private disposable cluster | 30 | 0 | 0 |
| npm run check | 136 | 0 | 0 |

Native `server_version_num=170011`; tested the unchanged session migration/RPC plus new private role wrapper, real grants/RLS and CAS, not PGlite. Final 30 cases include direct table/RPC denials, public roles, wrong scope, nulls, stale/duplicate CAS, immutable credentials during transitions and protection of sync timestamps. Test-cluster auth is private Unix-socket trust in a 0700 temporary directory; deployed peer-auth provisioning is not inferred from it. Two earlier successful 26-case runs are historical iterations, not added to the final count. All three clusters were cleaned up.

Logs/report hashes live under `Review-Activator-Tools/reports/vps08a-20260919`; `linux-targeted.txt` retains the four earlier packaging failures. Final logs are `windows-accepted.txt`, `linux-complete.txt`, `native-accepted.json`, `check.txt`. No historical full suite or general QUALITY GATE/REGRESSION HARNESS. Real secure import, live transport and installed key-permission acceptance remain NOT_RUN.
