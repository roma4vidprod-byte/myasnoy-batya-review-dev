# VPS08 network boundary — source evidence, no live traffic

Audited source: `lib/server/yandex-session/transport.js`; provider parser/pagination: `lib/providers/yandex.js`; service: `lib/server/yandex-session/service.js`.

| Boundary | Current source behavior |
| --- | --- |
| Host/scheme | Exact `https://yandex.ru` |
| Path | Exact `/sprav/api/54309413522/reviews` |
| Query | Fixed ranking/source and validated integer page; exact request URL comparison |
| Method | GET only; POST/PUT/PATCH/DELETE/HEAD refused before fetch |
| Redirect | `manual`; all 3xx fail with `YANDEX_LOGIN_REDIRECT`, no follow |
| Timeout | 10 seconds per transport fetch, including body consumption signal |
| Size | Stream counted; maximum 2,000,000 response bytes |
| Credentials | Validated cookie header assembled in memory; no token in URL |
| Response | 401/403, HTML login, challenge, malformed/non-JSON media fail closed |
| Retry | None in the audited diagnostic path |
| Full diagnostic | Five-page cap and 30-second overall budget; do not expand merely because VPS08 suggests ten |

The transport has no reply/write, persistence, notification, promo or AI dependency. The broader service **does** have persistence modes and a default notification adapter: it must not be treated as universally read-only. Legacy `dry_run` also has state/sync timestamp effects. Use only explicitly composed operations; the default queue worker is not authorized here.

The parser validates the business-list contract, types and pagination. Request/DB scope selects the organization; the audited JSON parser does not independently prove organization ownership from an additional response marker. Future evidence must distinguish request-scope proof from provider-payload assertions.

Stage A and Stage B were not started. Actual provider destinations/methods/status classes are empty, Yandex requests **0**, mutation methods **0**. Synthetic fetch callbacks in offline tests are not network requests. SSH inspection and loopback readiness probes are infrastructure checks, not provider traffic.

## VPS08A update — 2026-09-19

The optional unforgeable-in-process VPS context is passed explicitly to the existing transport. Without it the original Cloud guard still applies. VPS requests additionally reject page 0 and page >10; the existing full diagnostic still stops at five. Exact HTTPS hostname/path/method, response-size, timeout and no-redirect behavior remain shared, not duplicated.

Private Native Messaging adaptation uses the existing pinned SSH host and a process stdin pipe. It has no public HTTP endpoint, Vercel fallback or secret-bearing arguments. An explicit `vps-lab` target is required; the old Cloud default is unchanged. No operational Windows dependency is introduced into server read operations: Windows is only the administrator's browser/import endpoint. This is source/test evidence; the private CLI has not been installed or used with real material.
