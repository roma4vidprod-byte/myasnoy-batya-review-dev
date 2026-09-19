# VPS04 RLS through real HTTP

Native PostgreSQL 17.11, official PostgREST 14.17, real Auth-issued signed tokens. Not PGlite, mocked service.run or manually trusted SQL claim substitution.

14/14 PASS directly at PostgREST and 14/14 PASS through Node:

1. anon admin RPC denied;
2. authenticated non-admin denied;
3. owner reads exactly its synthetic company via existing scoped RPC;
4. cross-company RPC denied;
5. second-company admin isolated;
6. spoofed identity headers denied;
7. extra body identity/ref/issuer cannot override token;
8. direct table RLS returns own company only;
9. non-admin direct table returns no rows;
10. anon table read denied;
11. raw payload column denied;
12. admin table direct read denied;
13. private schema unavailable;
14. recovery endpoint unavailable/denied.

Only two synthetic review fixtures exist on this VPS, one per synthetic company. They do not represent Yandex data: no provider request/import occurred. Synthetic company IDs begin `10000000`, locations `20000000`; external IDs `lab-org-a/b`. Cloud Asbest's 67 reviews were neither read nor copied.

Acceptance evidence: `VPS04_RLS_HTTP_V2.json` and `VPS04_RLS_HTTP_NODE_V2.json`. Initial reports were preserved; their generic nonexistent recovery-route probe was not sufficient evidence for actual Recovery09 objects. V2 additionally addresses the actual `review_private.yandex_contract_recoveries` table and `recover_yandex_contract_connection` function via private profile headers; both are unavailable before execution. No recovery ran. Node passes only Authorization to fixed backend, never user-id/company claims from headers. `review_is_admin` alone is global in legacy Cloud model; LAB's additional private membership predicate closes that authorization gap without changing Cloud schema.
