# VPS09B — bounded outbound TCP/TLS diagnostic

UTC date: 2026-09-19 (2026-09-20 in the user's timezone at closeout).
Starting SHA: `652fed6ab1dbae3dd05fae9dccbe1d02c78927f7`; branch `codex/yandex-live-read-smoke-01`.

## Verdict

**B. HOSTING_EGRESS_INTERMITTENCY**, using the task's criterion: multiple clients and multiple destination IPs intermittently fail TCP connection establishment outside application execution. This identifies the VPS-to-Yandex network path, **not a proven defective device or responsible party**. The loss could be in hosting/upstream routing/filtering or the remote edge; HipHosting investigation is still required. It does not retrospectively recover the lost errno of the original VPS09 business attempt.

No network-policy correction was made. No permanent IP pinning, timeout increase, resolver change, global IPv6 disable, firewall/unit/SSH change or reboot. VPS09 persistence was not resumed.

## Target, method and budget

The actual approved `lib/server/yandex-session/transport.js` constructs the review read against **yandex.ru**. Only that hostname is used for diagnostic DNS and TLS identity/SNI. No business URL/query, cookies, authorization, session/key read or HTTP request is used by the probe graph.

One sequence ran 19:08:01–19:17:28 UTC: **566.590 seconds**, starts scheduled every10.5s,10000ms connection/handshake cap, hard600s budget.54 logical probes:30 explicit-IP TCP,18 explicit-IP TLS,6 hostname TLS for family comparison. No automatic repetition of the series or business retry. Node's default address-family fallback is observed explicitly; logical probe count is not claimed to equal TCP packet count.

All clients run as `review-yandex-reader`, cleared environment, outside worker/app sandbox. Node24.21.0; curl/libcurl8.5.0 with OpenSSL3.0.13; openssl3.0.13. No software installation.

The curl comparison uses the **same libcurl library via its documented CONNECT_ONLY=1 API**, not an ordinary curl GET/HEAD. This mode completes connection/TLS setup without a transfer. Proxy disabled, redirect following disabled, certificate and hostname verification enabled, fixed resolved IPv4 supplied through RESOLVE. Request-size, HTTP-status and application-data-byte counters all remain0. [Official libcurl contract](https://curl.se/libcurl/c/CURLOPT_CONNECT_ONLY.html).

OpenSSL uses s_client with explicit IP, original hostname SNI, verify_hostname and verify_return_error, empty stdin. Its raw certificate/handshake text is projected in memory to fixed fields and never saved. Node writes no application bytes.

## DNS

55/55 lookup samples PASS spread through the series. Every sample returns the same three IPv4 addresses and one IPv6 address; six IPv4 orderings observed. **Ordering rotation YES; address-set rotation NO.**

- IPv4:5.255.255.77,77.88.44.55,77.88.55.88.
- IPv6:2a02:6b8:a::a.
- getaddrinfo/NSS uses systemd-resolved stub127.0.0.53; configured upstreams8.8.8.8 and8.8.4.4. Individual sample upstream selection/cache hit is NOT_OBSERVED; no invented per-query resolver assertion.

Each safe timestamp, A/AAAA ordering and measured resolution duration is retained in `evidence/vps09b/VPS09B_NETWORK.json`.

## Explicit IPv4 matrix

TLS attempts include their TCP connection step; failures here all occurred before TCP connected.

| IPv4 | Plain TCP successes/attempts | Successful TCP latency | TLS successes/attempts | Successful TLS total latency |
| --- | ---: | --- | ---: | --- |
| 5.255.255.77 | 2/10 |30–46ms|2/6|62–73ms|
| 77.88.44.55 | 2/10 |25–43ms|2/6|57–117ms|
| 77.88.55.88 | 3/10 |25–37ms|0/6|not available|

Each IP received two TLS probes from each implementation, interleaved with the TCP rounds. Every IP has both successful and failed TCP establishment; there is no permanently bad-only IP evidenced by this sample.

| Client | All probes PASS/attempts | TLS-only PASS/attempts | Failures |
| --- | ---: | ---: | --- |
| Node |11/42|4/12 (fixed-IP0/6; hostname4/6)|31 TCP-connect deadlines|
| libcurl |3/6|3/6|3 CURLE_OPERATION_TIMEDOUT(28), connect time0|
| OpenSSL |1/6|1/6|5 external10s deadlines before TLS initialization|

Totals:**15 PASS /39 FAIL /54 attempts**. All39 failures are observed TCP-connect deadlines, not TLS certificate/handshake failures. No OS ETIMEDOUT is fabricated when a diagnostic deadline expired. All eight completed TLS handshakes validate the expected hostname and negotiate TLSv1.3; total latency57–120ms.

## Family selection

Default Node:2/3 PASS; IPv4-only:2/3 PASS. In the final default failure, IPv4 first timed out at250ms, IPv6 failed ENETUNREACH immediately, then remaining IPv4 attempts also failed to connect before the overall10s cap. The paired IPv4-only request also timed out. Thus unavailable IPv6 is real, but **forcing IPv4 is not proven corrective**. No family-selection patch was made.

## Routing, firewall, resources, MTU

All three `ip route get` results:ens3 → gateway141.98.87.1, source141.98.87.15, same reader uid994, no route MTU override. Interface MTU1500. IPv6 default route absent as in VPS09A. UFW active with incomingdeny/outgoingallow, OUTPUTACCEPT, empty user-output chain, no found outbound443 restriction/rate limit; established/related allowed.

109 boundary resource snapshots: maximum22 TCP sockets,7 TIME_WAIT, load1≤0.081; at least3361316KiB available memory. Reader FD soft/hard1024/1048576, ephemeral range32768–60999. Conntrack≤43/65536. No resource exhaustion evidence.

Independent90-second **passive SYN/RST-header-only** observation during existing probes:39 outgoing SYN packets (including retransmissions),4 incoming SYN-ACK, no extra network request. No raw packet or raw line file retained.90 resource samples: maximum1 SYN-SENT,23 total TCP sockets; tcpdump reports0 dropped capture packets. Exact per-IP counts and capture window19:10:24–19:11:54UTC are in evidence. These are packet counts, not a mathematically valid packet-loss percentage.

Active tracepath/PMTU probes NOT_RUN: tracepath is installed but unnecessary additional traffic was avoided. The reproduced failures precede TCP establishment/large TLS records; no evidence supports MTU tuning. tcp_mtu_probing remained0. Exact upstream failure location remains unproven.

## Safe telemetry deployment

After tests and series completion, the four already-tested VPS09A source files from commit652fed6 were installed at19:19:38UTC in `/opt/review-activator-yandex`. No new network fix. Existing business-facing YANDEX_NETWORK_ERROR retained, only allowlisted internal codes/stages added.

Installer verifies the original24-file manifest, exact three replaced byte hashes, absent new helper, exact package hash and syntax before mutation. Code-only rollback checkpoint:`/var/lib/review-activator-ops/vps09b-runtime-before`, root0700. Files root:review-yandex-reader0640. New manifest25/25 hashes match. No session/key/env/DB access by installer; no service restart or business invocation. The existing actual service/transport tests cover header vs body failure, safe nested causes, fail-closed writerNOT_RUN and redaction.

## Tests, security and preservation

Final Windows JavaScript:**187 PASS/0FAIL/0SKIP**. Linux:**187 PASS/0FAIL/0SKIP**. Python runner tests:**10 PASS/0FAIL/0SKIP** on each platform. Tests use synthetic material, fake sockets/libcurl, existing no-network hook and test-concurrency1. No general harness/full suite/Recovery09A investigation.

Initial `python` shell alias was absent; used the already-bundled Python executable, no installation. An earlier Linux summary filter selected no lines from the default reporter; exit0 was not treated as sufficient count evidence, so explicit TAP counters were obtained. No provider probe was repeated for these tooling issues.

`npm run check`:145PASS on final closeout rerun. Diff-check PASS; changed source/evidence secret-pattern scan found0 unexpected matches;26 original user-file hashes unchanged. `evidence/vps09b/VPS09B_CHECKS.json` records the gates. Scoped journal scan since19:07UTC:0 sensitive header/envelope/provider-field patterns. No credential-value scan claim: diagnostics never loaded credentials.

Postflight19:20:47UTC: all table hashes unchanged from the failed VPS09 snapshot; sessionREADY4, one scoped row, last_successful_sync_atnull; real reviews0, synthetic2, users3, sync runs0. healthz/readyz200/200, publicTCP SSH only, business timerdisabled/inactive. Original four systemd unit hashes unchanged. The failed sync receipt/attempt marker hashes are unchanged; no replay marker, no false monitor recovery.

## Effects and next step

Business Yandex GET0, cumulative13; Yandex writes0; real review INSERT/UPDATE/DELETE0/0/0; session mutations0; writerNOT_RUN.2GIS/email/Telegram/AI/promo/Cloud/Vercel/BusinessOS/Production0. Administrative source transfers, one safe-telemetry code installation and local diagnostic evidence writes are explicitly **not** claimed as zero filesystem changes. No support message sent, no restart/reboot, no scheduler activation.

Prepared:`HIPHOSTING_NETWORK_REQUEST_RU.txt`. Next step is HipHosting investigation of the outgoing TCP path/upstream/filtering using the UTC evidence. Do not automatically resume VPS09 persistence or perform a business GET.
