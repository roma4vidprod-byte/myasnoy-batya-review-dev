# Yandex Admin Reviews UI 06 — Asbest DEV

Status: DEV-only read path. No reply, matching, promo, scheduler, or Yandex write operations are enabled by this change.

## Existing path audit

The existing admin page is `admin.html`. It authenticates with Supabase Auth,
then requires an active `review_admins` row through `review_admin_profile()`;
an Auth session alone is not sufficient. Before this change the page called
`review_admin_reviews(...)`, an admin-gated but unscoped projection without
company/location filters and without pagination.

The page now calls `review_admin_reviews_scoped(...)` and sends the fixed DEV
scope:

- company: `13f3cb80-487a-4a19-96a1-fb3103200230`;
- location: `9a95f63b-18e6-447b-a449-8530b67ddbae`;
- provider: `yandex`;
- external location: `54309413522`.

The old unscoped RPC is revoked for browser roles. No second review UI or sync
engine was added.

## Read contract

The new RPC returns only the admin display projection: author, rating, review
text, publication time, owner reply text/time, reply state, observed time,
provider/location identity, and filtered totals. It never returns `raw_payload`,
session material, cookies, CSRF values, encrypted session envelopes, or service
credentials.

The RPC is `SECURITY DEFINER`, explicitly checks `review_is_admin()`, validates
the company/location relationship and Asbest external location, and supports
bounded `limit/offset` pagination. Results are newest first. The UI displays
20 rows per page, 67 total rows for the unfiltered Asbest DEV scope, and the
unanswered count from the same filtered query. Owner replies are read-only;
unanswered rows show a disabled response area.

## Security and runtime state

- `anon`: no execute on the scoped RPC and no review data.
- authenticated non-admin: rejected by `review_is_admin()`.
- authenticated active admin: scoped read projection only.
- service role: not used by the browser UI.
- scheduler: remains PAUSED.
- persistence, matching and promo mutations: unchanged and not invoked.
- Yandex writes: zero.

Migration: `20260913110000_yandex_admin_reviews_scoped_read_06.sql`.

Browser smoke requires an existing valid admin session. If the magic-link flow
is unavailable, unauthenticated behavior can still be checked locally, but an
authenticated row-by-row smoke must be reported as NOT VERIFIED rather than
using a password or creating a new session in the test harness.
