# Yandex Review Provider — research checkpoint

Status: AUTHORIZED ACCESS CONFIRMED / PROGRAMMATIC TRANSPORT NOT CONFIRMED

## Confirmed

- Yandex Business exposes reviews in the business cabinet.
- Both Owner and Representative roles can work with organization reviews.
- Network companies can see reviews from multiple branches in one place.
- Yandex notes that reviews may appear in Maps and Business cabinet at different times.
- The documented public Business/Direct APIs do not expose an organization-review feed suitable for this project.

## Architecture decision

Review Activator must not depend on an undocumented endpoint shape.

The system keeps a provider boundary:

`hourly scheduler -> YandexProvider -> normalized external review -> external_reviews -> matching engine -> verified session -> promo pool`

`api/providers/yandex.js` defines the normalization contract. The transport intentionally fails closed until an authorized and supportable transport is confirmed.

## Hourly refresh

Vercel cron calls `/api/cron/review-sync` every hour. Provider connection rows use `sync_interval_minutes=60`.

Until the Yandex transport is configured, Yandex runs are recorded as `SKIPPED_NOT_CONFIGURED`; this is expected and must not issue promo codes.

## Next technical experiment

Using a dedicated Yandex account with the Representative role on the Myasnoy Batya network:

1. Open Yandex Business -> About company -> Reviews.
2. In browser DevTools -> Network, reload the review page.
3. Identify only requests made by the authorized Yandex Business web application that return the review list.
4. Record request method, host, path shape, pagination model and response fields. Do not copy session cookies or account secrets into source control.
5. Determine whether the transport is stable/documented/allowed for service use.
6. If not supportable, plug a compliant external review provider into the same adapter boundary instead of changing the rest of Review Activator.

## Normalized fields

- provider
- externalReviewId
- externalLocationId
- authorName
- rating
- reviewText
- publishedAt
- rawPayload

## Safety

No browser session cookies, Yandex passwords, OAuth tokens or representative-account credentials are stored in GitHub. Any future secret must live in Vercel/Supabase secrets only.
