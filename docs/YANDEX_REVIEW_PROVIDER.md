# Yandex Foundation Remediation 01

Historical checkpoint. Current RPC security, centralized page-base adapter and paused
scheduler are documented in [Remediation 02](SYNC_BOUNDARY_REMEDIATION_02.md).
The public enqueue risk described below has since been closed. Persistence/index
risks and live type confirmation remain pending.

Status: fixture-tested read foundation; **no Yandex session/auth transport implemented**.
Date: 2026-09-12. Baseline: `e255faf6a0b3f69c45c75e18a468d03c81c3d110`.
Pointer audit was read before implementation. Pointer is not a runtime dependency;
none of its code, credentials or endpoints is used.

## Source contract and fixture provenance

The owner confirmed:

```http
GET https://yandex.ru/sprav/api/54309413522/reviews?ranking=by_time&source=pagination&page=N
```

Envelope: `list.items`, `list.pager.limit/offset/total`. Fields: `id`,
`cmnt_entity_id`, `author.user` (string name), `full_text`, `rating`, `time_created`,
`owner_comment.text/time_created/moderation_status`, `comments_count`, `lang`,
`public_rating`. `approved` is the supplied moderation example.

No captured anonymized real item was available. The owner authorized fixtures
reconstructed from this contract. `test/fixtures/yandex/` contains synthetic data,
NOT recorded real responses. **TYPE CONFIRMATION PENDING** for source time types/units
and public_rating type/meaning. Actual page base also needs session-stage confirmation.

## Defect and compatibility

Old code searched guessed `items`/`reviews` envelopes and `continue_token` variants.
A valid `list.items` item silently yielded []. Text/author/time/owner reply were lost.
The existing `lib/providers/yandex.js` now validates the explicit Business contract.
Missing/renamed fields and incomplete pages throw `YANDEX_CONTRACT_DRIFT`.
Only valid empty items plus total=0 produce a successful empty result.

Exported provider function names and existing camelCase DTO fields are retained.
There are no in-repository callers of the guessed legacy envelope/cursor/baseUrl
variants: those variants are removed. No arbitrary API origins are accepted.
Only an explicitly injected transport may read data; there is no default Fetch,
browser automation, login, credential persistence or reply publishing.

## Canonical ID decision

Prefer nonempty `id`; fallback to nonempty `cmnt_entity_id` only when id is
absent/null/blank. Invalid IDs or both missing -> explicit failure. BOTH IDs and
`external_id_source` remain in allowlisted metadata. Tests cover equality, differing
values, fallback and malformed IDs; legacy externalReviewId alias is ignored.

Comparative real stability is **NOT VERIFIED**. This is a deterministic choice
preserving prior id preference, not a claim that id is more stable. Author identity
is never used as review ID. A later id/cmnt alias change requires reconciliation.

## Exact normalized provider model

```text
{
  provider: "yandex",
  externalReviewId: string,
  externalLocationId: string | null,
  authorName: string | null,
  rating: integer (1..5),
  reviewText: string | null,
  publishedAt: UTC ISO string | null,
  ownerReply: null | {
    text: string | null,
    publishedAt: UTC ISO string | null,
    moderationStatus: string | integer | null
  },
  rawPayload: {
    contract_version: "business-list-v1",
    type_confirmation: "PENDING",
    id: string | null,
    cmnt_entity_id: string | null,
    external_id_source: "id" | "cmnt_entity_id",
    author_name: string | null,
    full_text: string | null,
    rating: integer,
    time_created: validated source string | number | null,
    owner_comment: null | {
      text: string | null,
      time_created: validated source string | number | null,
      moderation_status: string | integer | null
    },
    comments_count: nonnegative integer | null,
    lang: string | null,
    public_rating: string | finite number | boolean | null
  }
}
```

`rawPayload` is a historical field name, now a fresh allowlist, not raw item/envelope.
Unknown keys/nested session objects are dropped. No CSRF/cookies/Authorization/session
fields belong in fixtures, normalized data, storage projection or logs. Failures
contain fixed codes/field names, never original input or transport exceptions.

Time conversion is explicit and tested, but not proof of actual Yandex types:

- Explicit-offset/Z ISO datetime -> UTC ISO; no local timezone/date guessing.
- Nonnegative safe integer/numeric string below 100,000,000,000 -> Unix seconds;
  at/above threshold -> Unix milliseconds (modern timestamp convention).
- Null -> null; verified SQL time columns are nullable.
- Boolean/object/array, invalid calendar/local date and nonintegral date -> drift.
- Original validated source primitive/value stays in metadata. Confirm conventions
  against a real authorized response before Session Transport v1.
- public_rating remains opaque, never used to replace rating.

## Verified `review_external_reviews` projection

Dedicated DEV columns/migrations/RPCs/indexes were inspected read-only;
see [schema evidence](REVIEW_EXTERNAL_REVIEWS_SCHEMA.md). No migration/table was
created/applied/altered. Existing JSONB holds moderation without new columns.

