# Yandex health pretransport gate — DEV

The health wrapper previously collapsed every exception into `HEALTH_FAILED`.
That made configuration failures indistinguishable from a Yandex response failure.

`scripts/yandex-session.mjs preflight` is now the server-only diagnostic boundary.
It performs one scoped private-session read and decrypt validation, but it never
creates a Yandex request, enqueue, worker run, persistence operation or alert.

It checks, in order:

- the fixed DEV service-role environment presence;
- the exact read approval `asbest-read-only-v1`;
- the fixed Asbest scope;
- mode `health`, page base `1`, and the exact reviews URL shape;
- keyring parsing and active-key availability;
- encrypted session read and `validateSession` through the existing decrypt primitive.

Only fixed safe codes are returned. Session material, envelope fields, key values,
raw exceptions and upstream response data are never returned. A successful
preflight reports `pretransport: PASS`; only then may the separately approved
`health` operation perform its single GET.

Run in the existing server-only PowerShell process with no secret arguments:

```powershell
@'
{"scope":{"companyId":"13f3cb80-487a-4a19-96a1-fb3103200230","locationId":"9a95f63b-18e6-447b-a449-8530b67ddbae","organizationId":"54309413522"},"pageBase":1}
'@ |
  node scripts/yandex-session.mjs preflight
```

The command prints only safe booleans, fixed status labels, the runtime class and
`yandex_requests: 0`. It must be stopped on `pretransport: FAIL`; no health retry
is implied by the diagnostic.

## Vercel Preview boundary

The deployed server-only boundary reuses the existing
`POST /api/internal/review-sync-worker`; no additional Vercel function is
created. It requires the existing `REVIEW_WORKER_SECRET` in the `Authorization`
header and accepts exactly one of these operation bodies:

```json
{"operation":"preflight"}
```

```json
{"operation":"health"}
```

`preflight` performs no Yandex request. It returns only safe status labels,
environment-presence booleans, runtime class, session state/revision and a
fixed allowlisted error code. `health` is allowed only after that gate passes;
it performs exactly the existing page-1 GET, transitions the session through
the existing CAS/status path, and keeps review persistence `OFF`. Neither
operation claims a sync queue row, enqueues work, sends alerts, or enables a
scheduler. Missing or incorrect authorization is rejected before either
operation runs.

The Preview command must be run with the already configured server secret in
the operator's process environment; never put it in a command argument, URL,
file, log or report. Stop after any non-PASS preflight and do not retry health.
