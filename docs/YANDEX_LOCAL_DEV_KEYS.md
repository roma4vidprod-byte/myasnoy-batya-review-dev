# Local DEV keys — operator reports setup PASS; waiting for session input

2026-09-12. Only `myasnoy-batya-review-dev`, Supabase `ykiubttldgyjpajmsuas`.
No deployment, DDL, session import, Yandex request, review persistence or alert delivery.
Business OS and production are outside scope and untouched.

Read-only DEV preflight at 12:08:33 UTC: private session rows=0; external review rows=0;
`review-provider-due-check-hourly` active=false; exact synthetic company/location exists.
Final read-only recheck at 12:21:56 UTC: the same counts/state, unchanged.
Scope: company `13f3cb80-487a-4a19-96a1-fb3103200230`, location
`9a95f63b-18e6-447b-a449-8530b67ddbae`, Yandex org `54309413522`.

The owner now confirms setup and all checks PASS in the same open private PowerShell.
The agent has NOT obtained a service key; this is an operator-reported result, not an
env transfer or an independently repeated credential check. Historical setup notes below
describe the procedure. The next gate is manual session input, not another key setup.

## Setup prompt remediation — root cause and verification

The old script checked `PSVersionTable.PSVersion.Major < 7` **before** Read-Host, then
hid `POWERSHELL_7_REQUIRED` in its generic catch. An unsupported Windows PowerShell
5.1 therefore produced only `SETUP STOPPED` and three false env flags, with no prompt.
The same catch also hid live-approval/preconfigured-env guards and unavailable secure
input. The owner's actual failing host/version is **NOT VERIFIED**: the old output
discarded that evidence, so it is not proof of which pre-input condition was hit.
The confirmed code defect is loss of actionable pre-prompt diagnostics, not a missing
Supabase key being deliberately skipped by Read-Host.

Now every failure prints a fixed stage code and an actionable explanation, never an
exception/input. Windows PowerShell 5.1 gets `POWERSHELL_7_REQUIRED` before input;
noninteractive Read-Host failure gets `SECURE_INPUT_UNAVAILABLE`. Existing AES state,
live approval, missing Node, checker failure and failed env publication are distinct.
The version-5 branch is covered via a version-provider fixture, not claimed as a
successful native Windows PowerShell 5.1 execution.

Actual PowerShell **7.6.5** console/PTY verification reached:
`Review Activator DEV SUPABASE_SERVICE_ROLE_KEY (hidden):`
and was cancelled **before any input**. No key generation/RPC/import ran in that probe.
Redirected stdin is not a substitute for this console: the secure ConsoleHost input
path cannot be reliably exercised by piping a string. Automated success tests instead
inject a synthetic SecureString and mocked checker through the actual `& .ps1` entry.
They prove the exact seven output lines, same caller PID, retained env, later child
inheritance, no fixture/key in transcript/history, and rollback when publication fails
after its first successful env write. No genuine key or session is used in those tests.

## 1. Prepare a private operator console

Use a trusted local **PowerShell 7** window, outside Codex/agent-controlled terminals.
Start it with `pwsh -NoProfile` and keep it open. No transcripts, debug/command tracing,
screen sharing, recording, process dumps or clipboard history/sync/managers. If host
policy enforces input capture, STOP; do not weaken that policy to enter credentials.
Do not paste secret values into shell commands, chat, browser Console, screenshots,
online tools, documents or files. Do not launch a frontend build, browser or unrelated
program from this console: child processes can inherit its environment.

This is an **ephemeral, one-console DEV keyring**, not durable key management. Closing
the window, restarting it or the computer loses the AES key. Keep this same window
through the later separately approved import and smoke. If it closes after an import,
the encrypted session cannot be recovered with a newly generated key. STOP and arrange
an explicitly approved replacement/import; do not silently rotate, delete or reset it.
Long-lived storage/hourly sync needs a separately approved durable server secret store.

## 2. Find the dedicated DEV service key yourself

