# Review Activator — v0.6 BACKEND FOUNDATION

Current addition: [Yandex Session Transport v1](docs/YANDEX_SESSION_TRANSPORT_V1.md).
Private encrypted storage + trusted operator CLI; existing provider/queue/preflight and
Telegram/Resend reused. No new public import/read endpoint, real session or Yandex request.
Review persistence OFF; Matching/rewards are not called; hourly job remains paused.
The implementation adds no Business OS connection or deployment.

Current server-only sync boundary:
[Remediation 02](docs/SYNC_BOUNDARY_REMEDIATION_02.md). This checkpoint predates
the DEV RPC security migration and scheduler pause.

Historical checkpoint. Current Yandex remediation and verified DEV schema are in
[YANDEX_REVIEW_PROVIDER.md](docs/YANDEX_REVIEW_PROVIDER.md) and
[REVIEW_EXTERNAL_REVIEWS_SCHEMA.md](docs/REVIEW_EXTERNAL_REVIEWS_SCHEMA.md).
The no-database statements below are superseded by the dedicated DEV connection
documented in SUPABASE_DEV.md; Business OS remains separate.

Status: DEV-safe foundation. No production database, email or Telegram mutation is enabled yet.

## Added server endpoints

- `GET /api/health`
- `POST /api/feedback`
- `POST /api/reward-request`
- `POST /api/review-candidate`

## Intended flow

### Positive

`client -> reward-request -> WAITING_PUBLICATION -> provider adapter -> review candidate -> matching -> VERIFIED -> promo pool -> email`

### Negative

`client -> feedback -> persistence -> Telegram + email -> later Business OS BLOCK 12`

## Environment contract

Future server-only variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `REVIEW_EMAIL_FROM`
- `REVIEW_EMAIL_API_KEY`
- `NEGATIVE_REVIEW_EMAIL_TO`

Never expose these variables to browser code.

## Review providers

Stable adapter boundary:

- `YandexBusinessProvider`
- `TwoGisBusinessProvider`

Exact automated review retrieval mechanism is intentionally not hardcoded yet. It must be selected after testing the real authorized Yandex Business / 2GIS business accounts.

## Matching thresholds (initial)

- `>= 90`: eligible for auto-match after production safeguards
- `60–89`: manual review
- `< 60`: low confidence / continue waiting

No promo is issued directly by the candidate endpoint.

## Safety

- Business OS remains untouched.
- No Supabase production/test project is connected.
- No Telegram message is sent.
- No email is sent.
- DEV endpoints validate input and return explicit integration state.
