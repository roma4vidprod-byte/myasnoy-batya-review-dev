-- Local-tested patch; remote application requires a separate DEV migration gate.
-- Keeps the same function signature, scope, writes and existing error allowlist.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $$ begin
  if to_regprocedure('public.review_fail_sync_run(uuid,uuid,text)') is null then
    raise exception 'SYNC_FAIL_BASELINE_MISSING';
  end if;
end $$;

create or replace function public.review_fail_sync_run(p_company_id uuid, p_run_id uuid, p_error_code text)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_run record;
begin
  if p_company_id is null or p_run_id is null or p_error_code is null or p_error_code not in (
    'YANDEX_HTTP_401','YANDEX_HTTP_403','YANDEX_LOGIN_REDIRECT','YANDEX_LOGIN_HTML','YANDEX_CHALLENGE',
    'SESSION_COOKIE_INVALID','YANDEX_MALFORMED_JSON','YANDEX_CONTRACT_DRIFT','YANDEX_PAGINATION_CHANGED',
    'YANDEX_PAGINATION_LIMIT_EXCEEDED','YANDEX_NETWORK_ERROR','YANDEX_HTTP_ERROR','YANDEX_RESPONSE_TOO_LARGE',
    'SESSION_DECRYPT_FAILED','PAGE_BASE_AMBIGUOUS','PAGE_BASE_MISMATCH','REVIEW_SCOPE_COLLISION',
    'REVIEW_WRITER_CONTRACT_DRIFT','SYNC_OPERATION_FAILED') then raise exception 'SYNC_ERROR_INVALID'; end if;
  select r.id, r.provider_connection_id into v_run
    from public.review_sync_runs r
    join public.review_provider_connections pc on pc.id=r.provider_connection_id
   where r.id=p_run_id and pc.company_id=p_company_id and pc.provider='yandex' and r.status='RUNNING'
   for update of r;
  if not found then raise exception 'SYNC_RUN_NOT_CLAIMED'; end if;
  update public.review_sync_runs set status='FAILED', finished_at=now(), error=p_error_code,
    meta=meta || jsonb_build_object('error_code',p_error_code) where id=p_run_id;
  update public.review_provider_connections set status='ERROR', last_error=p_error_code, updated_at=now()
   where id=v_run.provider_connection_id and company_id=p_company_id;
  return jsonb_build_object('status','FAILED','error_code',p_error_code);
end;
$$;

revoke all on function public.review_fail_sync_run(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.review_fail_sync_run(uuid,uuid,text) to service_role, postgres;
notify pgrst, 'reload schema';
commit;