Open Supabase Dashboard and select **myasnoy-batya-review-dev**, verify project ref
`ykiubttldgyjpajmsuas`, then **Settings > API Keys**. Select the existing legacy
`service_role` key (not `anon`). Current `sb_secret_…` server keys are also supported
by the project's existing boundary and map to `service_role`; publishable keys and
ordinary authenticated-user tokens are NOT suitable. Do not rotate/create/revoke
Supabase keys for this procedure, and do not select Business OS or production.

Copy the key only when the hidden prompt below is waiting. Paste there, press Enter,
then clear the clipboard. Neither the agent nor the report needs its value.
The variable name remains `SUPABASE_SERVICE_ROLE_KEY` for either supported format.

Source: [Supabase API keys — location, roles and safe handling](https://supabase.com/docs/guides/getting-started/api-keys).
We deliberately do not follow the documentation's `.env` example: this task permits
process environment only. `.gitignore` was inspected and contains `.env*`, but **no
secret file is created or used**, ignored or otherwise; no User/Machine environment.

## 3. Run the setup in that same private PowerShell

These commands contain no secret:

```powershell
Set-Location -LiteralPath 'C:\Users\tasfo\BusinessOS\myasnoy-batya-review-dev'
& .\scripts\setup-yandex-dev-keys.ps1
```

Use `&` as shown: a `.ps1` invoked this way runs in a child **scope**, not a child
**process**. Process environment remains in the calling PowerShell after return.
Do **not** launch a separate `pwsh -File` or `powershell -File`, background job, or
Start-Process for setup. There is no auto-relaunch into another PowerShell. Keep this
window open for later import. [PowerShell process environment](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_environment_variables).

The script takes no key arguments. If the service key is absent, it always requests
native secure input after passing the explicit preflight gates. If only a service
key is already configured, it is reused without a prompt; no service key is generated.
Enter only the DEV service key into Read-Host's
SecureString prompt. It generates 32 cryptographically random bytes locally with
.NET RandomNumberGenerator, a new non-secret KID, and the existing v1 JSON map format
`kid -> base64(32 bytes)`. The matching KID goes into `YANDEX_SESSION_ACTIVE_KID`.
No generated value is printed, written to disk or sent to Supabase. The AES keyring
is passed only to the local server checker process and retained in this console
after success. Supabase receives the service credential only in the existing HTTPS
authentication headers, never in URLs or logs generated by this code.

The checker reuses **keyringFromEnv + createSessionStore + requestDevServiceRpc**.
It performs one request to the fixed DEV project's `review_yandex_session_store`,
action `read`, exact scope above, `p_expected_revision=null`, `p_data={}`. This is a
Supabase HTTP POST to an RPC whose selected SQL branch is SELECT-only, **not** a
Yandex POST or a DB mutation. It does not call enqueue/import/transition/alerts.
Redirects are forbidden, timeout=15s, no retries. Setup waits at most 25s.

After successful input/checks it prints exactly these seven lines, no JSON or values:

```text
SUPABASE_SERVICE_ROLE_KEY present = true
YANDEX_SESSION_KEYS_JSON present = true
YANDEX_SESSION_ACTIVE_KID present = true
keyring parse = PASS
active kid = PASS
service role connection = PASS
SETUP PASS
```

On failure it prints one fixed `SETUP STOPPED [CODE]` explanation, not this success
block, no raw exception/stdout/stderr, and no misleading all-false catch-all JSON.

On PASS, all three variables are present **in this PowerShell process**. They are not
available in Codex's process or another terminal. On failure, no new configuration
is retained. Existing AES configuration is never overwritten by another setup run.
An existing service key alone is preserved on failure. Publication restores the exact
previous state if any write/check fails; rollback is in finally to cover interruption.
If a session already exists, setup STOPS with `EXISTING_SESSION`: this prevents silently
adopting a fresh key for old ciphertext. A preflight failure is not proof that Supabase
is down. The Supabase boundary/RPC and permissions were not modified by this fix.

The child gets only essential OS variables and these three configuration variables;
NODE_OPTIONS, debug/TLS key logging, proxy env, live-read approval and alert credentials
are not inherited. Stdout is reconstructed from allowlisted booleans/PASS/FAIL only;
stderr and exceptions are not forwarded. Native buffers/BSTR are cleared on exit.
Immutable .NET/JS strings cannot be reliably wiped: no protection is claimed against
malicious same-user processes, host memory capture, OS paging or crash dumps.

## 4. STOP — confirm keys before session import

After `SETUP PASS`, keep the window open. Tell the agent only **“Ключи настроены,
все проверки PASS”**, or the safe FAIL fields. Do not attach the full console,
environment, clipboard, keys or screenshots. No session is imported by setup.
Do not run health/probe/dry-run or set `YANDEX_LIVE_READ_APPROVAL` at this stage.

## 5. Later manual hidden session import — not authorized by this setup step

Only after the separate keys-configured confirmation:

1. In the already authorized `myasnoibatya-zakaz` browser, inspect existing cookies
   locally via DevTools Application > Storage > Cookies. No login automation, page
   reload, HAR export, Copy-as-cURL, browser Console or password input.
2. Follow the [exact cookie scope/shape and hidden import block](YANDEX_LIVE_READ_SMOKE_01.md#manual-import-instruction--trusted-operator-only).
   Use only the documented eligible cookie metadata; do not guess names, bypass
   compatibility failures, include CSRF, or save a plaintext JSON file. If preparing
   JSON input is impractical, stop for a field-by-field helper.
3. In the **same still-open private PowerShell**, run `scripts/import-yandex-session.ps1`
   as documented there. Its hidden input supports long/multiline JSON, Ctrl+D to submit,
   Ctrl+C to cancel; Enter does not submit. It passes
   session JSON through redirected stdin to the existing `scripts/yandex-session.mjs
   import`, with fixed Asbest scope and `expectedRevision=0`, never through argv/history.
   Paste the session only at its hidden prompt, never into this conversation.
4. The existing importer encrypts with AES-256-GCM before atomic DB persistence.
   It does not read Yandex. Only safe state/revision is displayed; `SESSION_CHANGED`
   or any failure stops without retry/overwrite.
5. Clear transient clipboard contents. Report only successful import and the actual
   state: **NOT_CONFIGURED, revision 1**, not READY. Authentication is unverified until
   a later approved GET. Keep the console/keyring for that step. Scheduler stays PAUSED,
   real-review persistence OFF; no alerts or writes to Yandex.

## Verification

Offline tests cover hidden input, generated key shape, v1 parser compatibility,
process-only publication, preserving existing keys, rollback, existing-session guard,
scoped read-only RPC, anon/user/wrong-project rejection, malformed responses, network
error handling, sanitized child environment and safe output. No live service key or session fixture is used.
Run `npm test`, `npm run check`, `git diff --check` in a separate secret-free terminal.
No schema/grants/indexes/client/provider runtime changes. Supabase least-privilege
guidance led to reuse of the existing read RPC, with no extra public/admin boundary.

Initial checkpoint `a023ca2`: `npm test` **117/117 PASS** (101 existing + 16 setup checks, zero skipped);
`npm run check` **45 PASS**; both documented PowerShell blocks parse without execution.
`git diff --cached --check` PASS for all eight changed files; no JWT/AES key literals
found in the changed sources/docs. This scan is supplemental, not proof against all
possible secret formats; no real secret was supplied to the agent or tests.
The actual Node child launcher was tested with invalid configuration (zero RPC),
including multiple Node executables on PATH and removal of inherited NODE_OPTIONS.
No operational key generation/import or live service-role credential test was performed.

Prompt-remediation checkpoint: `npm test` **119/119 PASS**, zero skipped;
`npm run check` **45 PASS**, `git diff --cached --check` **PASS** for all six changed
files; supplemental JWT/AES key-literal scan found zero matches. Actual `&` entrypoint tests now cover caller/child env,
exact output and transcript/history filtering in addition to the fixture-based
version guard, preexisting service key, partial AES refusal, empty input, safe errors
and publication rollback. The real PS7 console prompt was observed without entering
any value; no live Supabase credential check, Yandex request or session import occurred.

An aborted redirected-input test left a 720-byte synthetic transcript in the OS temp
directory (outside Git); read-only inspection confirmed its supplied fixture input
was absent. Cleanup was blocked by the execution host. No actual secret was supplied
to that test and no AES key was generated before it was stopped. Completed transcript
tests remove their own exact temporary file/directory normally.
