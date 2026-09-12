# Browser cookie helper — operator handoff, no live import performed

Scope: Review Activator DEV only. Existing configured PowerShell 7 process, technical
account `myasnoibatya-zakaz`, org `54309413522`. Business OS/production are untouched.
No push/deployment, DB change, scheduler change, Yandex request or real session import
is part of this implementation. Review persistence stays OFF; scheduler stays PAUSED.

## First action only

In the SAME still-open private PowerShell 7 that holds the configured server keys, run:

```powershell
& 'C:\Users\tasfo\BusinessOS\myasnoy-batya-review-dev\scripts\import-yandex-browser-session.ps1'
```

Do not open a replacement console, rerun key setup, supply arguments or write JSON.
Follow the next prompt locally, one field at a time. Report only safe status, never
cookie values, screenshots, terminal dumps or environment values.

## What the helper asks

The operator checks the already authorized technical account and the ALREADY captured
successful GET `/sprav/api/54309413522/reviews` in DevTools Network / Request Cookies.
Use Application / Cookies / yandex.ru only to obtain metadata of those sent cookies.
Do not reload/replay any request. Missing captured request, unknown metadata, partitioned
cookies, or ambiguous duplicate names means STOP. The helper cannot independently prove
browser provenance: the operator must confirm it. No authentication-cookie set is guessed.

Each cookie is entered as individual fields, not JSON:

- Name, Domain, Path, Secure, HttpOnly, Expires are ordinary prompts; never paste a value
  into these prompts. Type `:cancel` to abort without import.
- Domain/path/flags must match the observed browser metadata exactly. No guessed defaults.
- Expiry accepts `session` for a browser session cookie, Unix seconds, or an ISO timestamp
  with explicit Z/offset. No local-time/timezone guess or lifetime extension. Invalid,
  non-finite, ambiguous or past expiry is rejected.
- Only at the clearly marked hidden VALUE prompt, enter the raw cookie value without
  URL-decoding. It does not echo; Ctrl+D finishes; Ctrl+C cancels. Enter does not submit.
- After each record, choose whether another observed cookie is needed. Finally type
  `ИМПОРТ` only when ready; anything else cancels before the CLI starts.

No HAR, cURL, files, browser Console/scripts, profile/database access or automatic cookie
extraction. Use an unrecorded trusted console without transcript/debug/input capture or
clipboard history/sync/managers. Clear transient clipboard contents manually afterward.
Never put secrets in chat. If host policy captures input, stop rather than changing policy.

## Reused boundary

`import-yandex-browser-session.ps1` only collects fields and builds a SecureString JSON
in memory. It supplies an InputReader to the existing `Invoke-YandexManualImport`;
that wrapper retains fixed scope, expectedRevision=0, bounded UTF-8 stdin, restricted
child environment and captured/sanitized output. No parent env modification or key setup.

The existing Node `yandex-session.mjs import` remains the sole importer. Its unchanged
`validateSession()` rechecks every record before AES-256-GCM encryption and the existing
CAS RPC. Helper checks are early UX rejection, not an alternative authoritative validator.
Duplicate names are rejected case-sensitively, as in the existing contract; never merged.
Forbidden names, other domains, unsupported paths, insecure/expired cookies, malformed
values and excess records fail closed. Only one import attempt, no retry.

Allowed paths remain `/`, `/sprav`, `/sprav/`, `/sprav/api`, `/sprav/api/`; validation was
not weakened. No new RPC, browser-side key, session engine, transport or persistence engine.
Supabase least-privilege guidance was applied by retaining the existing private/server-only
storage and restricted child environment, without adding grants or reading real credentials.

Plaintext briefly exists in PowerShell/Node memory only. Secure buffers are disposed and
references released. Immutable .NET/JS strings cannot be guaranteed wiped; this is not
protection against a compromised host, paging, crash dumps or memory inspection.

## Safe results

Successful first import emits only the existing status block, no names/values:

```text
session imported = true
state = NOT_CONFIGURED
revision = 1
```

NOT_CONFIGURED is intentional: import is not a successful Yandex health check.
Before-child failures report `session imported = false`, state UNKNOWN and a fixed
error code. If the child started but did not return a confirmed result, the existing
wrapper preserves `NOT_CONFIRMED` / UNKNOWN: a timeout may occur after the DB committed.
Do not fabricate false/NOT_CONFIGURED/revision 0 for that case and do not retry. A later
metadata-only check is required. No GET, alerts or scheduler/persistence activation follows
import automatically. The console must remain open because its AES key is ephemeral.

## Verification

Implementation checkpoint: **145/145 tests PASS**, zero skips/failures; **48 checks
PASS**; diff-check PASS. All new runtime tests use synthetic input and mocked RPCs.
The actual PS7 script entrypoint rejects missing env and unexpected arguments before
prompting. No operational secret/session was provided to the agent or test runner.

Run the full offline `npm test`, `npm run check`, `git diff --check` in a secret-free
console. Synthetic fixtures exercise fields through the real collector and existing CLI
with an encrypted mocked CAS RPC. Invalid input/cancellation does not start the CLI.
Source checks exclude filesystem writes, browser/profile access and alternate engines;
tests assert no supplied plaintext in output. These checks are not proof against OS paging.

PowerShell <7 is covered by a version-provider fixture before input/runtime creation.
Native Windows PowerShell 5.1 script execution was blocked by host execution policy;
that policy was not bypassed and native execution is NOT VERIFIED. PowerShell 7 tests
run the actual functions. Existing encryption/import/tenant-isolation tests remain required.
