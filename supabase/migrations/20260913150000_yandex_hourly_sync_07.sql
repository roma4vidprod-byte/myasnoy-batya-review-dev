-- Yandex hourly sync 07. Review Activator DEV only.
-- One existing queue, one server-only worker claim/complete boundary.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
begin
  if exists (select 1 from cron.job where jobname='review-provider-due-check-hourly' and active) then
    raise exception 'PAUSE_REVIEW_DEV_SCHEDULER_FIRST';
  end if;
end;
$$;

create or replace function public.review_enqueue_due_syncs(p_company_id uuid)
returns integer language plpgsql security invoker set search_path = ''
as $$
declare
  r record;
  queued integer := 0;
  run_status text;
  location_id uuid;
  session_ready boolean;
begin
  if p_company_id is null then
    raise exception using errcode = '22023', message = 'SYNC_COMPANY_REQUIRED';
  end if;
  for r in
    select * from public.review_provider_connections
    where company_id = p_company_id
      and enabled = true and status <> 'PAUSED' and next_sync_at <= now()
    for update skip locked
  loop
    location_id := null;
    session_ready := false;
    if r.provider = 'yandex'
       and r.config->>'external_org_id' = '54309413522'
       and r.config->>'location_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      location_id := (r.config->>'location_id')::uuid;
      select exists(
        select 1 from review_private.yandex_sessions s
        where s.company_id = r.company_id and s.location_id = location_id
          and s.external_org_id = '54309413522' and s.state = 'READY'
      ) into session_ready;
    end if;
    run_status := case when r.provider = 'yandex' and session_ready
       and (r.status = 'READY' or (r.status = 'ERROR' and r.last_error in
         ('YANDEX_HTTP_401','YANDEX_HTTP_403','YANDEX_LOGIN_REDIRECT','YANDEX_LOGIN_HTML','YANDEX_CHALLENGE','SESSION_COOKIE_INVALID')))
      then 'QUEUED' else 'SKIPPED_NOT_CONFIGURED' end;
    insert into public.review_sync_runs(
      provider_connection_id, provider, status, requested_at, finished_at, error, meta
    ) values (
      r.id, r.provider, run_status, now(),
      case when run_status = 'SKIPPED_NOT_CONFIGURED' then now() else null end,
      case when run_status = 'SKIPPED_NOT_CONFIGURED' then 'Provider access is not configured yet' else null end,
      jsonb_build_object('source','server-scheduler','interval_minutes',r.sync_interval_minutes,
        'company_id',r.company_id,'location_id',location_id,'external_org_id',r.config->>'external_org_id',
        'page_base',1)
    );
    update public.review_provider_connections
    set last_sync_requested_at = now(),
        status = case when run_status = 'QUEUED' then 'READY' else status end,
        last_error = case when run_status = 'QUEUED' then null else last_error end,
        next_sync_at = now() + make_interval(mins => r.sync_interval_minutes),
        updated_at = now()
    where id = r.id and company_id = p_company_id;
    queued := queued + case when run_status = 'QUEUED' then 1 else 0 end;
  end loop;
  return queued;
end;
$$;

create or replace function public.review_claim_next_sync_run(p_company_id uuid)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_run record;
begin
  if p_company_id is null then
    raise exception using errcode = '22023', message = 'SYNC_COMPANY_REQUIRED';
  end if;
  select r.id, r.provider_connection_id, r.provider, pc.company_id,
         pc.config->>'location_id' as location_id, pc.config->>'external_org_id' as external_org_id,
         pc.external_account_id
    into v_run
    from public.review_sync_runs r
    join public.review_provider_connections pc on pc.id = r.provider_connection_id
   where r.status = 'QUEUED' and pc.company_id = p_company_id
     and pc.provider = 'yandex'
   order by r.requested_at, r.id
   limit 1
   for update of r skip locked;
  if not found then return jsonb_build_object('claimed',false); end if;
  update public.review_sync_runs set status='RUNNING', started_at=now()
   where id=v_run.id;
  update public.review_provider_connections set last_sync_started_at=now(), updated_at=now()
   where id=v_run.provider_connection_id and company_id=p_company_id;
  return jsonb_build_object('claimed',true,'run_id',v_run.id,'provider_connection_id',v_run.provider_connection_id,
    'provider',v_run.provider,'company_id',v_run.company_id,
    'config',jsonb_build_object('location_id',v_run.location_id,'external_org_id',v_run.external_org_id),
    'external_account_id',v_run.external_account_id,'status','RUNNING');
