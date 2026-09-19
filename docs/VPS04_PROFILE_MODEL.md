# VPS04 explicit profiles

`RA_RUNTIME_PROFILE` unset → existing `cloud-dev`; exact `cloud-dev` retains current project URL, public key, Auth callbacks, server claims.ref and Yandex AAD. Unknown/empty explicit profile is an error.

`vps-lab` requires `RA_RUNTIME_PROFILE=vps-lab` and `RA_VPS_PROFILE=vps-lab`, exact origin `http://127.0.0.1:13000`, issuer `http://127.0.0.1:13000/auth/v1`, and a verified public-only ES256 JWK + anon JWT. Vercel, Cloud credentials, provider secrets, DB passwords and Auth signing configuration are rejected in Node.

* `api/_supabase.js`: profile-specific target; LAB permits only existing read-only public sync-status RPC.
* `admin.html`: injected public LAB configuration is mandatory on LAB origin. Missing/mismatched config cannot fall through to Cloud. Cloud callback literals and behavior preserved. LAB does not perform initial-owner claim or email auth flows. Existing UI reused; browser UI acceptance was not claimed by HTTP-only tests.
* `lib/server/review-sync.js`: reject LAB before fixed Cloud RPC/claims.ref boundary, including injected reconciliation entrypoint.
* Yandex crypto/provenance: LAB disabled before session operations; existing Cloud AAD is byte-for-byte unchanged. AES keyring is not a JWT signer and was not used/copied.
* Runtime readiness: LAB-specific safe profile/dependency result, not misleading Vercel provenance.

LAB Node has no signing key, service-role JWT or database password. Only public anon JWT and public verification JWK are passed through its root-owned environment file. No fallback to Cloud when a dependency fails.

The existing foundation-only profile and all original untracked foundation source files remain byte-identical. New LAB entrypoint reuses its HTTP adapter; the original foundation entrypoint is unchanged.
