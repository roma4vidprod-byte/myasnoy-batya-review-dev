# Yandex operator import v4 — pre-use security review

## Superseding DEV runtime boundary — 07A.3F

For the live Review Activator DEV operator flow, the Vercel Preview keyring is
now canonical. `scripts/start-yandex-local-import.ps1` no longer requires or
reads `SUPABASE_SERVICE_ROLE_KEY`, `YANDEX_SESSION_KEYS_JSON` or
`YANDEX_SESSION_ACTIVE_KID`; it requires only the process-only
`REVIEW_WORKER_SECRET` to obtain a short-lived import capability and submit the
session to the protected Preview worker. Vercel performs the existing
validation, AES-256-GCM encryption and CAS replace. The detailed superseding
boundary is documented in
[YANDEX_CANONICAL_SERVER_KEYRING_07A3F](YANDEX_CANONICAL_SERVER_KEYRING_07A3F.md).

The remainder of this document is historical v4 design evidence and synthetic
test coverage. Any instruction below that says the local CLI owns live
encryption/import is superseded for the live DEV operator flow.

## Current checkpoint: revision-aware reimport 07A.3

The existing native/import boundary now reads the current scoped session status
through the existing server-only CLI before importing. It passes that exact
revision as `expectedRevision` to the existing atomic replace/CAS operation and
accepts only `revision + 1` with `state=NOT_CONFIGURED`. This prevents an old
initial-import assumption (`expectedRevision=0`, `revision=1`) from overwriting
an existing DEV session. The status read and replace are separate child
processes with sanitized environments; neither performs a Yandex request. A
CAS mismatch fails closed and must not be retried automatically.

For the current Asbest DEV recovery, the observed pre-import revision is `7`,
so the expected successful result is `revision=8`. Keyring, active KID,
validator, AES-GCM implementation, private storage and native cookie boundary
are unchanged. Real reimport and Vercel decrypt confirmation remain pending;
no Yandex request is authorized by this checkpoint.

## Current checkpoint: approved unpartitioned selection 0.2.4

Owner confirmed 140 records: 118 partitioned, 22 metadata-eligible, zero eligible
duplicate groups/excess; values remain unchecked and import_calls=0. Owner explicitly
approved excluding partitioned records before the count/duplicate gates. This
supersedes the earlier fail-all-partitioned policy below, not any server validation.

Import and diagnostics share selectUnpartitioned: inspect at most 10,000 raw
records (larger batches FAIL without truncation), require exact store/domain even
for excluded records, exclude records with an own object partitionKey. Malformed
partition status fails. Require 1..100 remaining records BEFORE prohibited-name
filtering; remaining duplicate names, invalid metadata/values still fail. No guessed
subset or deduplication. projectCookie and server validateSession stay unchanged.
Raw diagnostic counts retain partitioned/rejected totals; metadata-only PASS does
not validate credentials or authentication. Excluded value properties are never read
by selection; Chrome's API necessarily returns them transiently in memory. Both
raw/selected arrays are cleared best-effort, not a promise of physical memory erasure.

Permissions/CSP/native registration are unchanged. No real import, browser cookie
read, Yandex GET, DB access, scheduler/persistence activation, push/deploy this change.
Synthetic tests cover 140 -> 22 -> existing encrypted service with mocked storage,
malformed partition status, foreign scope, limits, cancellation and value traps.
Reload the extension to 0.2.4 only; keep importer stopped for diagnostic verification.

Verification: full suite **257/257 PASS**, **69 checks PASS**, diff-check PASS.
Server session engine and native cookie boundary are unchanged; the import
PowerShell wrapper now reads the current revision and uses revision-aware CAS.

## Previous checkpoint: eligible-name duplicate counts 0.2.3

Owner-reported 0.2.2 result: total/examined=140, prohibited_names=0,
metadata_eligible=22, metadata_rejected=118, duplicate_name_groups=4,
duplicate_name_excess=114, partitioned=118, scope_mismatch/not_secure/expired=0,
counts_complete=true, values_checked=false, import_calls=0. This does not prove
the eligible 22 have unique names or establish successful authentication.

With explicit approval, 0.2.3 adds ONLY eligible_duplicate_name_groups and
eligible_duplicate_name_excess. These count case-sensitive repeated names and
records beyond the first INSIDE metadata_eligible, after the existing prohibited
name exclusion and projectCookie gate. Rejected/partitioned matches do not enter
these two diagnostic counters; global duplicate counters remain unchanged.
No cookie values, names or metadata records are exported. Value-access traps and
mixed/synthetic 140-record tests verify isolation of the eligible counters.

