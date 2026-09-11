# Review Activator — Admin Auth

Status: DEV foundation.

## Allowed first owner

Initial owner email: `Myasnoibatya@yandex.ru`.

An Auth session alone is not enough. Administrative access requires an active row in `review_admins`.
The first owner may self-claim membership only after successful Supabase authentication and only when the JWT email matches the designated owner email.

## Supported login flows

1. Email + password via Supabase Auth.
2. Email sign-in link for first access / fallback.
3. Password recovery by email.

After the first email-based sign-in the owner can create a password from the account screen. The same screen allows changing the password later.

## Password recovery

`resetPasswordForEmail` sends a recovery email. The link returns to `/admin?recovery=1`; after the recovery session is established, the user sets a new password with `updateUser({ password })`.

## Required Supabase Auth URL configuration

Before email links are considered production-ready, Supabase Auth must allow the deployed Review Activator URL:

- Site URL: `https://myasnoy-batya-review-dev.vercel.app`
- Redirect URL: `https://myasnoy-batya-review-dev.vercel.app/admin`
- Redirect URL: `https://myasnoy-batya-review-dev.vercel.app/admin?recovery=1`

For future production, replace/add the final production domain and keep DEV separate.

## Security rules

- Never store user passwords in Review Activator tables.
- Password hashes and recovery mechanisms are owned by Supabase Auth.
- `review_admins` is an application allowlist/role table only.
- Public QR flow remains anonymous and separate from admin authentication.
- External review reply mutations require an authenticated admin and explicit publish action.
- AI may create drafts only; it does not publish replies automatically.
