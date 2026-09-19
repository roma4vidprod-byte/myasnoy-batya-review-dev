# VPS09A — execution context and no-auth network diagnostic

2026-09-19. Starting commit `0e95c9586a5fa862ddc073c51e15c33cea43a95e`, branch `codex/yandex-live-read-smoke-01`.

**STATUS: STOPPED / HISTORICAL ROOT CAUSE NOT PROVEN.**
**Exactly one root-cause verdict: K. UNKNOWN.**

This does not mean no evidence was obtained. IPv4 TCP-connect intermittency is reproduced; IPv6 route absence is proven; systemd policy and both historical launches are established. But the original VPS09 error discarded its low-level cause. Current probes cannot prove whether that specific earlier attempt failed at DNS/connect/TLS/headers. Do not relabel a current symptom as the exact historical cause or infer provider-side responsibility.

## Historical execution-context comparison

| Property | Accepted VPS08 | Failed VPS09 |
| --- | --- | --- |
| Operation | `mutable-full` | `manual-first` |
| Launch UTC | 17:28:36.638783 | 18:06:13.878094 |
| Process user | review-yandex-reader | same |
| Wrapper | direct sudo + env -i | same, inside control.py |
| Node | /opt/node/bin/node,24.21.0 checkpoint | same binary path/version |
| Profile/mode | vps-lab/read-only-admin | same |
| CWD | /home/reviewadmin | same |
| Historical cgroup | user.slice/user-1001.slice/session-1186.scope | user.slice/user-1001.slice/session-1220.scope |
| Config | fixed root/service-owned VPS session key; no general env file | same |
| Network namespace inode | NOT_RECORDED historically | NOT_RECORDED historically |
| Transport source | SHA256373b7c5b5a7f02d67e4e69ee2e9b245c39a00e607f9498abca3192fba1f25942 | exactly same |
| Per-request AbortSignal | 10000ms | same |
| Full-read AbortSignal | 30000ms | same |

Launch facts come from an exact, time-bounded journal projection of the two known CLI commands. Raw messages/authentication data were not returned. Actual fresh direct-process probes have the host namespace, SSH-session cgroup, NoNewPrivs0. No historical namespace inode is invented.

No custom Agent/dispatcher, family override, proxy or CA override occurs in this graph. All inspected proxy flags, NODE_OPTIONS, NODE_EXTRA_CA_CERTS and SSL_CERT_FILE/DIR are absent. `env -i` in both historical commands explicitly supplies only PATH and the two profile/mode settings. The Node runtime is24.21.0, built-in Undici7.29.1, DNS orderverbatim, auto-family selectiontrue, family-attempt interval250ms.

Read-only inspection of that Node's built-in Undici source confirms connect default10000ms, headers/body defaults300000ms. The earlier request-level10s abort and full-read30s deadline remain unchanged and take precedence. The VPS09 parent CLI deadline55s and PostgreSQL timeout10s are not a shortened HTTP deadline. No timeout was increased.

## Effective service policies — not the failed invocation's context

`systemctl cat` and `show` establish:

- Main app: User/Group review-activator; IPAddressDeny any; loopback allow; AF_UNIX/INET/INET6; PrivateNetwork=no; ProtectSystem=strict, ProtectHome=yes, NoNewPrivileges=yes. EnvironmentFile `/etc/review-activator-lab/node.env`; only its path was returned.
- Synthetic worker: User/Group review-activator; IPAddressDeny any, no allow; **AF_UNIX only, PrivateNetwork=yes**; same filesystem/no-privilege protections. EnvironmentFile `/etc/review-activator-lab/worker.env`; no credentials loaded for diagnostics. Worker inactive, timer disabled.
- Monitor: loopback-only, AF_UNIX/INET/INET6/NETLINK; no private network. Backup: no IP network, AF_UNIX/NETLINK.
- No VPS09 service/wrapper unit exists: VPS09 was a direct administrative CLI process, not a descendant of these services. Thus their policies cannot be assigned to the historical failed process merely because they are installed.

One transient credential-free diagnostic oneshot copied the worker's network/sandbox settings. It returned DNS EAI_AGAIN in its separate namespace, as expected. It completed before the first effective-property snapshot; those empty post-collection values are **not** treated as effective policy. A second **metadata-only, no-network** oneshot held the same directives long enough for actual `systemctl show`; AF_UNIX, deny-any, PrivateNetwork=yes and all requested protections were verified. Both transient units were collected (`not-found`); original unit hashes remain equal. No timer or business worker was started.

## No-auth connectivity matrix

Only fixed `yandex.ru`, TCP443 and TLS with SNI/certificate validation. No HTTP bytes, cookies, Authorization, session store, provider parser, writer or queue.

