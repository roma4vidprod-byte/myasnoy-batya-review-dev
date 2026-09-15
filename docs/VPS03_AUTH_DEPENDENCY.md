# VPS03 Auth dependency boundary

`DATABASE_SCHEMA_BOOTSTRAP = PASS` does not imply
`AUTH_PLATFORM_BOOTSTRAP = PASS`.

The canonical baseline creates only the minimum database-side compatibility
surface required to apply retained migrations on native PostgreSQL 17:

- `auth.users(id uuid primary key)` with no user rows;
- `auth.uid()` reading a controlled local claim setting;
- `auth.jwt()` returning a controlled local claims value;
- the existing `review_admins.user_id -> auth.users.id` relationship.

No Supabase Auth HTTP service, token issuer, password flow, magic-link flow,
admin user, or browser session is installed on VPS. RLS and admin guards are
therefore preserved, not removed, but full authenticated behavior is not
claimed.

The synthetic negative tests verify anonymous denial and private-role denial.
Any future Auth bootstrap requires a separately approved platform design; it is
outside VPS03 and must not be inferred from this schema gate.

Current classification: `AUTH_PLATFORM_BOOTSTRAP = NOT_REPRODUCED`;
`MINIMAL_BACKEND_READY = PARTIAL/BLOCKED` for authenticated operation.
