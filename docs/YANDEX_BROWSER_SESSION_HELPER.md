# Browser cookie helper v2 — single secret paste, conditional fast path

Only Review Activator DEV. Session not imported by this change. No Yandex requests,
DB changes, scheduler activation, review persistence, alerts, push or deployment.
Business OS and production are untouched. Existing keys remain in the owner's console.

## Research result and explicit limitation

Chrome's [Network reference](https://developer.chrome.com/docs/devtools/network/reference)
documents request headers/cookies. The current
[HeaderSectionRow implementation](https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/panels/network/components/HeaderSectionRow.ts)
provides **Copy value** for one header. It copies the whole Cookie value unchanged.
The [Cookies pane](https://developer.chrome.com/docs/devtools/application/cookies)
shows Domain/Path/Expires/HttpOnly/Secure separately. No supported single-copy transfer
of the complete Request Cookies set WITH all these attributes was verified in the
documentation and inspected [CookiesTable implementation](https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/ui/legacy/components/cookie_table/CookiesTable.ts).
This is not a claim about every Chrome version or an observed operator browser UI.
The operator's browser/session was not inspected.

[RFC 6265 section 4.2.2](https://www.rfc-editor.org/rfc/rfc6265#section-4.2.2) explicitly
states that the Cookie header omits the attributes. HTTPS alone does NOT prove Secure;
an earlier successful request does NOT prove that its cookies remain unexpired now.
Copy-as-PowerShell/fetch/cURL is not a metadata source; HAR/profile export is forbidden.

**Implemented:** one hidden paste of all name=value pairs plus one shared metadata
block, not per-cookie Name/Value transfer. No JSON writing. This fast path is valid
ONLY if all retained cookies have identical observed Domain, Path, Secure, HttpOnly
and Expires, confirmed by the operator. Different/unknown metadata or Partition Key
means STOP, no import. Shared values are NOT inferred or supplied as defaults.

**Not achieved:** universal one-action import of an arbitrary heterogeneous real
cookie set. The operator's set has not been inspected; fast-path applicability is
NOT VERIFIED. A general solution still needs a separately approved trusted bulk
metadata source. It must not be simulated by assigning domain/path/expiry/flags.
No extension, browser security bypass, profile reader or second engine was introduced.

## Operator steps

Preparation: keep the SAME private PowerShell 7 that holds the three configured
server keys. No recording/transcript/debugging, clipboard history/sync/manager or
input capture. If host policy captures input, stop rather than weakening that policy.
Never paste secrets into chat or a shell command. Do not rerun setup or replace the
console; the encryption key is ephemeral and would be lost.

### Step 1 — start the helper

```powershell
& 'C:\Users\tasfo\BusinessOS\myasnoy-batya-review-dev\scripts\import-yandex-browser-session.ps1'
```

It checks PS7/server env before input. Confirm locally that the account is
`myasnoibatya-zakaz` and the ALREADY captured successful request is GET to
`https://yandex.ru/sprav/api/54309413522/reviews`. Do not refresh or replay it.

### Step 2 — copy once

In Chrome DevTools Network select that existing request, then Headers > Request
Headers. Right-click the **Cookie value** and choose **Copy value**. Do not copy all
headers, Set-Cookie, HAR, cURL, browser Console code or a profile export. The helper
must already be waiting at its clearly marked hidden input before the secret is pasted.

### Step 3 — paste once into the hidden prompt

Paste the entire value there, not in chat or the ordinary shell prompt. Nothing is
echoed. Ctrl+D finishes; Ctrl+C cancels; Enter does not submit. No per-cookie input.
Clear transient clipboard contents manually afterwards.

The helper shows only retained names for metadata matching, never values or prohibited
names. Confirm the shared observed attributes in Application > Cookies > yandex.ru.
This is an additional metadata check, NOT an automatic reconstruction. If they differ,
choose cancel; do not pretend they are equal just to proceed. Every ordinary metadata
prompt accepts `:cancel`. Expiry is `session`, observed Unix seconds, or ISO with an
explicit Z/offset; ambiguous/local dates, expired and non-finite values are rejected.
There is no guessed auth-cookie list, field default, lifetime extension or per-cookie
fallback wizard. Final `ИМПОРТ` confirmation performs one encrypted DEV import only.

## Parser and unchanged boundary

The parser accepts an ASCII, single-line Cookie value (optional `Cookie:` prefix),
bounded to 60,000 characters / 100 pairs / 8,192 characters per value. Splits on
semicolons and the first equals; preserves equals signs, percent encoding, plus signs
and quoted bytes literally. Never executes input or URL-decodes/unquotes it.
Empty pairs/values, newlines/control characters, malformed names, trailing semicolons,
Set-Cookie attribute confusion, excess size and duplicate names fail the entire batch.
Duplicates are checked case-sensitively BEFORE filtering, including forbidden names.
CSRF/XSRF/password/authorization/2FA/SMS names are dropped in memory before encryption;
an all-filtered set fails. The unchanged validator still rejects any forbidden input
arriving through another interface. No validator relaxation.

`import-yandex-browser-session.ps1` supplies the existing wrapper's InputReader.
`Invoke-YandexManualImport` passes the internally assembled session via bounded UTF-8
stdin to the existing `yandex-session.mjs import` CLI. The original `validateSession`,
AES-256-GCM, fixed Asbest scope and expectedRevision=0 CAS/private storage remain sole
authorities. Operator-confirmed metadata is revalidated before encryption. No real
review writer is called. The helper cannot independently prove clipboard provenance.

Scope remains company `13f3cb80-487a-4a19-96a1-fb3103200230`, location
`9a95f63b-18e6-447b-a449-8530b67ddbae`, org `54309413522` in DEV
`ykiubttldgyjpajmsuas`. No browser-side service key, env change or broad RPC is added.
Supabase least-privilege guidance is preserved by reusing the existing private boundary.

Plaintext exists briefly in process memory; SecureString/BSTR buffers are disposed and
references released. No secret files, history commands, raw child output or exception
printing. This cannot guarantee wiping immutable strings or protect against a compromised
host, paging, memory inspection or crash dumps. Names alone may appear during matching.

## Results and stop conditions

Successful first import prints only:

```text
session imported = true
state = NOT_CONFIGURED
revision = 1
```

NOT_CONFIGURED does not mean authenticated; no health/read follows. The first Yandex
GET requires a SEPARATE confirmation. Keep the console open. Persistence OFF;
`review-provider-due-check-hourly` PAUSED, neither is modified by the helper.

Before-child errors print imported=false, state UNKNOWN and a fixed safe code.
After an unconfirmed child outcome the existing NOT_CONFIRMED/UNKNOWN is retained:
a timeout could follow a committed write, so never claim imported=false or retry.
Every parse/metadata/cancellation failure occurs before the child starts (0 RPC).
The entire session is validated before the existing single atomic CAS, no partial batch.

## Verification

Current checkpoint: **153/153 tests PASS**, zero skipped/failed; **49 source checks
PASS**; working/staged diff checks PASS. No real session or credential was used.

Offline fixtures use the real collector + existing CLI and mocked DEV RPC. Synthetic
encrypted roundtrip verifies two retained cookies, exact values (including =/%/+),
unchanged scope/attributes and removal of forbidden names. Invalid headers, duplicate
names (also filtered names), foreign domain, wrong path, invalid flags/expiry,
oversize, mixed-metadata refusal and cancellation produce no import. Secret input is
requested once, not per cookie; output is checked for supplied secret markers.

Source guards exclude filesystem/profile access and a second engine; they are not
proof against OS paging. Existing import/encryption/CAS/isolation regressions remain.
PS<7 pre-input refusal uses a version fixture; native 5.1 remains NOT VERIFIED because
host script policy blocked it in v1 and was not bypassed. No actual keys/session used.
