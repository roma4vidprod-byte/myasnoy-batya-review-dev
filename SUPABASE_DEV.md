# Review Activator — dedicated Supabase DEV

Current addition: [Yandex Session Transport v1](docs/YANDEX_SESSION_TRANSPORT_V1.md)
documents applied migration `20260912103803` and actual privilege verification (PASS).
One encrypted session table, forced RLS, server-only INVOKER RPC; no client grants.
Public reward sessions are not reused for credentials. No session imported; scheduler
paused, review persistence OFF. Asbest internal mapping still requires verification.

Current: [Remediation 02](docs/SYNC_BOUNDARY_REMEDIATION_02.md) applied the DEV-only
RPC security migration 20260912095126 and paused (did not delete) the existing
hourly job. Review data/indexes were not changed; no real Yandex transport is enabled.

2026-09-12 read-only verification: see
[REVIEW_EXTERNAL_REVIEWS_SCHEMA.md](docs/REVIEW_EXTERNAL_REVIEWS_SCHEMA.md) for the
subsequent external reviews/reply columns, migrations, RPCs and existing pg_cron.
The foundation table list/status below is historical, not the full current schema.
No schema/data mutations were applied in Yandex Foundation Remediation 01.

Project: `myasnoy-batya-review-dev`
Project ref: `ykiubttldgyjpajmsuas`
Region: `eu-central-1`

This database is separate from Business OS `myasnoy-batya-test` and must remain isolated.

## Foundation tables

- `review_companies`
- `review_locations`
- `review_qr_sources`
- `review_sessions`
- `review_feedback`
- `review_promo_codes`
- `review_matches`
- `review_notification_deliveries`

RLS is enabled on all tables. There are no direct public table policies. Public client writes go only through narrowly scoped RPC functions using a QR source token.

## Public RPC surface

- `review_public_resolve_source(token)`
- `review_public_submit_feedback(token, category, message, contact)`
- `review_public_create_session(token, email, platform)`

Historical public customer APIs use a publishable key. The newer server scheduler/session
boundary requires a server-only service credential; no browser/client service key.

## Seed fixture

DEV source token: `mb-dev-main`

## Current status

- schema applied
- RLS enabled
- dedicated DEV company/location/source seeded
- reward request API persists to Supabase
- negative feedback API persists to Supabase
- Telegram/email delivery not enabled yet
- Yandex/2GIS review providers not enabled yet
- Business OS untouched
