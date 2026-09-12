# Metadata extension — pre-install security review

HISTORICAL v3 snapshot. Current source/permissions are documented in
[v4 Native Messaging security review](YANDEX_NATIVE_IMPORT_V4.md). Do not use the
old clipboard workflow. The owner installed v3; v4 registration/update is pending.

STATUS: offline implementation verified; native Chrome installation NOT VERIFIED.
No real cookies/session, Yandex request, DB mutation, push/deploy. Business OS and
production untouched. Supabase boundary reused unchanged; no browser server keys.

## Complete manifest

```json
{
  "manifest_version": 3,
  "name": "Review Activator DEV — Cookie Metadata",
  "version": "0.1.0",
  "minimum_chrome_version": "132",
  "description": "Local operator-only metadata export for the Asbest DEV read smoke.",
  "permissions": ["cookies", "clipboardWrite"],
  "host_permissions": ["https://yandex.ru/*"],
  "incognito": "not_allowed",
  "action": {"default_popup": "popup.html", "default_title": "Review DEV: metadata only"},
  "content_security_policy": {
    "extension_pages": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'"
  }
}
```

## All source files

- [manifest.json](../tools/yandex-cookie-metadata/manifest.json): permissions/CSP.
- [metadata.js](../tools/yandex-cookie-metadata/metadata.js): strict parser/read/projection.
- [popup.js](../tools/yandex-cookie-metadata/popup.js): click-only adapter/clipboard.
- [popup.html](../tools/yandex-cookie-metadata/popup.html): masked names-block input.
- [popup.css](../tools/yandex-cookie-metadata/popup.css): local styles.

No other extension sources, generated runtime or dependencies.

## Security findings and limitations

Chrome cookies permission technically permits read/write: no read-only variant.
Code calls only getAll/getAllCookieStores; tests reject mutation APIs.
clipboardWrite exports freshly allowlisted metadata, never raw responses.
Only host permission is https://yandex.ru/*. No tabs/debugger/storage/clipboardRead
permission, background/content scripts, remote code, native messaging or telemetry.
Basic tab query relies on scoped host permission for URL access.

Cookie API responses include values transiently in memory. Exporter NEVER accesses
value (tested using a throwing getter), spreads or serializes raw cookie objects.
Batch references clear on success/error/cancel; this is not guaranteed memory wiping.
No storage, filesystem, logging, raw exceptions or network API. CSP connect-src
'none' additionally blocks connections; other unspecified resources are denied.

Each read uses exact Asbest URL + requested name + active-tab store + partitionKey={}
to include all partitions. Multiple/missing results or any partitionKey fail.
Store enumeration returns IDs/tab IDs, not all account cookies. Domain/path/flags/
expiry/session shape checked. Only name/domain/path/secure/httpOnly/expirationDate/
partitioned exported. Session expirationDate=null; partitioned cookies rejected.

PowerShell checks exact output schema, names, five-minute freshness and correlation.
Correlation is not authentication or proof an old header matches current browser.
Operator must use same account/profile. Values are not compared against browser.
No metadata inference. Existing validator/encryption/private storage/CAS unchanged.
Cancellation cannot recall a metadata clipboard write already in flight; extension
cannot itself import. Remove/disable after use to revoke temporary host access.
Immutable strings/OS paging/crash dumps/compromised hosts remain outside guarantees.

## Verification

191/191 full offline tests PASS; 53 source checks PASS. Tests cover exact source
inventory/host/CSP, no network/storage/mutations, names filtering, throwing value
getter, partition/ambiguity/missing/expired failures, cancellation and cleanup.
Actual popup module executes with mocked DOM/Chrome/clipboard, NOT native Chrome.
PowerShell tests exercise heterogeneous metadata through existing encrypted CLI
with synthetic inputs and mocked RPC; invalid input causes zero import calls.
Engine files unchanged. No real DB recheck in this checkpoint: scheduler PAUSED /
persistence OFF remain prior verified/user-reported state and were not modified.

## References and procedure

- [Chrome cookies API](https://developer.chrome.com/docs/extensions/reference/api/cookies)
- [Chromium all-partition implementation/test](https://chromium.googlesource.com/chromium/src/+/45052d18b0f8dd0eb1a7492dc92acb8ba96aff64%5E%21/)
- [Installation and operator workflow](YANDEX_BROWSER_SESSION_HELPER.md)
