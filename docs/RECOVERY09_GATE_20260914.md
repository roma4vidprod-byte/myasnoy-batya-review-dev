# Review Activator — Recovery 09 exact gate

Дата: 2026-09-14. Локальная проверка `myasnoy-batya-review-dev`; удалённые
SQL/DDL, recovery, deployment, push, Yandex, worker, enqueue, scheduler и
Production не выполнялись.

## Package and baseline

- package: `Review_Activator_Recovery09_Verified_2026-09-14.zip`
- package SHA-256: `5048dcea10a762283d956966fcbe03180bf1919e7837ca9a1a2117fb80a50daa`
- starting HEAD: `ae0bd8488fc6711d1379e3d92c595f866536c56e`
- branch: `codex/yandex-live-read-smoke-01`
- prior functional baseline: `c47b83b179b9a94781d55029b4b399c44f9a075b`
- prior integrated patch (already present; not reapplied):
  `2ef5d9c701af1f654c00e0992ebf4bd0813485729f7ce057c5eaaa0993a0eeb7`
- Recovery 09 full patch: `893aaae2161ce1d79c5e3b8aded292a0aa2534fbb50f7016ff71cbd4ff447b64`
- Recovery 09 additions-only patch applied: `d6b1acaa64a570cb58d4c38ac10de54ced32b7ec4c48807f1c1e744198fffa76`

The package verifier first reported `RECOVERY09_NOT_APPLIED`. The full patch
was checked but conflicted only with three pre-existing documentation files:
`docs/CURRENT_BASELINE.md`, `docs/REMEDIATION_REGISTER.md` and
`docs/TEST_EVIDENCE.md`. Its non-document mismatches were empty. The
additions-only patch passed `git apply --check` and was applied once. No reset,
clean, force operation or overwrite of existing source was used.

The user untracked file `Invoke-ReviewFullDiagnostic-Once.ps1` was preserved,
not staged and not changed.

## Recovery files

Normalized SHA-256 values before the test-fixture-only timezone correction:

| File | Package normalized SHA-256 |
|---|---|
| `docs/CONTRACT_DRIFT_RECOVERY_09.md` | `59a9c1f2226595dc2d68f822319d29f979e000e116903f7f7057e2dacd3e3e66` |
| `supabase/migrations/20260914210000_yandex_contract_recovery_admin_09.sql` | `2bd1f0db934c8f8763b3e8aed621eaf2d382f7d3e28056415f420f1e39b993d7` |
| `test/yandex-contract-recovery.test.mjs` | `7ebcd0b5c2edb6df88d6010dc7b97119e59d4e0c8bf7e800dc8e0641d3f84709` |
| `tools/contract-recovery/native-concurrency.py` | `3638e9bc995c9eba074cea1d0564db9157cf2b628fc7895481a1a4d31a7320f1` |

The fixture was minimally corrected after the first test run. The two
connection rows used timezone-less timestamps, which PGlite interpreted in
the host timezone; the test compared them with explicit UTC timestamps and
reported `RECOVERY_CONNECTION_CHANGED`. Only those synthetic fixture literals
were changed to explicit `Z` timestamps. The final normalized SHA-256 of
`test/support/contract-recovery-fixture.mjs` is
`f68a8235276f3775b5f50564dc3a0393d6b1c8300b0481e1567375f3ce0e8e6b`.
Recovery SQL and runtime code were not changed.

## Tests and gates

- Recovery 09 exact test, with `--test-concurrency=1`: **103 pass / 0 fail**.
- Full Windows `npm test`: **592 pass / 0 fail / 0 cancelled / 0 skipped / 0 todo**.
- `npm run check`: **PASS, 109 source/fixture/inline checks**; no code execution or network.
- `git diff --check`: **PASS**.
- Existing suite preload remained the no-network harness.
- No remote database connection or external request was used by these gates.

The initial Recovery 09 run had 75 pass / 28 fail. All 28 failures had the
same synthetic timezone interpretation issue described above. After the
fixture-only correction, the exact recovery test and the full suite passed.

## Native PostgreSQL 17 gate

`tools/contract-recovery/native-concurrency.py` is present and its CLI was
verified. The six real concurrent scenarios were **NOT_RUN** because this
Windows host has no installed WSL distribution, no native PostgreSQL 17
`initdb`/`pg_ctl`/`psql` binaries, and no Docker/Podman runtime. The runner
was not substituted with PGlite, and no installation or OS mutation was
attempted.

Remaining blocker: run the supplied runner in a disposable Linux/WSL
environment with PostgreSQL 17 binaries, then retain its report as separate
native-gate evidence.

## External effects

- remote SQL/DDL/recovery: `0`
- deployments/pushes: `0`
- Yandex requests/writes: `0`
- enqueue/worker/scheduler changes: `0`
- Production/Business OS changes: `0`
- emails/Telegram/AI/promo: `0`

This is a local Recovery 09 gate result only; it does not claim native
PostgreSQL concurrency acceptance or remote deployment acceptance.
