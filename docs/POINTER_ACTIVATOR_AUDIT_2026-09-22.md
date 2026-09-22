# Pointer Activator audit — 2026-09-22

Status: client-side flow and public contract audited in real Google Chrome. No review was published. No password/OTP/CAPTCHA data was entered or captured.

## UX confirmed
Pointer keeps the positive path deliberately short:
1. public Activator URL: `https://feedback.pntr.io/myasnoj-batya`;
2. select city;
3. select branch;
4. Continue;
5. “Вам понравилось?” -> Positive / Negative;
6. positive path -> gift/email form;
7. email + required personal-data consent; marketing subscription is separate/optional;
8. platform chooser -> Yandex Maps / 2GIS;
9. platform opens in a new tab;
10. Pointer itself immediately moves to its thank-you/social screen.

For the audited pass the selected branch was:
- Каменск-Уральский, Победы проспект, 75Б
- Pointer branch UUID: `ccd864fd-f313-4933-a46f-344a4546cd0a`

## Public network/config
Public endpoints observed:
- `GET /api/networks/myasnoj-batya`
- `GET /api/networks/myasnoj-batya/settings`
- `POST /api/events/myasnoj-batya`

The public network config returns cities, branches, branch UUIDs, coordinates and provider links.
The public settings for Meat Father contain bonus copy:
- “Напишите о нас отзыв в геосервисах и получите подарок.”
- “Когда отзыв будет опубликован, мы пришлем вам письмо с промокодом.”

## Pointer event model
The public frontend defines:
- Visit = 1
- Like = 2
- Dislike = 3
- Submit = 4
- SendBonusEmail = 5
- SkipBonusEmail = 6
- SendBonusContact = 8
- SkipBonusContact = 9
- SendLoyaltyBonusContact = 10
- SendContactAndEmail = 12
- SendContactAndLoyalty = 14

Provider IDs include:
- Yandex = 1
- 2GIS = 3

Provider-click event ID is `providerId + 1000`:
- Yandex -> 1001
- 2GIS -> 1003

## Real Yandex click observed
Immediately before opening Yandex, Pointer sent:
`POST /api/events/myasnoj-batya`

Observed POST field names:
- `eventTypeId`
- `fp`
- `companyUuid`
- `email`
- `isAgreementConfirmed`
- `isSubscriptionConfirmed`

Response: HTTP 204.

The Yandex click then opened:
`https://yandex.ru/maps/org/myasnoy_batya/141005913651/reviews/?...&utm_campaign=v1&utm_medium=qr_image&utm_source=qr...`

Important: the external Yandex URL contained no Pointer email, no `fp`, no event/session ID and no unique per-visitor token.

## What fp is
The public Pointer frontend uses FingerprintJS:
`FingerprintJS.load() -> get() -> visitorId`

That `visitorId` is stored in Pointer event payload as `fp` (truncated to max 255 chars).
No localStorage/sessionStorage identity key and no pntr.io cookie were observed in the isolated Chrome profile during this flow.

Therefore `fp` groups Pointer-side visitor/events. It is NOT directly transmitted to Yandex in the provider URL.

## Client-side architecture confirmed
Pointer creates an event client with a payload containing:
- `fp`
- `companyUuid` of selected branch
- optional source/channel ID
- event type
- optional email/contact/loyalty data

Positive click records Like.
Email/gift flow can record SendBonusEmail.
Provider click records 1001 for Yandex or 1003 for 2GIS and may carry the email/consent fields.

After the provider link is opened, the frontend switches to the Pointer thank-you state. No client-side callback from Yandex and no client-side polling for the published review were found in this flow.

## Server-side attribution: confirmed vs unknown
CONFIRMED from Pointer public materials:
- reviews left through Activator are marked with a lightning icon/filter in the Pointer feed;
- Pointer says its Activator analytics shows visits, rating, exact review and platform;
- gift/promo delivery is described as automatic after the external review is published.

CONFIRMED technical constraint:
- no unique Pointer visitor/event identifier is passed in the observed Yandex URL;
- the positive frontend does not receive a callback containing the published Yandex review ID.

Therefore exact review attribution happens server-side after Pointer ingests external reviews.

UNKNOWN / private backend:
- the exact matching algorithm between pending Activator event and newly ingested external review;
- whether Yandex/2GIS expose any provider-side attribution metadata Pointer uses;
- whether matching uses time windows, queue order, provider metadata or a combination;
- ambiguity handling when multiple Activator visitors publish to the same branch/provider close together.

Do not claim a specific algorithm until a controlled publish test or backend evidence proves it.

## SLUKH design to preserve
We should copy the low-friction product pattern, not Pointer source code:
QR -> branch (or auto-location) -> Positive/Negative -> email for reward -> Yandex/2GIS -> done.

Do NOT add:
- pre-writing/copying review text;
- “select your review from a list”;
- manual review URL submission;
unless later evidence proves it is required.

For SLUKH we already have the missing server capability Pointer depends on conceptually: external review ingestion per branch/provider. The next design task is to implement our own deterministic `ActivatorVisit -> ProviderClick -> ReviewMatch -> Reward` state machine, with ambiguity handled internally rather than adding user friction.

## Next audit required to prove matching
Best controlled test:
1. create one isolated Activator visit for a low-traffic branch;
2. record exact `fp + companyUuid + provider event timestamp`;
3. publish one harmless test review on the chosen platform;
4. observe when Pointer ingests/marks it in its dashboard and when reward email is emitted;
5. repeat with two near-simultaneous visits to learn ambiguity behavior.

This test must not be represented as completed until actually run.
