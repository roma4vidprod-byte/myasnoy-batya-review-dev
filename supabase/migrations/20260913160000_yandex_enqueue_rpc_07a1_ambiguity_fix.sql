-- Yandex enqueue RPC 07A.1. Review Activator DEV only.
-- Fixes PL/pgSQL variable/column name resolution without changing the queue contract.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.review_enqueue_due_syncs(p_company_id uuid)
returns integer language plpgsql security invoker set search_path = ''
as $$
declare
  v_connection record;
  v_queued integer := 0;
  v_run_status text;
  v_location_id uuid;
  v_session_ready boolean;
begin
  if p_company_id is null then
    raise exception using errcode = '22023', message = 'SYNC_COMPANY_REQUIRED';
  end if;

  for v_connection in
    select pc.*
    from public.review_provider_connections as pc
    where pc.company_id = p_company_id
      and pc.enabled = true
      and pc.status <> 'PAUSED'
      and pc.next_sync_at <= now()
    for update of pc skip locked
  loop
    v_location_id := null;
    v_session_ready := false;

    if v_connection.provider = 'yandex'
       and v_connection.config->>'external_org_id' = '54309413522'
       and v_connection.config->>'location_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_location_id := (v_connection.config->>'location_id')::uuid;
      select exists(
        select 1
        from review_private.yandex_sessions as ys
        where ys.company_id = v_connection.company_id
          and ys.location_id = v_location_id
          and ys.external_org_id = '54309413522'
          and ys.state = 'READY'
      ) into v_session_ready;
    end if;

    v_run_status := case
      when v_connection.provider = 'yandex'
       and v_session_ready
       and (v_connection.status = 'READY' or (v_connection.status = 'ERROR' and v_connection.last_error in (
         'YANDEX_HTTP_401','YANDEX_HTTP_403','YANDEX_LOGIN_REDIRECT','YANDEX_LOGIN_HTML',
         'YANDEX_CHALLENGE','SESSION_COOKIE_INVALID'
       )))
      then 'QUEUED'
      else 'SKIPPED_NOT_CONFIGURED'
    end;

    insert into public.review_sync_runs(
      provider_connection_id, provider, status, requested_at, finished_at, error, meta
    ) values (
      v_connection.id,
      v_connection.provider,
      v_run_status,
      now(),
      case when v_run_status = 'SKIPPED_NOT_CONFIGURED' then now() else null end,
      case when v_run_status = 'SKIPPED_NOT_CONFIGURED' then 'Provider access is not configured yet' else null end,
      jsonb_build_object(
        'source', 'server-scheduler',
        'interval_minutes', v_connection.sync_interval_minutes,
        'company_id', v_connection.company_id,
        'location_id', v_location_id,
        'external_org_id', v_connection.config->>'external_org_id',
        'page_base', 1
      )
    );

    update public.review_provider_connections as pc
    set last_sync_requested_at = now(),
        status = case when v_run_status = 'QUEUED' then 'READY' else pc.status end,
        last_error = case when v_run_status = 'QUEUED' then null else pc.last_error end,
        next_sync_at = now() + make_interval(mins => v_connection.sync_interval_minutes),
        updated_at = now()
    where pc.id = v_connection.id
      and pc.company_id = p_company_id;

    v_queued := v_queued + case when v_run_status = 'QUEUED' then 1 else 0 end;
  end loop;

  return v_queued;
end;
$$;

revoke all on function public.review_enqueue_due_syncs(uuid) from public, anon, authenticated;
grant execute on function public.review_enqueue_due_syncs(uuid) to service_role, postgres;
notify pgrst, 'reload schema';
commit;
