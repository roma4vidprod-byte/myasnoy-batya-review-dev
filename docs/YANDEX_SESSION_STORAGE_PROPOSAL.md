# Yandex Session Transport v1 — storage proposal

DEV only. Owner approved application after all tests/checks pass; final verification
and application evidence are recorded in [Session Transport v1](YANDEX_SESSION_TRANSPORT_V1.md).
Migration: [SQL](../supabase/migrations/20260912103803_yandex_session_transport_v1.sql).

One new private table: `review_private.yandex_sessions`.
Minimal groups: company/location/org composite key; credential_version + encrypted envelope;
revision for atomic compare-and-swap; state; separate last_session_check_at and
last_successful_sync_at; allowlisted last_error_code; incident_id + alert_claimed for
durable at-most-once alert attempts; updated_at. No password, CSRF, raw response or headers.
Composite location/company FK uses a redundant UNIQUE(id,company_id) on existing
review_locations. No review index or review data is changed.

RLS enabled + forced, no client policies. No PUBLIC/anon/authenticated schema/table/RPC
access. service_role alone gets private SELECT/INSERT/UPDATE and one SECURITY INVOKER
RPC. The private schema is not added to exposed schemas. Read RPC returns ciphertext
only to the trusted server; CLI/application outputs must project metadata, never envelope.
The same RPC's snapshot action reads only review identity/scope columns for collision
preflight across scopes; it has no public grants and never returns review bodies.
Envelope SQL CHECK rejects extra keys, JSON null fields and non-string ciphertext;
only the application can cryptographically validate ciphertext and its AAD.

Encryption: Node crypto AES-256-GCM, fresh random 96-bit IV, 128-bit authentication tag,
32-byte key from a server-only secret store/environment, NEVER from/stored in Supabase.
AAD binds DEV project, provider, company, location, org, technical account and
credential_version. Envelope stores only v/kid/iv/tag/ciphertext. DB/backup theft alone
does not decrypt; compromise of both application key and DB does. This is not KMS/HSM.

Replace flow: validate narrow cookie import in server memory -> encrypt before RPC ->
compare expected revision -> atomic replacement -> NOT_CONFIGURED until authorized
health check succeeds -> READY. Stale workers cannot overwrite the new version.
Key rotation uses a keyring with current kid + retained previous key; decrypt/re-encrypt
with a fresh credential_version/IV and CAS. Remove old key only after all rows rotated;
old encrypted backups require retention/crypto-shredding policy. Disable erases current
ciphertext and marks DISABLED; re-enable requires explicit import, not automatic login.

Failure incident is claimed atomically before using existing Telegram/Resend senders.
At most one send attempt per channel per incident (state change). A crash/ambiguous
delivery may lose an alert; never automatically retry Telegram and risk duplicate spam.
Explicit operator rearm/reimport is needed after fixing alert delivery configuration.

No real session/key is requested in chat. No live read, alerts, scheduler enablement,
credential import or review persistence is performed by merely applying this migration.
