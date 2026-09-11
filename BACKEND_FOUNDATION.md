# Review Activator — v0.6 BACKEND FOUNDATION

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
