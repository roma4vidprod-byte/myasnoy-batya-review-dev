# VPS12 provider postflight note

Date: 2026-09-20

This note records a provider-health condition observed while closing VPS12. It is
separate from the HTTPS gateway and predates the Caddy/public-port change.

## Timeline

- 12:00:07 MSK Yandex sync: PASS, 72 unique, 4 pages, 0 writes to Yandex.
- 13:00:06 MSK Yandex sync: FAIL with `SYNC_CHILD_FAILED`.
- Provider monitor began reporting `PROVIDER_LAST_SYNC_FAILED` after that run.
- Caddy/VPS12 installation started later, around 13:45 MSK.

Therefore the 13:00 provider failure was not caused by the HTTPS gateway.

## Diagnostic result

The encrypted session remained READY with no stored error. A read-only health probe
returned HTTP 200 and 20 reviews. That legacy health operation performs a metadata
health CAS and advanced the session revision from 4 to 5.

Because VPS10 manual persistence is intentionally pinned to the accepted revision 4,
the diagnostic-only revision transition was reverted under exact compare conditions:
READY, revision 5, null error, unchanged credential version and unchanged envelope.
No credential material was printed or replaced.
The restored state was:
- READY
- revision 4
- previous accepted `last_session_check_at`
- same credential version
- encrypted envelope untouched

A direct `manual-replay` diagnostic was then executed once. It failed closed:

- provider HTTP responses: 200 / 200 / 200 / 200
- pages: 4
- reported total on all pages: 72
- raw/unique items received: 73
- page lengths: 20 + 20 + 20 + 13
- duplicates: 0
- classification: `INCONSISTENT_INCOMPLETE`
- error: `YANDEX_PAGINATION_CHANGED`
- persistence: `NOT_RUN`
- session mutations: `OFF`
- Yandex writes: 0

The most likely immediate condition is provider-side pagination/count inconsistency:
the item stream contains one more unique item than the reported total. The existing
fail-closed contract correctly refused DB persistence.

The hourly Yandex timer was re-enabled after diagnosis. No immediate retry loop was
introduced. Monitor remains expected to fail until a later scheduled read is
internally consistent and completes successfully.