```js
const dto = normalizeYandexReview(item, externalOrganizationId);
const row = toReviewExternalReview(dto, { companyId, locationId, observedAt });
```

Exact row projection:

```text
{
  company_id: uuid,
  location_id: uuid,
  provider: "yandex",
  external_review_id: string,
  external_location_id: string,
  author_name: string | null,
  rating: number,
  review_text: string | null,
  published_at: UTC ISO string | null,
  observed_at: UTC ISO string,
  owner_reply_text: string | null,
  owner_replied_at: UTC ISO string | null,
  raw_payload: allowlisted metadata above
}
```

This helper is pure, NOT an insert/upsert/RPC/matching/promo action. Company/location
UUIDs and observation time are required trusted caller context. A numeric Yandex
org is NOT location_id. Caller must authorize/resolve the mapping. Non-null location
is required even though SQL permits null, because the current matcher treats null
as a wildcard. The projection omits `reply_state` and `owner_reply_external_id`,
avoiding overwrite of draft/queued/sent state or invention of an unknown reply ID.

## Pagination/error contract

`fetchYandexReviews({permanentId, transport, pageBase=1, maxPages=20})` sends
`{method:"GET", url, permanentId, page}` to the injected transport and expects parsed
JSON. Every URL contains ranking=by_time, source=pagination and page=N.

- pageBase accepts 1 (default) or explicit 0. Actual live base NOT VERIFIED.
- First response must have offset=0. Limit is positive; offset/total nonnegative.
- Page item count must equal min(limit,total-offset); otherwise drift.
- Each request increments page; next offset must match previous offset+limit.
- Stop at offset+limit >= total, not at unique-review count.
- Limit/total must stay stable for the pass. Changing/repeated/wrong offsets ->
  `YANDEX_PAGINATION_CHANGED`; a subsequent retry can take a fresh snapshot.
- maxPages must be integer 1..100; exhaustion -> `YANDEX_PAGINATION_LIMIT_EXCEEDED`.
- No partial success: drift on page 2 rejects the entire operation.
- Dedupe key: (provider, externalLocationId, externalReviewId); first occurrence wins.
  Different locations never silently merge. The DB global unique index is stricter;
  see pre-session blockers in schema evidence before any persistence.
- Missing transport -> `YANDEX_AUTHORIZED_TRANSPORT_NOT_CONFIGURED`.
- Transport exception -> `YANDEX_TRANSPORT_FAILED`, without original error/cause.

## HTTP sync security and scheduler

`GET /api/cron/review-sync` now fails closed:

- Missing/empty/whitespace/padded CRON_SECRET -> 401, zero RPCs.
- Missing/wrong/malformed Authorization -> 401; no query/cookie alternatives.
- Correct exact Bearer value -> timing-safe comparison, then existing RPC flow.
- Non-GET -> 405 with Allow: GET; zero RPCs.
- Secret read per request; no cached successful authorization.
- RPC exceptions -> fixed 503 REVIEW_SYNC_FAILED; raw errors are not logged.

Vercel Hobby is NOT the hourly scheduler; vercel.json is unchanged with no crons.
An EXISTING active Supabase job `review-provider-due-check-hourly` was found. It
calls `review_enqueue_due_syncs()` hourly, queues READY connections or records
SKIPPED_NOT_CONFIGURED, and does not need/call a Yandex transport. It was neither
created nor changed. Response schedule=hourly is retained for compatibility, not
as a claim that the HTTP handler itself provisions a scheduler.

**Remaining DB security risk:** `review_public_request_due_syncs(text)` still
grants EXECUTE to anon/authenticated and uses a public QR-source token. This is an
existing route around HTTP CRON_SECRET. Passing HTTP tests does NOT close all sync
mutation surfaces. No live privilege changes were made. Before a live worker/session
is enabled, migrate this legacy RPC to a privileged boundary and update its caller
together; revoking alone breaks the existing publishable-key HTTP caller.

## Verification and stop condition

Node 22+ (development run Node 24.19.0), no third-party test dependencies:

```sh
npm test
npm run check
git diff --check
```

Tests disable external Fetch and inject mock provider/RPC calls. HTTP tests bind
127.0.0.1 only for their duration. Checks compile source/inline scripts without
executing them. No Yandex/live sync RPC/DB mutation/email/Telegram calls occur.
Schema evidence was obtained separately with metadata SELECTs, not runtime tests.

Local verification result (2026-09-12): 30/30 tests PASS; 30 source/fixture/inline
checks PASS. Coverage: provider 100% lines / 95.21% branches; HTTP cron 100% lines /
branches/functions. There is no separate frontend build script in this static +
server-functions project. No push, Vercel deployment or live endpoint run was performed.

Before **Yandex Session Transport v1**: confirm time/public_rating types and page
base; approve own-account authorized read transport; close the public enqueue RPC;
resolve global-ID/isolation concerns; wire scoped persistence/worker consumption to
existing engines. No cookie storage, automatic login, persistent CSRF, outbound reply
transport, production operation or Pointer dependency is implemented in this stage.
