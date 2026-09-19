# VPS08 security evidence

No real cookies, plaintext session, encrypted envelope, ciphertext, IV/tag, key or provider response was read or stored in this stage. Only safe server metadata, source code and synthetic test material were used.

Infrastructure inspection used existing pinned-host, batch-mode reviewadmin SSH, with read-only PostgreSQL transactions and scoped metadata queries. No root application worker was started. Two SSH inspection invocations; no SSH/UFW/service/DB configuration edits.

The read-only DB audit did not return session material. Cloud session/catalog operations: 0. No Vercel credentials or Sensitive env were extracted. Agent process credential **presence booleans** were false; no user-process secrets were inspected.

New regression tests assert sanitized transport errors, no redirect/retry, response-size cap, diagnostic response without synthetic author/text/cookie/ID markers, and no injected writer/transition/notification calls. These are offline assertions, not a certification of all server logs.

Post-live journal review: NOT_RUN because no provider process was started. Existing journals were not exported or searched for personal data. Evidence does not claim a global clean-journal scan. Existing secret-pattern scan covers tracked files plus this task's new files; the original user untracked files are preserved by hash and not included in content scanning.

No runtime or session-store change means no new backup/off-host transfer. VPS07 encrypted Windows copy remains historical DR evidence. Business timer remains disabled; monitoring does not acquire a new provider polling capability. Reboot remains `BLOCKED_BY_OUT_OF_BAND_RECOVERY`.

## VPS08A update — 2026-09-19

Private role adapter is tested in disposable PG17 clusters only. No deployed role/grant, key, company/location, session, review or API privilege changed. Owner is NOLOGIN/NOSUPERUSER/NOBYPASSRLS; scope RLS applies. Reader/importer have no direct table or underlying RPC privilege. The private SECURITY DEFINER wrapper has an empty search_path, fixed scope, actual DB login checks and action-specific grants; it calls the original INVOKER CAS function. These choices follow the [PG17 function security rules](https://www.postgresql.org/docs/17/sql-createfunction.html).

Importer accepts only one memory-resident challenge response before CAS; nonce/TTL/revision failures do not retry. All temporary cluster values were synthetic. Real session artifacts = 0; no real importer output or post-import journal exists to scan. SQL payload logging is disabled/terse for the proposed private logins. Key loader requires root-owned 0640, single-link regular file with no symlink; real key provisioning/permissions remain NOT_RUN. No claim of deployed peer authentication acceptance is made.

Initial test orchestration failures were preserved separately: a stdin delivery process was stopped, an incorrect Node path prevented a launch, and an incomplete test archive caused four module-loader failures. Existing `/opt/node/bin/node` and the missing source dependencies resolved them. No provider call or LAB mutation occurred. The final native clusters were all removed.
