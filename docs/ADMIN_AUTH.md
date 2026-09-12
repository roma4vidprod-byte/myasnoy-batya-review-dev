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

For the current DEV local smoke, the Supabase DEV project must use the exact
HTTP local callback configuration:

- Site URL: `http://127.0.0.1:4173`;
- Redirect URL: `http://127.0.0.1:4173/admin.html`;
- Redirect URL: `http://127.0.0.1:4173/admin.html?recovery=1`.

The frontend only accepts this exact local origin. It rejects other origins,
including `javascript:` URLs and arbitrary external redirect targets. It uses
`/admin.html` for the local static server and does not create self-signed HTTPS.

If the deployed DEV preview is enabled later, add only these exact redirect
URLs to the same DEV project after verifying the deployment:

- Redirect URL: `https://myasnoy-batya-review-dev.vercel.app/admin`;
- Redirect URL: `https://myasnoy-batya-review-dev.vercel.app/admin?recovery=1`.

The current local smoke does not use the deployed preview and does not change
its URL configuration. Do not replace the local DEV Site URL with a deployed
URL, and do not change any Business OS or production project.

Supabase JS processes the callback fragment/query after session establishment;
the page then calls `history.replaceState` to remove token-bearing URL state.
Tokens are never logged or rendered. Recovery keeps only `?recovery=1` until
the new password is saved, then the query is removed.

## Security rules

- Never store user passwords in Review Activator tables.
- Password hashes and recovery mechanisms are owned by Supabase Auth.
- `review_admins` is an application allowlist/role table only.
- Public QR flow remains anonymous and separate from admin authentication.
- External review reply mutations require an authenticated admin and explicit publish action.
- AI may create drafts only; it does not publish replies automatically.
