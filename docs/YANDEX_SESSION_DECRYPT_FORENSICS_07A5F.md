# Yandex session decrypt forensics 07A.5F

## Scope and safety

This checkpoint adds safe failure classification to the existing Review
Activator DEV server-side preflight. It does not read or modify the current
DEV session, perform a Yandex request, import or rotate a key, enqueue a job,
run a worker, change the scheduler, or write the database.

The current public boundary remains the protected
`POST /api/internal/review-sync-worker` with
`{"operation":"preflight"}`. Only allowlisted codes and stage labels can be
returned. Raw keys, cookies, plaintext, IVs, authentication tags, ciphertext
and exception text are never returned.

## Change

The existing `decryptSession()` contract still maps all failures to the
backward-compatible `SESSION_DECRYPT_FAILED` code. The preflight uses the new
internal `decryptSessionClassified()` path and reports these safe stages:

- envelope structure;
- key lookup, encoding and length;
- IV, authentication-tag and ciphertext schema;
- AAD construction;
- AES-GCM authentication/decrypt;
- plaintext UTF-8 decoding;
- plaintext JSON parsing;
- validated session schema.

`decrypt=FAIL` is emitted only for the AES-GCM authentication stage. If AES
decryption succeeds but plaintext encoding, JSON, or session schema validation
fails, `decrypt=PASS` and `validation=FAIL` are reported. Failures before
decrypt remain `NOT_RUN` for the decrypt/validation status fields.

## Evidence status

The historical Preview response only established the safe generic
`SESSION_DECRYPT_FAILED` result. It did not identify the failing stage because
the old code collapsed all stages into one code. The exact current DEV root
cause is therefore **UNKNOWN — evidence insufficient** until a new patched
Preview preflight is run once with the existing operator-held worker secret.

No session revision or encrypted envelope was changed by this checkpoint.

## Regression coverage

The targeted suite covers:

- valid decrypt;
- same-KID wrong key and wrong AAD;
- corrupted authentication tag and ciphertext;
- malformed envelope and missing/invalid key material;
- AES-success with invalid JSON or invalid session schema;
- safe authenticated HTTP preflight response with no raw diagnostics.

All tests use synthetic fixtures and the no-network guard.
