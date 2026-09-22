# Pointer Activator audit — checkpoint 2026-09-22

Source: https://feedback.pntr.io/myasnoj-batya
Method: real Google Chrome UI + isolated Chrome DevTools observer. No review publication or credential entry.

## Confirmed UX
- Brand screen: «Мясной Батя».
- Step 1: city selector.
- Cities confirmed: Асбест; Каменск-Уральский.
- Step 2: branch selector.
- Kamensk branches confirmed:
  - 4-й Пятилетки, 25А
  - Каменская, 91б
  - Победы, 75Б
  - Ленинградская, 41А
- Step 3: «Продолжить».
- Step 4: «Вам понравилось?».
- Two large actions: «Позитивный отзыв» / «Негативный отзыв».
- Footer: «Сделано Поинтером».

## Technical observations before positive click
- Public activator URL is stable: /myasnoj-batya.
- In isolated fresh Chrome profile no localStorage/sessionStorage keys were observed before interaction.
- Branch/city selection is rendered inside the Pointer app; no direct external review links are exposed in the initial DOM.
- Pointer keeps the UX deliberately short: location selection -> sentiment split -> next action.
- We must preserve this low-friction pattern in SLUKH.

## Pending audit
- Exact behavior of «Позитивный отзыв».
- Platform chooser Yandex / 2GIS.
- Pointer network/event/session identifiers created on positive path.
- Whether email is requested and at what exact step.
- Exact redirect target and parameters.
- Whether Pointer later polls/matches a published review or only tracks outbound action.
- Reward/email trigger contract.

## Rule for SLUKH
Do not design matching from assumptions until the positive Pointer flow is captured.
No review-text prefill, candidate-selection UI, or manual review-link confirmation should be added merely as a workaround.