This is not permission to drop partitioned cookies, deduplicate a session, raise
the 100-record import cap or retry import. All engine/selection rules are unchanged.
No actual cookie reads, DB access, Yandex GET, registry change, push or deploy.
Reload extension only to 0.2.3; importer stays stopped. Use the diagnostic button.

Verification: full rerun **254/254 PASS**, **69 checks PASS**, diff-check PASS.
The first concurrent test/check run had one native-host startup timeout at the
8-second test budget (253/254); rerun without concurrent checks passed unchanged.
No runtime or test timeouts were raised; this remains a timing-sensitive harness.

## Previous checkpoint: aggregate metadata counts 0.2.2

The owner reported stage COOKIE_READ / COOKIE_SET_TOO_LARGE / import calls=0
from 0.2.1. This confirms a CURRENT blocker: Chrome returned more than 100
URL-matching records, and the gate runs before prohibited-name filtering. The
number of eligible cookies and any later validation failures remain unverified.

The owner authorized a diagnostic census only, NOT a larger import limit,
automatic filtering fix, subset selection or another import. Version 0.2.2 adds
aggregate counts to the same diagnostic result only for an oversized set:

- total / examined: returned and inspected record counts;
- prohibited_names: records whose valid names match the existing prohibited rule;
- metadata_eligible: non-prohibited records individually passing projectCookie;
- metadata_rejected: remaining records failing name/metadata validation;
- duplicate_name_groups / duplicate_name_excess: repeated names and records beyond
  the first, case-sensitive across valid names INCLUDING prohibited names;
- partitioned / scope_mismatch / not_secure / expired: overlapping indicators,
  not additional mutually exclusive buckets (counted for valid names);
- counts_complete: false if the 10,000-record diagnostic work cap is reached;
- values_checked=false: no credential property is inspected.

prohibited_names + metadata_eligible + metadata_rejected equals examined.
Metadata-eligible records may share duplicate names and are NOT a count of
importable credentials or authenticated sessions. No names, values, domains,
paths or per-cookie objects are displayed/exported. The native channel still
receives ONLY the fixed diagnose message, never the counts or cookie data.
Cancellation discards partial counts; raw references clear in the existing finally.

The actual import limit remains 100 BEFORE filtering and validateSession is
unchanged. COOKIE_SET_TOO_LARGE remains the diagnostic code; no PASS or automatic
import follows the census. No actual cookie read, DB access, registry change,
Yandex request, scheduler/persistence activation or push/deploy by the agent.
Reload only the extension to 0.2.2; do not start importer or reinstall the host.
Use the same **Диагностика без импорта** button and report the scalar result.

Verification: **252/252 full tests PASS**, **69 checks PASS**, diff-check PASS.
Targeted tests cover exact aggregate arithmetic, value getters that throw on
access, case-sensitive duplicates including prohibited names, cancellation,
bounded/incomplete scans and the unchanged import gate.

## Previous checkpoint: read-only diagnostic 0.2.1

The owner registered the native host and loaded extension 0.2.0. A real import
attempt stopped at NATIVE_CANCELLED_EXPIRED_OR_INVALID, before the CLI dispatch
marker. This code does not distinguish timeout, framing, connection or metadata
failure. The actual root cause remains NOT VERIFIED. No live GET was authorized.
The supplied /sprav/54309413522/p/edit/reviews/ URL passes the static scope rule.

Read-only local checks confirmed the registered name/origin and executed its
actual launcher: synthetic hello roundtrip and cancellation succeeded, with zero
cookie reads/import calls/Yandex requests. This is not proof of the full Chrome
connection or the real cookie set, and does not query existing session state.

The owner approved a separate **Диагностика без импорта** button in 0.2.1.
It sends exactly {version:1,op:diagnose} to the registered native adapter. That
branch returns a fixed diagnostic acknowledgement and exits BEFORE connecting
to any importer pipe, issuing a nonce, loading keys or invoking a CLI/RPC. Unknown
fields (including session) reject the message. Trailing import frames are ignored
because the diagnostic host exits. No import is retried and no DB status is read.

Only after that acknowledgement does the extension check the active Asbest tab,
cookie store and metadata for the existing exact reviews URL. Chrome's API still
returns values transiently in memory, but the diagnostic never accesses value,
constructs a session, exports metadata/names, or sends any cookie data to the host.
The existing projectCookie metadata gate is reused without changing its rules.
Raw batch references clear in finally; best-effort memory limitations still apply.

