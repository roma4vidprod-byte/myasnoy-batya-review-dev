# Verified DEV schema evidence — 2026-09-12

Historical Remediation 01 snapshot. Review table/index definitions remain unchanged,
but RPC privileges/signatures and scheduler state have changed in
[Remediation 02](SYNC_BOUNDARY_REMEDIATION_02.md). Refer there for current status.

Target identity verified: `myasnoy-batya-review-dev`, ref `ykiubttldgyjpajmsuas`,
Postgres 17. Business OS projects were not queried. Source of truth:
information_schema.columns, pg_constraint, pg_indexes, pg_proc, pg_policies,
pg_trigger, targeted cron.job and Supabase migration-history SELECTs.
No customer rows, credentials or provider configuration values were selected.
No RPC/job was executed. No schema/data writes or migrations were applied.

No local SQL/migration files exist, including in tracked Git history. Definitions
were inspected in this dedicated project's applied migrations and current catalog.
This document is evidence, NOT a runnable migration or replacement schema.

## Current `public.review_external_reviews`

| Column | SQL type | Nullable | Default |
|---|---|---|---|
| id | uuid | no | gen_random_uuid() |
| company_id | uuid | no | none |
| location_id | uuid | yes | none |
| provider | text | no | none |
| external_review_id | text | no | none |
| external_location_id | text | yes | none |
| author_name | text | yes | none |
| rating | numeric | yes | none |
| review_text | text | yes | none |
| published_at | timestamptz | yes | none |
| observed_at | timestamptz | no | now() |
| raw_payload | jsonb | no | '{}'::jsonb |
| owner_reply_text | text | yes | none |
| owner_reply_external_id | text | yes | none |
| owner_replied_at | timestamptz | yes | none |
| reply_state | text | no | 'NONE' |

Checks: provider in yandex/2gis; reply_state in NONE/DRAFT/QUEUED/SENT/FAILED/SYNCED_EXTERNAL.
FK company_id -> review_companies.id ON DELETE CASCADE; location_id -> review_locations.id
ON DELETE SET NULL. No rating-range CHECK exists; provider validation adds 1..5.
RLS enabled; no explicit policies; no non-internal triggers on this table.

## Constraints/indexes

| Name | Definition |
|---|---|
| review_external_reviews_pkey | UNIQUE id / PRIMARY KEY |
| review_external_reviews_company_id_provider_external_review_key | UNIQUE (company_id, provider, external_review_id) |
| review_external_reviews_provider_external_id_uq | UNIQUE (provider, external_review_id) |
| review_external_reviews_match_idx | (provider, location_id, published_at DESC) |

The global unique index is stricter than the company constraint and provider's
location-scoped in-memory dedupe. It was NOT changed. A future writer must not use
a global conflict update to reassign another company's/location's review. Confirm
ID uniqueness or explicitly fail on cross-scope collisions before persistence.

## Applied migrations inspected

All 15 migration names/versions were inventoried. Every statement referencing
review_external_reviews or the public enqueue RPC was inspected:

| Version | Name | Relevant effects |
|---|---|---|
| 20260911142919 | review_activator_v04_provider_sync_foundation | Base table, connections, runs, RLS, enqueue/status functions, pg_cron job |
| 20260911143114 | review_activator_v05_hourly_sync_schedule | interval=60, public enqueue RPC and anon/authenticated EXECUTE |
| 20260911163356 | review_activator_v05_matching_foundation | Global unique index, match index, matching function |
| 20260911170233 | review_activator_v06_review_replies_foundation | Owner reply columns/state CHECK, reply_actions, active-action unique index |
| 20260911173455 | review_activator_v09_admin_reviews_rpc | Admin list projection |
| 20260911173512 | review_activator_v10_admin_reply_drafts | Admin draft upsert and reply_state=DRAFT |
| 20260911173843 | review_admin_review_for_ai | Admin-gated AI input projection |

No applied migration was rewritten/copied into a new migration directory.

## Current RPCs inspected

| Function | Data use | Observations |
|---|---|---|
| review_match_candidates() | Reviews/sessions -> matches/session verification | SECURITY DEFINER; null location is a wildcard; no explicit company_id filter in candidate query |
| review_admin_reviews(...) | Reviews/location/owner reply/state | SECURITY DEFINER, STABLE, admin gate, list filters |
| review_admin_save_reply_draft(...) | Review -> existing reply_actions, reply_state=DRAFT | SECURITY DEFINER, admin gate |
| review_admin_review_for_ai(uuid) | Review/location projection | SECURITY DEFINER, STABLE, admin gate |
| review_public_sync_status(text) | Connection health via active QR source | SECURITY DEFINER, STABLE; no provider transport |
| review_public_request_due_syncs(text) | QR source -> company -> due connections -> runs | SECURITY DEFINER; anon/authenticated EXECUTE confirmed TRUE |
| review_enqueue_due_syncs() | Due connections with FOR UPDATE SKIP LOCKED -> runs | SECURITY DEFINER; anon/authenticated EXECUTE confirmed FALSE; service-role/postgres grant in migration |

Existing active pg_cron job: `review-provider-due-check-hourly`; hourly schedule;
command `select public.review_enqueue_due_syncs();`. Enqueue functions only create
QUEUED or SKIPPED_NOT_CONFIGURED runs and advance next_sync_at. No Yandex Fetch.
The public variant's historical metadata says source=vercel-hourly-cron; that
string does NOT establish a Vercel scheduler. No new scheduler was connected.

## Remaining boundaries/risks

1. This remediation changes local provider/HTTP code, not live database privileges.
2. The existing public enqueue RPC bypasses HTTP CRON_SECRET protection. A coordinated
   privilege/caller migration is required before enabling live sync. Do not revoke
   it alone: the existing HTTP caller currently uses a publishable-key RPC client.
3. Global ID uniqueness and null-location matching need a scoped persistence decision;
   this change implements no database upsert or parallel Matching/Promo engine.
4. Moderation fits existing raw_payload JSONB; owner_replied_at receives its source
   time normalized to UTC. This normalizer never overwrites reply_state.
5. Internal company/location UUIDs are required caller context, not guessed from org ID.
6. Inspected SQL is evidence only: matching, enqueue and reply RPCs were NOT called.
