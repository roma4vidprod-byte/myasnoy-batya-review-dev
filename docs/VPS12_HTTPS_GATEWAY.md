# VPS12 — permanent HTTPS admin gateway

Date: 2026-09-20
Status: **DEPLOYED; PUBLIC HTTPS PASS; OPERATOR LOGIN RECHECK PENDING**

## Public endpoint

- technical hostname: `review-83-217-214-29.sslip.io`
- HTTPS admin: `https://review-83-217-214-29.sslip.io/admin.html`
- DNS resolves to VDSina `83.217.214.29`
- HTTP redirects to HTTPS
- TLS terminates in Caddy
- HSTS, no-sniff, no-referrer and frame denial headers are enabled

This is a stable technical hostname for the VPS12 gate. A branded domain can replace
it later without changing the internal Review Activator service boundary.

## Architecture

Caddy listens publicly on TCP 80/443 and reverse-proxies only to
`127.0.0.1:13010`. The VPS12 Node gateway listens only on loopback.
The existing VPS11 app remains unchanged on `127.0.0.1:13000`.

The gateway rewrites only the served LAB origin and approved operator email so the
existing admin UI can operate same-origin over HTTPS. Requests are then proxied to
the unchanged internal VPS11 boundary.
## Security boundary

The public gateway allowlist contains only:
- `GET /admin.html`
- `GET /healthz`, `GET /readyz`
- password/refresh token auth
- current-user read and password update
- logout
- `review_admin_profile`
- `review_admin_reviews_scoped`

Review reply draft/publish endpoints, initial-owner claim, arbitrary REST tables,
provider routes and every other path are denied by default with
`HTTPS_GATEWAY_READONLY`.

All non-GET requests require the exact public HTTPS Origin. Authorization headers are
syntax-checked. Browser cookies, apikey, Host and identity override headers are not
forwarded. The gateway systemd unit runs as an unprivileged dedicated user and is
restricted to localhost networking.

Yandex reply WRITE remains **0**. Provider/scheduler mutations are not introduced by
VPS12.

## Runtime acceptance

- Caddy: active + enabled
- gateway: active + enabled
- public `/admin.html`: HTTP 200
- public `/healthz`: HTTP 200
- HTTP -> HTTPS: 308
- gateway bind: `127.0.0.1:13010`
- existing app bind: `127.0.0.1:13000`
- PostgreSQL/PostgREST/Auth remain loopback-only
- UFW public allowlist: SSH 22, HTTP 80, HTTPS 443
- Yandex hourly sync timer remains enabled
- backup and monitor timers remain enabled
- gateway unit has no Linux capabilities and no writable application path

## Rollback

If VPS12 must be removed:
1. stop and disable `caddy` and `review-https-gateway.service`
2. remove UFW allow rules for 80/tcp and 443/tcp
3. restore the pre-VPS12 Caddyfile backup under `/etc/caddy/`
4. leave `127.0.0.1:13000` and the VPS11 release untouched

No database migration, review-row mutation or Yandex write is required for rollback.

## Remaining gate

Perform one real operator browser login through the permanent HTTPS hostname and
confirm the same VPS11 UI contract already accepted on mobile:
72 total reviews, page 2 pagination, 1–3 / 4–5 rating filters and 12 unanswered.
