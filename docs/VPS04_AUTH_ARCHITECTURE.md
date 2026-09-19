# VPS04 — synthetic minimal backend

Status: **AUTH_PLATFORM_PASS / APP_BACKEND_PASS / ACCEPTANCE_BLOCKED**.
Evidence date: 2026-09-19. No Cloud cutover or real provider acceptance.

Existing PostgreSQL 17.11 (`170011`) → official Supabase Auth 2.196.0 + PostgREST 14.17 → existing Review Activator HTTP adapter, explicit `vps-lab` profile. The existing `review-activator-foundation` service is extended by a reversible systemd drop-in; no second review/queue/writer engine exists.

Official Auth is distributed as the verified static executable and migrations extracted from `supabase/gotrue:v2.196.0`. No Docker daemon/container runtime is installed. Native PostgREST is from the official GitHub release. Exact upstream commits, immutable OCI digests and per-file SHA-256 are in `VPS04_COMPONENTS.json` on VPS and local evidence.

* Auth commit: `0204331ca41a5b49f076b6fa3dc6c0d20b996590`.
* Auth image index: `sha256:c0c25187a6b835e65a6f6e6c6b39d090e832d40e6de5186f2c038e0411944232`.
* Linux amd64 manifest: `sha256:7e813221b93fbf54b515036438550e483bfaf057b9db52fe9bc1ce91c47e817e`.
* PostgREST commit: `064e5fea7bde63b0424fab53a0109c6f6016e95c`.
* PostgREST release archive SHA-256: `d6e13926457487c99b77366d795dcfa32700554d08d418131d9a4ea3f6ca25e3`.
* Official self-host compose reference: Supabase commit `36749659e6494046411d7aaa9a1f2cd8b64b33b6` (uses these Auth/PostgREST versions). Current upstream gateway is Envoy; no outdated full Kong stack copied.
* Node already installed: 24.21.0, reused unchanged.

## Ownership

**AUTH_PLATFORM_OWNS:** real `auth.users`, identities, password hashes, sessions, refresh tokens, migrations and platform claim helpers. Official `auth migrate` ran against the previously empty LAB. All Auth tables are owned by `supabase_auth_admin` (verified), not the app role.

**APP_BASELINE_OWNS:** existing public Review Activator tables/functions/RLS. The accepted immutable baseline SHA-256 `71aa35c22cb2aa99a39491b22de8f0f56d390dd53d6165223a8c61f15126176c` is verified before selecting only its application section starting at `create table public.review_companies`. Compatibility `auth.users` and role stubs are NOT executed. Original file unchanged.

**APP_RETAINED_MIGRATIONS_OWN:** the unchanged retained chain through Recovery09. Recovery09 is migration-compatibility-only; Recovery09A is excluded. An empty, inaccessible `cron.job` compatibility table exists without pg_cron, jobs or timer. LAB policy lives outside `supabase/migrations` and cannot be accidentally included by a Cloud migration push.

Minimal platform adapter makes `auth.uid()`/`auth.jwt()` consume verified PostgREST `request.jwt.claims`; no trusted identity headers. LAB company membership guard augments the existing scoped admin RPC. No Cloud schema changes.

## Components deliberately absent

Separate API gateway (existing adapter has explicit routes), Realtime, Storage, Studio, Analytics, Edge Runtime, image proxy, Vector, Supavisor, pg_meta and Docker are unnecessary for the tested contracts. No custom identity provider: official Auth issues/verifies sessions and refreshes; PostgREST verifies JWTs.

## Reproduction and rollback boundary

Scripts in `tools/vps04` are explicit, staged, host/database guarded and fail if already initialized. They are **not** general idempotent migration tools; do not rerun bootstrap over an existing LAB. `fetch-official.py` verifies all distribution digests before extracting regular allowlisted files. `bootstrap.mjs auth` creates new server-local keys and official Auth schema; `schema-api.mjs` installs app schema/API boundary; `acceptance.mjs --seed` creates synthetic users and data. Only successful direct Auth/API/RLS reports allow `install-node.mjs` to switch the foundation service. Original foundation release/unit remains intact beneath `/etc/systemd/system/review-activator-foundation.service.d/vps04.conf`.

No production-ready claim. Backup/restore drill, monitoring, HTTPS/domain, renewal/rotation procedure, worker and provider acceptance remain future separately authorized work. LAB public anon token intentionally has a finite 30-day lifetime; expiry fails closed, not silent Cloud fallback.
