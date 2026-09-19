# VPS08A — current status: PAGE1 PASS / FULL DIAGNOSTIC BLOCKED

Latest actual result: [VPS08 live result 2026-09-19](VPS08_LIVE_RESULT_20260919.md), with adjacent machine-readable JSON. Source confirmed, runtime installed, one real native import succeeded, Stage A PASS, Stage B stopped on page4 YANDEX_CONTRACT_DRIFT. Current session ERROR/revision3. No repeat GET/import/recovery. The source-confirmation blocker below is **historical and resolved**.

## Historical initial preparation checkpoint (superseded by continuation)

Local implementation and synthetic gates completed; actual migration/live acceptance NOT_RUN. This status means the current valid source has not been established, not a proven expired session or failed Yandex login.

Git start/final HEAD `12d86e776eaf4bb3a943cd1b42be32a52388b6d7`, branch `codex/yandex-live-read-smoke-01`. No commit/push. Existing 41 untracked files were hashed before edits: 26 original user files and 15 VPS08 files. Original evidence/test files retained; five VPS08 documents receive append-only updates. Runtime candidate remains a working-tree diff, not installed release provenance.

Implemented explicit isolated VPS AAD/context, the private-role adapter to original session CAS, same-flow Native Messaging SSH/stdin target, one-use importer and existing-service health/full dispatch. Cloud defaults, existing schema migrations, synthetic worker and business timer are unchanged. Public Node never receives a key.

| Gate | Result |
| --- | --- |
| Cloud/VPS crypto roundtrip and cross-profile rejection | Synthetic PASS |
| Public/API denied, importer/reader least privilege | Disposable native PG17 PASS; LAB installation NOT_RUN |
| Windows/PowerShell targeted | 96 PASS / 0 FAIL / 0 SKIP |
| Linux targeted | 56 PASS / 0 FAIL / 0 SKIP |
| Native session/CAS/RLS | 30 PASS / 0 FAIL; server_version_num170011; cleanup PASS |
| npm run check | 136 PASS |
| Real source / key provisioning / import | UNKNOWN / NOT_RUN / NOT_RUN |
| Real plaintext artifacts | 0; only synthetic material used |
| Session before/after | No VPS row, state/revision absent; import attempts/effective replacements0/0 |
| Stage A / Stage B | NOT_RUN / NOT_RUN |
| Current review total/unique/duplicates/pager/delta | UNKNOWN |
| Yandex hosts/methods actually contacted | None |
| Real review inserts/updates/deletes | 0/0/0 |
| LAB users/reviews, queue/running | 3/2, 0/0 |
| healthz/readyz | 200/200 |
| Public TCP | SSH only; 127/8 DNS sockets are loopback, not public |
| Monitor / real worker timer | PASS / disabled |
| Reboot | NOT_RUN; out-of-band blocker unchanged |

Tests included real Windows Native Messaging dispatch with synthetic messages. Earlier test packaging/path failures are retained in external test logs and are not reclassified as successful runs. Final test gates above are actual re-executions. Three disposable PostgreSQL clusters were created/stopped/removed; no connection to LAB was used by these tests. LAB was separately inspected read-only afterwards.

Effects: Supabase Cloud read-only catalog operations **2**, Cloud writes0; Vercel reads/writes0; Yandex GET/mutations0; 2GIS/email/Telegram/AI/promo0; LAB database/role/key/scope mutations0; worker/enqueue/scheduler0; new backup/off-host copy0; Business OS/Production0. Temporary test-source transfers and disposable native SQL are the only server-side test mutations. No secret extraction, browser session read or real credential log existed. Post-import log/key-permission checks remain NOT_RUN.

Remaining blocker: operator confirmation/access to the ordinary Chrome technical-account profile and extension, then actual private runtime provisioning and one secure import. No source key is requested and no cookies may be pasted into chat. Existing launcher must not be run before server preparation. Full acceptance/commit is deferred; no autonomous Yandex integration readiness is claimed.

See [crypto](../../VPS08A_CRYPTO_PROFILE.md), [import boundary](../../VPS08A_IMPORT_BOUNDARY.md), and adjacent test/postflight/check JSON. Next step remains within the already authorized task, not real review persistence or scheduling.