Output is exactly three safe fields: diagnostic stage, diagnostic code, import
calls=0. Stages distinguish extension ID, Chrome/native channel, tab, store,
cookie read and metadata. Codes distinguish duplicate/partitioned/insecure/expired/
invalid metadata. Only fixed Chrome error strings map to predefined native codes;
unknown exceptions become CHECK_FAILED, never raw output. No cookie names/values.

PASS_VALUES_NOT_CHECKED means ONLY native acknowledgement + metadata success:
credential contents, keyring, current importer pipe, TTL under a real import,
server storage, account identity and Yandex authentication are NOT checked.
Diagnosis cannot establish READY or stored revision. The original import engine,
its safety rules and its uncertain-result handling are unchanged.

New source: [diagnostics.js](../tools/yandex-cookie-metadata/diagnostics.js).
No permissions added. Existing registration points to the updated local host
script; do NOT reinstall/register again. Reload only the unpacked extension to
version 0.2.1. Do not start PowerShell importer. On the existing Yandex tab click
**Диагностика без импорта**, keep the popup open and report only its three fields.
Do not refresh Yandex or click Connect. Both buttons lock after a diagnostic starts;
there is no automatic follow-up import.

Verification: **248/248 full tests PASS**, **69 checks PASS**, diff-check PASS.
The already registered WindowsApps PowerShell launcher also returned the exact
new diagnostic response and exited with empty stderr, without cookie reads, any
importer listener or RPC. Registration was inspected, not modified/reinstalled.
Native Chrome 0.2.1 diagnostic click still awaits the owner; do not infer its result.

23 targeted diagnostics tests cover value-access traps, safe codes, metadata
failures, malformed native replies, cancellation, actual host binary stdio without
env/listener and a trailing-import rejection. Full-suite/check results are recorded
in the handoff. This checkpoint has no real cookie read or import by the agent,
no Yandex request, scheduler/persistence change, registry change or push/deploy.

The original v4 design snapshot follows; its historical installation/testing
statements below are superseded by this current checkpoint.

Only myasnoy-batya-review-dev. Real import is NOT authorized by this implementation
checkpoint. Do not refresh Yandex, run GET, enable scheduler/review persistence,
send alerts, push/deploy, or operate Business OS/production.

The owner supplied installed extension ID `gdjhmlbffahmpnphfoogegihhnfkoojm`.
The previous extension was installed/opened by the owner; the v4 update and native
registration have NOT been installed or exercised through real Chrome yet.

## Decision: Native Messaging, not a localhost HTTP listener

The initially preferred TCP design needs a trustworthy bootstrap for its nonce.
An Origin header protects against other web pages, but a local executable can
spoof it; an unauthenticated listener issuing its own nonce does not prove its
identity to the extension. Passing a nonce manually would defeat the requested UX.

Native Messaging adds a one-time per-user registration, then needs no manual
transfer. Chrome checks the exact allowed extension origin; Windows same-user
named pipes connect the Chrome-launched adapter to the existing key-holding PS7.
CurrentUserOnly is set on BOTH pipe ends, checking server/client user and elevation.
No TCP port, HTTP endpoint, CORS, DNS, port discovery or external extension network.
The host permission remains exactly https://yandex.ru/*; CSP connect-src remains none.

This relies on a trusted local user/profile, source tree and HKCU registration.
It does NOT defend against malicious software running as that same user/elevation,
administrators, debugger/process capture, paging or crash dumps. Origin argv alone
is not an OS authentication boundary: Chrome's allowlist and pipe ACL do that work.

## Complete extension manifest

```json
{
  "manifest_version": 3,
  "name": "Review Activator DEV — Cookie Metadata",
  "version": "0.2.4",
  "minimum_chrome_version": "132",
  "description": "Operator-initiated local native import for Asbest DEV. No Yandex requests.",
  "permissions": ["cookies", "nativeMessaging"],
  "host_permissions": ["https://yandex.ru/*"],
  "incognito": "not_allowed",
  "action": {"default_popup": "popup.html", "default_title": "Review DEV: connect Yandex Business"},
  "content_security_policy": {
    "extension_pages": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'"
  }
}
```

cookies technically permits mutation; reviewed code uses only getAll and
getAllCookieStores. nativeMessaging permits only locally registered native hosts;
this code names one fixed host and independently checks chrome.runtime.id.
clipboardWrite was REMOVED. No clipboard input/output, storage permission,
content/background scripts, externally_connectable or remote code.

## Complete source inventory

