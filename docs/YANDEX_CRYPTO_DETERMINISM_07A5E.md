# Yandex crypto determinism audit 07A.5E

Read-only follow-up for Review Activator DEV. No Yandex request, import,
rotation, enqueue, worker, scheduler change, or remote database write was
performed by this audit.

## Immutable snapshot

The test reads the session row once, clones the returned JSONB-shaped row in
memory, and uses that same snapshot for every decrypt attempt. It records only
safe tuple metadata and SHA-256 fingerprints; plaintext, key material and raw
envelope values are not emitted.

The snapshot includes revision, credential version, envelope version/KID, IV,
tag and ciphertext. AAD is derived once from the fixed scope and credential
version and is fingerprinted only.

## Determinism results

- Same process: `100 PASS / 0 FAIL`.
- Two independent child processes, each receiving the same serialized snapshot
  and decoded 32-byte key: `100 PASS / 0 FAIL` in each process.
- Before/after snapshot fingerprints: identical.
- JSONB round-trip: PASS.
- Historical comparison with the last known-good production of a decryptable
  envelope: unavailable; no independent historical tuple was persisted.

The repeated attempts are deterministic. A mixed result was not observed, so
the evidence does not support a nondeterministic crypto runtime failure.

## Writer audit

The only session storage boundary is
`public.review_yandex_session_store(...)`, executed through the existing
server-only store adapter.

- `replace` is the import/replace/rotate path. It requires the expected
  revision and atomically writes a new credential version and envelope while
  incrementing revision.
- `transition` changes lifecycle/status metadata and increments revision. For
  every state except `DISABLED`, it assigns the existing envelope and
  credential version unchanged. `DISABLED` clears both in the same revisioned
  update.
- `claim_alert` changes only alert-claim metadata.
- No trigger or separate direct SQL writer for session crypto material was
  found in the repository.

Therefore crypto material cannot change through the ordinary state transition
without the same row revision increment. Any replacement or clearing of
material is explicit and CAS-fenced.

## Regression coverage

`test/yandex-session.test.mjs` covers:

- 100 repeated decrypts of one immutable snapshot;
- two independent processes using the same snapshot and key;
- JSONB tuple round-trip;
- `READY -> ERROR` and `ERROR -> REAUTH_REQUIRED` preserving material;
- replacement incrementing revision and changing the crypto tuple;
- `DISABLED` clearing material and incrementing revision;
- concurrent CAS replacement allowing one winner only.

## Verdict

`CURRENT_ENVELOPE_DETERMINISTIC_PASS`

Additional safety finding: `CRYPTO_MATERIAL_CAN_CHANGE_WITHOUT_REVISION = NO`.
The prior 07A.5D runtime-anomaly conclusion remains provisional because its
historical envelope comparison was unavailable; it is not reproduced by this
same-input determinism audit.
