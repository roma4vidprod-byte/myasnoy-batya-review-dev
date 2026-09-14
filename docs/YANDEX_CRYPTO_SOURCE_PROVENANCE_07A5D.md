# Yandex crypto source provenance audit 07A.5D

## Session source trace

| Path | Entry point | Store/decrypt path | Session source |
|---|---|---|---|
| Health | protected worker `operation=health` | preflight `store.read` + `decryptSession`; then service `run`, which reads/decrypts again | `DB_ENCRYPTED_SESSION` |
| Local pagination probe | `scripts/yandex-pagination-probe-02.mjs` | `createSessionStore().read` + service `run(pagination_probe)` + `decryptSession` | `DB_ENCRYPTED_SESSION` |
| Diagnostic page 1 | protected worker `operation=contract_diagnostic` | preflight `store.read` + `decryptSession`; then `contractDiagnostic` reads/decrypts the same scope before GET | `DB_ENCRYPTED_SESSION` |
| Diagnostic page 2 | protected worker `operation=contract_diagnostic_page` | failed in preflight `store.read` + `decryptSession`; no transport call | `DB_ENCRYPTED_SESSION` |
| Worker | protected worker default path | claim RPC, service `run(persist)`, `store.read`, `decryptSession`, then transport | `DB_ENCRYPTED_SESSION` |

The diagnostic page-1 response had `revision=11`, `pretransport=PASS`,
`decrypt=PASS`, and `yandex_requests=1`. The code path requires the DB row and
its envelope to be read and decrypted before the transport is constructed and
called. It is therefore evidence for the current DB-encrypted session, not a
request-payload or local in-memory import.

The page-2 response failed in preflight with `yandex_requests=0`; it never
reached a page-specific parser.

## Transition immutability

`review_yandex_session_store(..., 'transition', ...)` updates state, error,
session/sync timestamps, incident, alert claim, revision, and `updated_at`.
For every non-`DISABLED` transition it assigns `envelope=envelope` and
`credential_version=credential_version`. Only `DISABLED` clears credentials.

Regression coverage confirms that `READY → ERROR` preserves
`credential_version`, `envelope.v`, `kid`, `iv`, `tag`, and `ciphertext` exactly
through the DB JSONB round-trip.

## Safe tuple fingerprints

Current DEV row has one session row, revision `11`, and KID
`dev-smoke-70a003d2b2904aa487d6351f1f773438`.

Only shortened fingerprints are recorded:

- AES key: `dae1e40bfd91…27c996788373`
- credential version: `3f5acdd454d3…666dd9c8f02f`
- IV: `072d008fffaa…92f04672457b`
- tag: `2d1c958f8967…502b8ee5f2f9`
- ciphertext: `1b978a1cbd57…680822803346`
- AAD: `2abcd4562506…31e30bfce79a`

Historical full tuple fingerprints for the last known-good decrypt are not
stored separately: `HISTORICAL ENVELOPE COMPARISON = UNAVAILABLE`.

## Verdict

`TRUE_CRYPTO_RUNTIME_ANOMALY`

This verdict is limited to the available evidence: page 1 previously proved
the DB-backed decrypt path and made one GET, while the same revision/KID/key
fingerprint/envelope/AAD evidence now fails before transport in all current
Preview runtimes. No automatic repair, re-import, rotation, state change or
retry is performed by this audit.
