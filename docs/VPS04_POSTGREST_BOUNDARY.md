# VPS04 PostgREST boundary

`127.0.0.1:13001` only; PostgreSQL `review_activator_lab` on `127.0.0.1:5432`.
Authenticator `ra_lab_authenticator`: LOGIN, NOINHERIT, NOSUPERUSER, NOBYPASSRLS, NOCREATEDB, NOCREATEROLE. Memberships exactly `anon,authenticated,service_role` (verified). All API roles NOBYPASSRLS in this LAB, including service_role. These names are LAB platform equivalents, never Cloud credentials.

PostgREST config: exposed schema `public`; asymmetric ES256 public JWK set; audience `authenticated`; DB-config overrides disabled; pool 5; OpenAPI disabled. `public.vps_lab_check_claims` runs after JWT verification and role switch, enforcing exact issuer and role. Unknown signature/audience/expiry are refused by PostgREST itself.

Baseline broad grants are revoked in LAB. Allowed read RPCs: `review_public_sync_status` for anon/authenticated; `review_admin_profile`, `review_is_admin`, `review_admin_reviews_scoped` for authenticated; `vps_lab_readiness` for the three API roles. All require their underlying guards. Service-role readiness is explicitly allowed, admin and enqueue denied.

`review_external_reviews` exposes only explicit safe columns to authenticated users. A membership/admin RLS policy restricts company; `raw_payload` and table-wide SELECT remain denied. `review_private`, session encryption and recovery are not exposed. Application-level function bodies are reused; the scoped RPC adds LAB membership and synthetic external-location checks.

Node forwards only allowlisted paths/methods to fixed loopback origins with timeout and `redirect:error`. No wildcard proxy, CORS wildcard, forwarded identity headers, request-selected destination, API key or cookie passthrough. `x-user`/`x-role`/`x-company`/`x-jwt`/`x-supabase` inputs are refused. Authorization is forwarded unchanged for official verification.

RPC errors are projected to safe generic codes at Node. Auth success responses naturally carry synthetic access/refresh tokens to the requesting client; they are never printed in acceptance output or logs.
