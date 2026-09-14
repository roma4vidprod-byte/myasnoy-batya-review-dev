# Review Activator DEV — Current Baseline

Проверено: 2026-09-14, локальный аудит в `myasnoy-batya-review-dev`.

## Source baseline

| Поле | Факт |
|---|---|
| repository | `roma4vidprod-byte/myasnoy-batya-review-dev` |
| local path | `C:\Users\tasfo\BusinessOS\myasnoy-batya-review-dev` |
| branch | `codex/yandex-live-read-smoke-01` |
| starting HEAD | `bd3d96a4630c19e8cd57bc73049a219a6b50a479` |
| starting tree | `f49b7a2679787172e504ff6743c305eab851fa8c` |
| starting working tree | clean |
| origin/main | `e255faf6a0b3f69c45c75e18a468d03c81c3d110`; старее локальной рабочей цепочки |
| destructive reset/checkout | не выполнялся |
| starting uncommitted work | отсутствовала; сохранена |

## DEV target

| Поле | Факт |
|---|---|
| Vercel project | `myasnoy-batya-review-dev` |
| Vercel project id | `prj_NkAbgqsS4dNtENVXDsw20wtgTeH4` |
| Supabase DEV project ref | `ykiubttldgyjpajmsuas` |
| company | `13f3cb80-487a-4a19-96a1-fb3103200230` |
| location | `9a95f63b-18e6-447b-a449-8530b67ddbae` |
| provider / organization | `yandex` / `54309413522` |

Historical Preview/deployment identifiers from the handoff are not treated as current provenance until re-read from the platform. No old remote commit was substituted for the local source.

## Safety boundary

This remediation run performed no Yandex requests, no 2GIS requests, no worker/enqueue calls, no scheduler changes, no review/promo mutations, no replies, no transactional email/Telegram delivery, no paid AI call, and no remote DB write. Production, Business OS, Social and VK Ads were not targeted.

Historical counts and states in the handoff are evidence for the earlier DEV run, not a fresh remote assertion in this local-only checkpoint.
