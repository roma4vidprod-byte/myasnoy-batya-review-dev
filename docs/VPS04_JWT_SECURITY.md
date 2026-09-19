# VPS04 JWT/Auth evidence

Official Auth 2.196.0 owns signup/login/session/refresh mechanics. Three synthetic users only: `owner@vps04.invalid`, `nonadmin@vps04.invalid`, `company-b@vps04.invalid`. Generated passwords are held in a root-only LAB fixture, not Git/evidence/argv. No real email or Cloud user copied.

New independent ES256 keypair generated on VPS; private key used only by Auth and root synthetic negative-test runner. Auth-required legacy secret is separately random, not a Cloud/Yandex key. PostgREST and Node receive public key only. Issuer `http://127.0.0.1:13000/auth/v1`; audience `authenticated`; user access-token lifetime 900 seconds. Synthetic public/service bootstrap tokens are limited to this issuer/keyset. Root-only files under `/etc/review-activator-lab` use directory 0700 and files 0600. Auth/API systemd environments are read by systemd, not by Node. Node read denial verified through its real Unix identity.

Direct and Node-path HTTP each: Auth **7/7 PASS**, JWT/API **8/8 PASS**, RLS **14/14 PASS**. Real password login (3 users), official refresh, verified get-user, wrong password and logout/revoked refresh tested. Expired token, wrong issuer/audience/role, altered signature, unrelated signing key denied. Service-role token has only deliberately granted API access.

No authorization from `user_metadata`, client headers or body claims. Membership is private DB state tied to verified `auth.uid()`. Auth users remain separate from `review_admins`; non-admin Auth login does not imply admin access. Access tokens remain valid until expiry after logout per normal JWT semantics; revoked refresh is tested, immediate access-token revocation is not claimed.

Auth external signup is disabled. OTP/reset/admin user creation paths are not exposed through Node. SMTP points to closed loopback sink port 19998, and systemd allows only localhost egress. No external mail sent. Auth/API service output is disabled to avoid raw request/token diagnostics; Node logs only route/method/status/duration. Test evidence contains fixed names/status, not request/response payloads or tokens.