end;
$$;

create or replace function public.review_complete_sync_run(p_company_id uuid, p_run_id uuid, p_result jsonb)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_run record;
  v_seen integer;
  v_inserted integer;
  v_updated integer;
  v_unchanged integer;
  v_pages integer;
begin
  if p_company_id is null or p_run_id is null or jsonb_typeof(p_result) is distinct from 'object'
     or (p_result - array['pages_fetched','fetched_count','inserted','updated','unchanged','seen']) <> '{}'::jsonb
     or jsonb_typeof(p_result->'pages_fetched') is distinct from 'number'
     or jsonb_typeof(p_result->'fetched_count') is distinct from 'number'
     or jsonb_typeof(p_result->'inserted') is distinct from 'number'
     or jsonb_typeof(p_result->'updated') is distinct from 'number'
     or jsonb_typeof(p_result->'unchanged') is distinct from 'number'
     or jsonb_typeof(p_result->'seen') is distinct from 'number' then
    raise exception 'SYNC_RESULT_INVALID';
  end if;
  v_seen := (p_result->>'seen')::integer; v_inserted := (p_result->>'inserted')::integer;
  v_updated := (p_result->>'updated')::integer; v_unchanged := (p_result->>'unchanged')::integer;
  v_pages := (p_result->>'pages_fetched')::integer;
  if v_seen is null or v_inserted is null or v_updated is null or v_unchanged is null or v_pages is null
     or v_seen < 0 or v_inserted < 0 or v_updated < 0 or v_unchanged < 0 or v_pages < 0
     or v_inserted + v_updated + v_unchanged <> v_seen then raise exception 'SYNC_RESULT_INVALID'; end if;
  select r.id, r.provider_connection_id into v_run
    from public.review_sync_runs r
    join public.review_provider_connections pc on pc.id=r.provider_connection_id
   where r.id=p_run_id and pc.company_id=p_company_id and pc.provider='yandex' and r.status='RUNNING'
   for update of r;
  if not found then raise exception 'SYNC_RUN_NOT_CLAIMED'; end if;
  update public.review_sync_runs set status='SUCCEEDED', finished_at=now(), fetched_count=v_seen,
    new_count=v_inserted, matched_count=v_unchanged, error=null, meta=meta || p_result where id=p_run_id;
  update public.review_provider_connections set status='READY', last_error=null,
    last_sync_completed_at=now(), last_success_at=now(), updated_at=now()
   where id=v_run.provider_connection_id and company_id=p_company_id;
  return jsonb_build_object('status','SUCCEEDED','seen',v_seen,'inserted',v_inserted,
    'updated',v_updated,'unchanged',v_unchanged,'pages_fetched',v_pages);
end;
$$;

create or replace function public.review_fail_sync_run(p_company_id uuid, p_run_id uuid, p_error_code text)
returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  v_run record;
begin
  if p_company_id is null or p_run_id is null or p_error_code not in (
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

revoke all on function public.review_enqueue_due_syncs(uuid) from public,anon,authenticated;
revoke all on function public.review_claim_next_sync_run(uuid) from public,anon,authenticated;
revoke all on function public.review_complete_sync_run(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.review_fail_sync_run(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.review_enqueue_due_syncs(uuid) to service_role,postgres;
grant execute on function public.review_claim_next_sync_run(uuid) to service_role,postgres;
grant execute on function public.review_complete_sync_run(uuid,uuid,jsonb) to service_role,postgres;
grant execute on function public.review_fail_sync_run(uuid,uuid,text) to service_role,postgres;
notify pgrst, 'reload schema';
commit;