| Context | DNS | Explicit IPv4 TCP | Explicit IPv4 TLS | IPv6 TCP/TLS | Default-family TLS |
| --- | --- | --- | --- | --- | --- |
| Root direct | PASS | 5s connect deadline | PASS88ms | ENETUNREACH | 5s connect deadline |
| review-activator direct | PASS | PASS23ms | 5s connect deadline | ENETUNREACH | 5s connect deadline |
| review-yandex-reader direct | PASS | 5s connect deadline | 5s connect deadline | ENETUNREACH | 5s connect deadline |
| Synthetic worker sandbox control | EAI_AGAIN | not reached | not reached | not reached | EAI_AGAIN |
| Reader final single trace,10s cap | resolved during connect | connected | PASS88ms | not selected | PASS |

Each initial family/protocol combination was attempted once. The final trace is a separately bounded default-family TLS test using the existing reader's10s cap, not a business request or retry loop. It selected IPv4 `77.88.55.88`, validated the certificate and sent no HTTP. DNS also returned77.88.44.55,5.255.255.77 and2a02:6b8:a::a. These are observations, not pinned configuration or a permanent allowlist of IPs.

The initial5s probe deadline is deliberately reported as an application diagnostic deadline, **not invented OS ETIMEDOUT** and not proof that a10s request would fail. The observed IPv6 errors are actual ENETUNREACH/connect. The real historical fetch's underlying error remains unavailable.

Host: IPv4 default route present; IPv6 default route absent; DNS8.8.8.8/8.8.4.4; NTP synchronized; CA bundle readable, Node default trust set121 certificates. UFW incomingdeny/outgoingallow, OUTPUT ACCEPT; no UID/GID-specific nft match found. This does not prove the absence of loss or upstream filtering. A successful TLS handshake is not persistence/auth/read-health acceptance.

## Safe diagnostic code, no network-policy fix

`network-diagnostic.js` projects only fixed categories/codes/syscall/phase and the fixed hostname. It does not read or return message, stack, URL, headers, cookies or arbitrary provider fields. Nested/aggregate causes are bounded; unknown codes stay unknown.

Local transport changes preserve `YANDEX_NETWORK_ERROR` while collecting safe internal diagnostics. Header-fetch and response-body failures remain distinct; a late body error does not report zero HTTP responses. Unknown abort phase is not fabricated as TCP. The existing manual service and private CLI expose only the safe projection. No timeout, resolver, dispatcher, hostname, TLS, HTTP method, redirect, pagination, persistence, session or state-machine rule was weakened.

**These application telemetry changes are LOCAL/TESTED, NOT INSTALLED in the running private Yandex release.** The separate five-file no-auth diagnostic was installed under `/opt/review-activator-diagnostics/vps09a`; it contains no credentials and is not scheduled. Linux tests use an isolated `/tmp/vps09a-offline-20260919` source copy. Existing24-file runtime hashes still match the VPS09 release. No speculative network fix/deployment was applied for an UNKNOWN historical cause.

## Gates, security and final state

Windows178PASS/0FAIL/0SKIP and Linux178PASS/0FAIL/0SKIP. Includes19 new classifier/socket tests and2 service regressions for safe nested cause and response-body failure, plus existing transport/profile/mutable pagination/full diagnostic/persistence fail-closed tests. All provider responses synthetic, no-network hook enabled, test-concurrency1.

`npm run check`:144PASS. Diff/secret scan and original26-file hash preservation recorded at closeout. General harness/full suite/historical Recovery09A cases NOT_RUN.

Scoped journal scan since18:20:55UTC:0credential-header/provider-content/envelope-field pattern matches. Exact credential-value scan intentionallyNOT_RUN because no credentials were loaded by this diagnostic. No global historical-log claim.

Postflight18:40:34UTC: all LAB table hashes still match VPS09; sessionREADY4, last_successful_sync_atnull, real reviews0, synthetic2, users3, queue/runs0, healthz/readyz200/200, publicSSH only. Business timer disabled/inactive. No session transition/import or key changes. Existing failed monitor receipt remainsFAIL; no successful provider-read/persistence timestamp is fabricated.

Business GET0; cumulative remains13. Diagnostic socket probes17:6 TCP,11 TLS (including failure before handshake); explicit DNS lookup calls4 plus ordinary hostname resolution inside TLS. No application retry loop. Provider mutation methods0. DB review/session writes0; writerNOT_RUN. No Cloud/Vercel/Production/BusinessOS/2GIS/email/Telegram/AI/promo actions.

**One conditional page1 GET NOT_RUN:** the task requires proven AND fixed cause first. Intermittent success alone does not satisfy that gate. Do not resume VPS09, delete its durable attempt marker, clear monitoring, weaken sandbox, pin provider IPs or globally disable IPv6.

Next safe step: upstream/VPS network-path investigation with these safe timestamps/destinations, or a separately bounded diagnostic capturing the actual fetch cause after explicit authorization. No support message was sent. No real sync is authorized by this report.

Evidence: `evidence/vps09a/VPS09A_CONTEXT.json`, `VPS09A_NETWORK.json`, `VPS09A_POSTFLIGHT.json`.

Follow-up VPS09B completed a separately authorized bounded no-HTTP reliability series and installed this safe telemetry. See `VPS09B_OUTBOUND_RELIABILITY.md`; this does not rewrite VPS09A's historical UNKNOWN verdict or authorize VPS09 persistence replay.