- [manifest.json](../tools/yandex-cookie-metadata/manifest.json)
- [connect.js](../tools/yandex-cookie-metadata/connect.js): automatic collection,
  native channel, cancellation, bounded protocol and fixed safe statuses.
- [metadata.js](../tools/yandex-cookie-metadata/metadata.js): existing attribute
  projection reused; historical v3 export retained for regression, not exposed in UI.
- [popup.js](../tools/yandex-cookie-metadata/popup.js)
- [popup.html](../tools/yandex-cookie-metadata/popup.html)
- [popup.css](../tools/yandex-cookie-metadata/popup.css)
- [start-yandex-local-import.ps1](../scripts/start-yandex-local-import.ps1): ephemeral
  same-user listener in the owner's existing PS7; no persistent server/service.
- [yandex-native-host.ps1](../scripts/yandex-native-host.ps1): Chrome's binary stdio
  adapter, exact origin check, same-user pipe client. Never terminal secret output.
- [yandex-native-protocol.ps1](../scripts/yandex-native-protocol.ps1): UTF-8 framed
  messages, nonce TTL/single-use, adapter to unchanged manual wrapper/CLI.
- [install-yandex-native-host.ps1](../scripts/install-yandex-native-host.ps1):
  one-time NONSECRET HKCU registration and static launcher/manifest only.

Unchanged sole engine: import-yandex-session.ps1 -> yandex-session.mjs import ->
validateSession -> AES-256-GCM -> scoped current-revision CAS/private storage.
No API, database migration, grants, provider or scheduler changes.

## Fixed scope and cookie policy

- account: myasnoibatya-zakaz
- organization: 54309413522
- company: 13f3cb80-487a-4a19-96a1-fb3103200230
- location: 9a95f63b-18e6-447b-a449-8530b67ddbae
- DEV project: ykiubttldgyjpajmsuas

The active tab must be HTTPS yandex.ru, /sprav/, with organization ID as an exact
path segment, non-incognito and a uniquely identified cookie store. Otherwise stop;
do not infer scope from an arbitrary tab or send cookies to discover it.

Query only cookies matching the full /sprav/api/54309413522/reviews URL, in that store,
including partitions so ambiguity cannot be hidden. This is a deterministic
URL-applicable eligible set, NOT proof of the minimal authentication cookie set or
the exact historic Request Cookie header. No all-domain/browser-profile dump.
As of approved 0.2.4, partitioned records are excluded before the 100-record gate.
Malformed partition status, invalid domain/store (including excluded records),
remaining duplicate names and missing/invalid retained attributes fail closed.
Prohibited CSRF/XSRF/password/authorization/2FA/SMS names
are excluded; an all-excluded set fails. Retained cookies must pass existing
domain/path/secure/httpOnly/expiry/value checks, and validateSession again server-side.
No attribute guessing, value decoding, authentication-list guesses or validator changes.

The account label remains an OPERATOR ASSERTION on the connect button, as in v1.
Cookie metadata cannot prove account identity or authorization to an organization.
No live validation occurs: successful import returns only NOT_CONFIGURED.

## Protocol and state boundary

1. Start listener manually in the same PS7 process; require three existing server
   env variables and Node before listening. It accepts only one same-user pipe
   connection, with FirstPipeInstance and 120-second total pre-import lifetime.
2. Explicit button click opens Chrome native port. Registered allowed_origins and
   host argv both require the exact extension ID. Adapter hello carries fixed origin.
3. Server issues 32 random bytes as nonce over the authenticated local pipe only.
   Nonce is never printed, stored, passed in argv or clipboard. No public bootstrap.
4. Extension collects eligible cookies after successful hello. One import message
   carries version/op/nonce/session. Scope/revision cannot be selected by browser.
5. Exact envelope keys, TTL and nonce are checked. First attempt consumes the nonce
   even if invalid. No second attempt/replay/reconnect processing by that listener.
6. Existing wrapper passes session only through bounded child stdin and retains
   its sanitized environment; keys never go to Chrome/native adapter. The existing
   CLI encrypts before one fixed DEV RPC. No read/health/alert operation is called.
7. Only successful state NOT_CONFIGURED with exactly current revision + 1 yields
   the local operator success result.
   Listener/host close after result. No automatic retry. Caller key env is retained.

Frames are bounded at 65,000 bytes before allocation and decoded with strict UTF-8;
session's existing 60,000-byte validation and CLI 70,000-byte bound remain in force.
Reads/writes have deadlines; malformed/EOF/oversize/expired input stops. There is
no JSON response echo, raw exception, logger, value display, clipboard or plaintext
file. Native stdio carries protocol bytes only, never console transcript output.
Buffers are zeroed and references released best-effort; immutable copies cannot
be guaranteed erased. Do not enable transcription/debug capture of operator code.

