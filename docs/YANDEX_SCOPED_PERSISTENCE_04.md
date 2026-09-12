# Yandex Scoped Persistence + Atomic Writer 04

## STATUS

**PASS — DEV schema and server boundary hardened; real review persistence remains OFF.**

Scope was limited to `myasnoy-batya-review-dev` and Supabase DEV project
`ykiubttldgyjpajmsuas`. Business OS and production were not queried or changed.
The paused DEV scheduler was not enabled, no Yandex request was made by this
change, and the 67 live dry-run reviews were not inserted.

Migration file:
`supabase/migrations/20260913090000_yandex_scoped_persistence_atomic_writer_04.sql`.
The DEV migration service assigned applied version `20260912192639` with name
`yandex_scoped_persistence_atomic_writer_04`; the earlier migration history was
not rewritten.

## Root cause and preflight

Before 04, identity had both:

* `UNIQUE(company_id, provider, external_review_id)`; and
* a stricter global `UNIQUE(provider, external_review_id)` index.

The global index could make a same provider/external ID in another company or
location collide with the first row. An unsafe global `ON CONFLICT DO UPDATE`
could therefore target another scope. `location_id` was nullable and its FK did
not prove that the location belonged to the review company. Direct table grants
also left `anon` and `authenticated` with table INSERT privilege even though RLS
had no permissive policy.

DEV preflight before applying the migration was clean:

| Check | Result |
| --- | ---: |
| existing reviews | 0 |
| null review scopes | 0 |
| orphan locations | 0 |
| location/company mismatches | 0 |
| duplicate scoped identities | 0 |
| duplicate provider/external-ID groups | 0 |

No customer review payload, author, credential, cookie or session value was
selected during this audit.

## New identity and schema boundary

Canonical identity is now:

`(company_id, location_id, provider, external_review_id)`.

The migration:

1. makes `review_external_reviews.location_id` NOT NULL;
2. adds a deferrable composite FK `(location_id, company_id)` to
   `review_locations(id, company_id)` with `ON DELETE NO ACTION`;
3. adds `UNIQUE(company_id, location_id, provider, external_review_id)`;
4. removes the company-only unique constraint and the global provider/ID index;
5. revokes direct INSERT/UPDATE/DELETE/TRUNCATE/etc. on the review table from
   `PUBLIC`, `anon` and `authenticated`.

The resulting DEV catalog has the scoped unique constraint, composite FK and no
global provider/ID index. The review table remains RLS-enabled with no public
mutation policy.

## Atomic writer contract

`public.review_persist_external_reviews(uuid, uuid, text, text, jsonb)` is the
single database writer. It is `SECURITY INVOKER`, uses a fixed
`pg_catalog,public` search path, and is executable only by `service_role`.
Its required scope is explicit: company UUID, location UUID, provider and
external organization/location ID. It verifies the internal location belongs to
the company before touching rows.

The operation is one database transaction. It validates the complete batch,
rejects duplicate IDs and contract drift, locks existing scoped rows, and fails
the whole transaction on any invalid row or scope collision. The server wrapper
`lib/server/review-persistence-writer.js` is server-only and calls only the
allowlisted RPC `review_persist_external_reviews`. An explicit `persist` mode
and fixed-scope operator runner were added after 04; health and dry-run commands
do not invoke them automatically.

Provider-owned fields that may be inserted/updated:

`author_name`, `rating`, `review_text`, `published_at`, `observed_at`,
`raw_payload`, `owner_reply_text`, `owner_replied_at`.

Identity fields (`company_id`, `location_id`, `provider`, external review ID and
external location ID) are immutable within the operation. Local workflow fields
are preserved: `reply_state` and `owner_reply_external_id` are never overwritten.
Owner reply text/date and allowlisted provider moderation data in `raw_payload`
are retained without creating a second reply entity.

The raw payload allowlist is intentionally narrow and includes the confirmed
Yandex fields (`id`, `cmnt_entity_id`, author/text/rating/time, owner comment,
counts, language and boolean `public_rating`) plus normalization metadata.

The writer returns `{inserted, updated, unchanged, seen, persistence_enabled}`.
`persistence_enabled=true` means only that this explicit RPC is capable of a
successful write. The live Yandex fetch/dry-run service does not call it, so
runtime persistence remains OFF.

## Caller and privilege matrix

| Actor | Review table mutation | Atomic writer RPC | Notes |
| --- | --- | --- | --- |
| `anon` | denied | denied | no browser mutation path |
| `authenticated` | denied | denied | admin UI does not gain writer access |
| `service_role` server | granted by explicit server boundary | allowed | trusted scope required |
| `postgres` owner | administrative | owner-level | scheduler remains paused |

No service-role key is included in browser code or repository files. The server
wrapper rejects browser execution and the existing server RPC allowlist remains
in force.

## Regression and concurrency evidence

Local PGlite tests cover:

* 67 inserts, replay as 0 inserts/67 unchanged, and one changed provider field
  as exactly one update;
* 54 owner replies retained with local reply state/identity preserved;
* same provider/ID in another company/location accepted as a separate scoped row;
* different providers isolated;
* duplicate input, malformed payload/rating, invalid scope and external-location
  reassignment fail closed with whole-batch rollback;
* concurrent same-scope batches remain unique and deterministic;
* `anon`/`authenticated` direct RPC and table mutation denied;
* Matching/reply schema dependencies remain present and were not redesigned.

The existing `review_match_candidates()` function is unchanged. Its previously
audited NULL-location wildcard and missing explicit company predicate remain a
separate Matching hardening item; this migration does not silently broaden or
rewrite that engine.

## Verification and stop boundary

After applying the migration, read-only DEV catalog checks confirmed:

* review count 0 and all preflight integrity counts 0;
* scoped unique index present and global provider/ID index absent;
* composite location/company FK present;
* writer `prosecdef=false`, `anon_exec=false`, `authenticated_exec=false`,
  `service_role_exec=true`;
* direct review-table INSERT denied to `anon` and `authenticated`;
* `review-provider-due-check-hourly` still exists with schedule `0 * * * *` but
  `active=false`; its old no-argument command is obsolete and must not be
  re-enabled.

Checks completed for this checkpoint:

* focused writer/schema tests: **8/8 PASS**;
* full suite before DEV apply: **295/295 PASS**;
* repository checks before DEV apply: **79 PASS**;
* `git diff --check`: PASS before DEV apply.

The final post-documentation test/check/diff results are recorded in the final
handoff commit. No production deploy, push, real review persistence or scheduler
activation is part of this checkpoint.

## Next approval boundary

Before the first real persisted Yandex sync, separately approve and verify the
server runtime integration that calls this writer with the trusted Asbest
company/location scope. Then run a small DEV persistence rehearsal and re-check
the Matching/reply consumers. Do not call the writer from the browser, restore
the paused obsolete cron command, or infer authorization from the earlier
read-only dry-run.
