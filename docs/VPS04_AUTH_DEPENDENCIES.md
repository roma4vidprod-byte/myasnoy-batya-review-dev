# VPS04 dependency inventory

Baseline: `1db4d3ea836c663278307d5b846b0ff484e578e9`. Cloud DEV is not a migration target.

| Source/dependency | Classification | LAB boundary |
|---|---|---|
| `auth.users`, password hash, identities, refresh/session tables | AUTH_REQUIRED | Official Auth owns schema and migrations, never baseline compatibility stub |
| `auth.uid()`, JWT claims | AUTH_REQUIRED | Verified PostgREST claims, `sub`; no trusted identity headers |
| `auth.role()` | NOT_REQUIRED_FOR_VPS | Application policies use database roles; no custom role-header trust |
| `anon`, `authenticated` | POSTGREST_REQUIRED | NOLOGIN, NOSUPERUSER, NOBYPASSRLS |
| `service_role` | POSTGREST_REQUIRED | Synthetic bootstrap only; no app access to signer/admin token |
| `postgres` | NOT_REQUIRED_FOR_VPS | Deployment/migration owner, never HTTP authenticator |
| `admin.html` supabase-js password login/refresh/session persistence | AUTH_REQUIRED | Official Auth; explicit public LAB config; Cloud defaults preserved |
| OTP/reset/email, owner claim | CLOUD_ONLY | LAB delivery/claim routes disabled; bootstrap synthetic owner by controlled SQL |
| `api/_supabase.js` REST RPC | POSTGREST_REQUIRED | Fixed profile target, no fallback |
| `api/health.js` | POSTGREST_REQUIRED | Existing Cloud metadata is not genuine readiness; LAB checks dependencies |
| `api/review-sync-status.js` | POSTGREST_REQUIRED | Existing read-only public RPC |
| `api/promo-stats.js` | POSTGREST_REQUIRED | Read-only; not enabled at this stage |
| `api/feedback.js`, `reward-request.js`, `promo-import.js` | CLOUD_ONLY | Mutations/delivery not enabled in LAB |
| `api/admin-review-reply-draft.js` | CLOUD_ONLY | Auth RPC plus paid AI; route closed |
| `api/cron/review-sync.js`, `api/internal/review-sync-worker.js` | CLOUD_ONLY | Entire provider/queue/writer boundary closed for LAB |
| `lib/server/review-sync.js` claims.ref and RPC root | CLOUD_ONLY | Guard LAB before credential parsing/network |
| Yandex crypto AAD/provenance | CLOUD_ONLY | Keep existing AAD unchanged, LAB cannot invoke session crypto |
| REST table reads | POSTGREST_REQUIRED | RLS verified via HTTP; private schemas never exposed |
| Direct PostgreSQL from Node | DIRECT_DB_POSSIBLE_BUT_NOT_CHOSEN | Reuse RPC contracts and JWT verification; no database password in Node |
| Realtime/Storage/Studio/Analytics/Edge/imgproxy/Vector/Supavisor/pg_meta | NOT_REQUIRED_FOR_VPS | Absent |

Issuer and audience are explicit and independent of Cloud. PostgREST validates the signature/audience/expiry; a database pre-request guard requires the LAB issuer and allowlisted role. Authorization uses database membership, never editable user metadata. Existing Cloud admin scoped RPC checks company/location relation but does not map an admin to a company; LAB requires an explicit membership guard before reusing it.

This inventory is an implementation boundary, not a claim of acceptance. Evidence/status is recorded separately.
