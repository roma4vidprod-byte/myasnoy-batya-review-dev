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

For page-specific follow-up, the same boundary accepts only pages `2`, `3`,
or `4` with:

```json
{"operation":"contract_diagnostic_page","page":2}
```

The operator runs these sequentially and stops at the first failed page. Page 1
is never repeated by this follow-up operation.

No live result is considered confirmed until the operator runs the protected
operation once and returns its safe JSON report.
