# Review Activator — dedicated Supabase DEV

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

The Vercel DEV API uses the Supabase publishable key, never a service-role key.

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
