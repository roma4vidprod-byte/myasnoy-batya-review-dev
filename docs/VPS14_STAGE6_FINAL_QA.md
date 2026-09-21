# VPS14 Stage 6 — Full Final QA

Date: 2026-09-21
Verdict: **QA COMPLETE — DEPLOYED WRITE-OFF RUNTIME PASS; STAGE 7 BLOCKED**
Yandex provider write: **0**
business-answer calls: **0**

## Scope

Stage 6 performed final QA only. It did not enable the writer, create a queue item,
start a provider write, alter approval state, or call the Yandex reply endpoint.

The deployed writer release remains:
`98e02ce40bc1bf6978b5b69f138e394b6ded557f`.

Current repository HEAD at QA time:
`083771931a5d4b31ebd3d8c5ba0205aeec55f09b`.

There is no runtime-source diff between those commits under `lib/`,
`tools/vps14/` or `package.json`; the later commit changes only documentation
and a test.
## Local final suite

All 68 tracked `test/*.test.mjs` files were executed with
`test/support/no-network.mjs` and concurrency 1.

- tests: **923**
- pass: **923**
- fail: **0**
- skipped: **0**
- cancelled: **0**
- duration: ~156.5 s
- source/config check: **176 PASS**
- `git diff --check`: PASS
- tracked working tree: clean

The historical unrelated untracked files were not included in the tracked suite.
An untracked partial scratch file `tools/vps14/writer-session-adapter.mjs` is not
committed, packaged or deployed and must not be treated as production source.

## Live VDSina acceptance

Manual peer-auth evidence:
`review-yandex-writer|review-yandex-writer|review_activator_lab`.

Database read-only postflight:
- reply actions: CANCELLED=1 only
- session: READY revision 6
- reply-state sync trigger: 1
- reviews: 74
- review hash: `1f7554e135f078e2711858d4b755eb3da5e46be632ce46d77dea2e297d80cbeb`
- actions: 1
- action hash: `6574de70b87681c0a2aaebb3b6a7ca2a40c5679239219c6fb1aad61146ec4637`
All three private writer RPCs exist. EXECUTE is true for
`review-yandex-writer` and false for anon, authenticated, service_role,
review-yandex-reader and review-yandex-import.

Live deployed manifest:
- status: MANIFEST_PASS
- files: 18
- writeEnabled: false

Effective unit:
- ActiveState=inactive
- SubState=dead
- UnitFileState=static
- Restart=no
- PrivateNetwork=yes
- RestrictAddressFamilies=AF_UNIX
- NoNewPrivileges=yes
- ProtectSystem=strict
- no timer
- no socket
- no drop-in
- environment remains RA_YANDEX_REPLY_WRITE_ENABLED=false

Health:
- public admin: HTTP 200
- /healthz: HTTP 200
- /readyz: HTTP 200

## Stage-7 blocker

The currently deployed CLI intentionally calls `runVpsReplyRuntime()` without a
production `getSession` adapter and without a production `resolveCsrf` adapter.
With WRITE=true it therefore fails closed before store construction / queue claim.
The systemd unit also keeps `/etc/review-activator-yandex` inaccessible and
has no systemd credential mapping for the existing session key. Therefore the
writer cannot yet decrypt the stored READY session.

The browser PRELOAD diagnostic proved the global CSRF value exists and is bound
to organization 54309413522, but no approved production browser-to-server
short-lived handoff is wired. PRELOAD presence evidence alone is not permission
or sufficient readiness for provider write.

Before Stage 7 can declare READY FOR FIRST APPROVED WRITE:
1. implement and test the protected writer session adapter;
2. expose the session key only through a bounded one-shot credential mechanism;
3. implement a single-use browser CSRF handoff with TTL and exact org/session/action binding;
4. repeat final no-provider-write acceptance on the updated deployed release.

Until those gates pass, the correct state is fail-closed and **not ready to write**.
