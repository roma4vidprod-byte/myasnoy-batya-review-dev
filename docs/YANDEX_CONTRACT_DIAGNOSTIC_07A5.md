# Yandex contract diagnostic 07A.5

This DEV-only diagnostic uses the existing protected
`/api/internal/review-sync-worker` boundary with the strict body:

```json
{"operation":"contract_diagnostic"}
```

It performs one server-side `GET` for Asbest page `1`, validates the response
through the existing Yandex parser, and returns only status/content type,
pagination values, field presence/type counts, unexpected keys, and the
allowlisted parser failure point. It never returns review values, cookies,
CSRF material, raw payload, or session material.

The operation does not claim or create a sync run, persist reviews, transition
session state, update connection state, or enable the paused scheduler. A
failed parser check is reported as `YANDEX_CONTRACT_DRIFT` with its safe field
path so a compatible parser fix can be reviewed before any worker retry.

No live result is considered confirmed until the operator runs the protected
operation once and returns its safe JSON report.
