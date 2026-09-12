# Yandex Business contract fixtures

These are synthetic, anonymized fixtures reconstructed from the owner-confirmed field
names and envelope, NOT captured real responses. No actual review, author or session
data is included. `author.user` is the confirmed string display name. `approved` is
the owner-confirmed moderation example; other enum values are not inferred.

**TYPE CONFIRMATION PENDING:** the actual JSON types/units of `time_created` and
`public_rating` were not supplied. ISO strings and numeric public_rating in these
fixtures are illustrative supported values, not claims about production Yandex types.
Tests also cover Unix seconds/milliseconds, numeric strings, explicit-offset ISO,
null times, and primitive public_rating values. Original validated source types are
retained in the allowlisted metadata. Unsupported/ambiguous dates fail explicitly.

Page-1/page-2 use limit=2 to keep fixtures small. The single/owner/empty cases use
limit=20. For duplicate-page-2, the test sets page-1 total=4 before requesting it.
Page requests default to 1/2; pageBase=0 is an explicit alternative, with mandatory
offset=0 on the first response. The actual page base still needs session-stage verification.

No CSRF, cookies, Authorization or session fields belong in these fixture files.