Cancellation BEFORE the complete import is accepted causes no mutation. AFTER
acceptance/CLI dispatch, closing the popup or losing a response cannot roll back an
atomic DB write. The UI therefore says NOT CONFIRMED, never falsely 'not imported'.
Stop and arrange a separately approved metadata-only status check; do not retry.

## External destinations

Extension/native adapter: none; only OS IPC. No loopback TCP or Yandex network.
Server importer: ONLY existing fixed Supabase DEV storage RPC, with ciphertext and
server auth. 'No external network' cannot literally apply to encrypted DEV DB
persistence itself; it applies to browser/native material transfer. Existing RPC
disallows redirects. Yandex/alerts/scheduler/review persistence never invoked.

## Verification and remaining acceptance

Implementation checkpoint: **225/225 tests PASS**, zero failed/skipped;
**67 source/JSON/inline-script/PowerShell syntax checks PASS**; diff-check PASS.
No standalone build script exists in this static DEV project; npm run check is
the repository's available code/configuration verification. No deploy/build to Vercel.

Offline tests cover collection/forbidden filtering and scope failures, unchanged
validation/encrypted CAS roundtrip, native framing/limits/invalid UTF-8/EOF, exact
origin, expiry, bad nonce, replay, cancellation and no secret output. Tests run an
ACTUAL PS7 native host process over same-user Windows pipes and binary stdio,
through the actual existing CLI with synthetic data and mocked storage RPC.
Registry installation is NOT executed by tests. Chrome popup/API are mocked;
native Chrome permission/launcher integration remains a manual acceptance step.

TCP bind/CORS/HTTP Origin tests are not applicable: there is no HTTP server. Their
replacements are same-user pipe options, exact Chrome origin, no network APIs and
native allowlist checks. Cross-user/elevation rejection is backed by Windows API
configuration; no second Windows account/elevation was exercised by these tests.

No real session/keys/DB query used. Scheduler PAUSED/persistence OFF are prior state,
not freshly queried here, and have not been modified. Full test/check/diff results
are reported in the implementation handoff; not evidence of a live import.

## One-time preparation — only after review

Cancel the old hidden prompt with Ctrl+C. Do not copy anything from DevTools.
In PS7 run the installer ONCE (no secret input, no browser/data access):

```powershell
& 'C:\Users\tasfo\BusinessOS\myasnoy-batya-review-dev\scripts\install-yandex-native-host.ps1'
```

It creates only %LOCALAPPDATA%\ReviewActivatorDev\YandexNativeV4\host.json and host.cmd,
and HKCU\Software\Google\Chrome\NativeMessagingHosts\com.review_activator.dev_yandex.
No secrets, global registry changes or policy bypass. It refuses existing paths/
registration; on partial failure stop for inspection, not overwrite/retry. Manifest
allows exactly chrome-extension://gdjhmlbffahmpnphfoogegihhnfkoojm/.

Reload the existing unpacked extension at chrome://extensions (not the Yandex tab).
Review the new nativeMessaging permission. Keep the same directory and confirm ID
unchanged. Do not enable Incognito or broaden host permissions. No need to relaunch
Chrome from the key-bearing console; never expose its environment to Chrome.

## Normal use after separate real-import authorization: exactly two actions

1. In the SAME open PS7 where SETUP PASS occurred, launch:

```powershell
& 'C:\Users\tasfo\BusinessOS\myasnoy-batya-review-dev\scripts\start-yandex-local-import.ps1'
```

2. On the existing organization's Yandex Business tab in the technical account,
   click **Подключить Яндекс Бизнес** in the extension within 120 seconds. Keep its
   popup open until the result. No manual cookie/header/JSON/metadata inputs.

Success is exactly:

```text
Session imported
State: NOT_CONFIGURED
```

STOP afterwards. No automatic Yandex GET. Keep the key-bearing console open;
disable/remove the extension when finished. Revoke the dedicated native registration
later only after inspecting those exact nonsecret paths/key; no broad cleanup.

## Primary references

- [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [Chrome cookies URL filtering](https://developer.chrome.com/docs/extensions/reference/api/cookies)
- [Windows pipe CurrentUserOnly on both ends](https://learn.microsoft.com/en-us/dotnet/api/system.io.pipes.pipeoptions)
- [Supabase server key boundary](https://supabase.com/docs/guides/getting-started/api-keys)
