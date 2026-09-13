# Yandex canonical server keyring — DEV 07A.3F

The live operator import for Review Activator DEV now uses the Vercel Preview
keyring as the only encryption boundary. The old local CLI encryption path is
retained for legacy/synthetic tests, but `scripts/start-yandex-local-import.ps1`
does not read or require the local AES environment.

## Flow

1. The PowerShell listener authenticates to the existing Preview worker with
   the process-only `REVIEW_WORKER_SECRET`.
2. `{"operation":"import_prepare"}` returns a short-lived server-issued
   nonce, capability and current session revision. The fixed Asbest scope is
   embedded server-side; the browser cannot choose a scope.
3. The existing local named pipe and unpacked extension exchange the nonce.
   The extension reads only the already approved Yandex cookie set in memory.
4. The listener sends `{"operation":"import",...}` over HTTPS to the same
   protected worker route. It never sends a service-role key or AES key.
5. Vercel verifies the capability signature, TTL, nonce and fixed scope, then
   calls the existing `validateSession()`, `AES-256-GCM` and CAS replace path
   with its Preview keyring.

The capability is single-use at the session boundary: its expected revision is
consumed by the existing atomic CAS replace. A concurrent or replayed request
therefore fails with the old revision and cannot replace the session twice.
The local native challenge is also single-use and expires with the server
capability. Invalid cookies fail before the CAS call.

## Security boundary

- Only `POST /api/internal/review-sync-worker` is used.
- `REVIEW_WORKER_SECRET` is accepted only in the server-only Authorization
  header; it is never in the request body, URL, extension or browser bundle.
- The request body is bounded and never logged or returned.
- Scope is fixed to company/location `13f3cb80-487a-4a19-96a1-fb3103200230` /
  `9a95f63b-18e6-447b-a449-8530b67ddbae` and organization `54309413522`.
- The route has no CORS wildcard and the extension has no external network
  permission. The browser/native channel remains same-user local IPC.
- No Yandex request, review persistence, scheduler, reply or CSRF write is
  performed by import.

The operator receives only `session imported`, `NOT_CONFIGURED` and the new
revision. Cookie values, plaintext session material, encrypted envelope and
keys are not returned or written to disk.

## Current handoff

After deployment, run the existing importer in the configured PowerShell 7,
click **Connect Yandex Business** once, and stop after the safe import status.
Then run the separate Vercel `preflight` operation. Do not run health, enqueue
or the worker cycle as part of this checkpoint.

```text
CANONICAL KEYRING = VERCEL PREVIEW
LOCAL POWERSHELL KEYRING REQUIRED = NO
```
