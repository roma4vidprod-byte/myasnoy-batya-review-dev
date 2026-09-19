# VPS07 tests and acceptance

Date2026-09-19. No general QUALITY GATE/REGRESSION HARNESS. Historical688PASS/36Recovery09A failures unchanged, unrelated full suite not rerun.

| Actual gate | PASS | FAIL | SKIP |
| --- | ---: | ---: | ---: |
| New VPS07 Windows Python |28|0|0|
| New VPS07 native Linux Python |28|0|0|
| Relevant existing VPS05 Windows Python |40|0|0|
| Relevant existing VPS05 Linux Python |40|0|0|
| npm run check |127|0|0|

Tests use installed cryptography and synthetic material. Coverage: fresh random nonce, authenticated roundtrip, wrong key, corrupt ciphertext/tag/nonce/header, truncated/oversize input, full hash/size check, disk roundtrip, traversal/link/duplicate archive refusal, per-member hashes, monitor stale/unknown/future/missing-key/hash/restore failure, key-stat-only observation, retrieved-copy restore adapter, cleanup and existing-target refusal. VPS05 regressions cover native restore-error cleanup, schema/data/RLS drift and resource/readiness monitoring.

Native acceptance used **real encrypted archive returned from Windows** and native PostgreSQL170011. Restore/schema/all-table digest/RLS/ACL checks PASS. Actual wrong-key, ciphertext-corruption and mismatched-hash checks each refused. All three negative checks PASS. No PGlite substitutes.

Existing systemd monitor observed off-host metadata and returned PASS. healthz/readyz200. Original LAB full snapshot unchanged; new test DB removed; returned redundant recovery key removed. Backups and original/persistent keys retained. No extracted plaintext configuration files were written.

Safe raw test logs are outside the repository in `C:\Users\tasfo\BusinessOS\Review-Activator-Tools\reports\vps07-20260919`. Evidence JSON includes report hashes, installed source comparison, original26 untracked preservation, existing secret-pattern scan, diff-check and current service/listener status. Review these artifacts for exact assertions, not historic counts.
