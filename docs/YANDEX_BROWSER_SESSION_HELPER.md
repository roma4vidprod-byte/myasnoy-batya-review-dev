# Browser cookie helper v3 — local metadata matching

HISTORICAL / STOP: the owner discontinued manual header/metadata transfer.
Use [v4 review and native workflow](YANDEX_NATIVE_IMPORT_V4.md), not the steps below.

Implemented for pre-install review. No real session import, browser cookie read,
Yandex request, DB changes, scheduler activation, persistence, push or deployment.
Business OS/production untouched. Existing validator, AES, CAS and CLI unchanged.

Read [security review and all sources](YANDEX_METADATA_EXTENSION_SECURITY_REVIEW.md)
BEFORE installation. An ordinary page snippet cannot obtain HttpOnly metadata.
The approved unpacked extension receives only names; the hidden header stays in
PowerShell memory. Different attributes are matched per cookie, never guessed.

## One-time installation — one operator action at a time

1. Open chrome://extensions in the existing Chrome profile.
2. Enable Developer mode.
3. Choose Load unpacked and select
   C:\Users\tasfo\BusinessOS\myasnoy-batya-review-dev\tools\yandex-cookie-metadata.
4. Review permissions, then pin Review Activator DEV — Cookie Metadata.

Chrome 132+ required. Native installation/permission behavior is NOT VERIFIED.
No automatic installation, Web Store publication, Yandex reload or request replay.

## Later workflow — three phases, not literally three clicks

Use the SAME private PowerShell 7 with configured keys. No recording/transcripts,
clipboard history/sync/managers or enforced input capture. Never paste secrets into
chat, commands, files, screenshots or browser Console.

### 1. Start helper, paste existing header hidden

```powershell
& 'C:\Users\tasfo\BusinessOS\myasnoy-batya-review-dev\scripts\import-yandex-browser-session.ps1'
```

Confirm technical account myasnoibatya-zakaz and the already successful GET
https://yandex.ru/sprav/api/54309413522/reviews. In that existing DevTools Network
entry, Request Headers > Cookie > Copy value. Paste ONLY in the waiting hidden
prompt; Ctrl+D submits, Ctrl+C cancels. No HAR/cURL/replay.
The helper overwrites clipboard with a nonsecret names-only request block.

### 2. Obtain metadata locally

Keep the same Yandex Business tab/profile selected. Open extension, paste the
prepared names block, click **Скопировать метаданные**. Do NOT paste Cookie header
into the extension. It reads only requested names for the fixed Asbest URL and
active tab's store. Missing/ambiguous/partitioned/invalid cookies stop the export.
No network. Clipboard receives metadata only.

### 3. Return metadata to waiting helper

Paste into its second hidden prompt, Ctrl+D, within five minutes. It checks exact
fields, correlation, freshness, names and individual attributes, combines values
held locally and requests final ИМПОРТ confirmation. Only that confirmation runs
the existing encrypted atomic import. Do not perform real import at the current
extension-development checkpoint.

Successful first import subsequently prints only:

```text
session imported = true
state = NOT_CONFIGURED
revision = 1
```

No GET follows. NOT_CONFIGURED does not prove authentication. An uncertain child
outcome retains NOT_CONFIRMED/UNKNOWN: never automatically retry. Clear clipboard,
disable/remove extension afterwards; keep key console open. Persistence OFF and
scheduler PAUSED are not changed by the helper.

## Boundary

Strict existing parser rejects duplicate names before forbidden-name filtering.
No guessed auth set. Metadata extra value fields, missing/duplicate names, foreign
domain/path, partitioned/insecure/expired cookies fail before import. Observed
session expirationDate=null maps to existing expires=-1. validateSession remains
final authority, followed by existing AES/CAS/CLI and expectedRevision=0.

Scope: company 13f3cb80-487a-4a19-96a1-fb3103200230, location
9a95f63b-18e6-447b-a449-8530b67ddbae, org 54309413522, DEV ykiubttldgyjpajmsuas.
Correlation is not a signature or proof of header freshness. Operator must use
same account/profile; values are not compared against current browser cookies.
Clearing references/buffers cannot guarantee wiping immutable strings, paging or
crash dumps, or protection from compromised-host capture.

Verification: 191/191 offline tests PASS, 53 source checks PASS. Synthetic tests
cover heterogeneous metadata, header+map through existing encrypted CLI,
missing/duplicate/partitioned/expired/invalid fields, cancellation and leakage.
No native Chrome extension installation or real session used.
