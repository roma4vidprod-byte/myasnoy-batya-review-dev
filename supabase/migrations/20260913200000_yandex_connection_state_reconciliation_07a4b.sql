-- Yandex connection state reconciliation 07A.4B. Review Activator DEV only.
-- Server-only, fixed Asbest scope. No queue/run creation and no transport call.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
begin
  if exists (
    select 1 from cron.job
    where jobname = 'review-provider-due-check-hourly' and active
  ) then
    raise exception 'PAUSE_REVIEW_DEV_SCHEDULER_FIRST';
  end if;
end;
$$;

create or replace function public.review_reconcile_yandex_connection(
  p_company_id uuid,
  p_location_id uuid,
  p_org_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_connection record;
  v_session_state text;
  v_changed boolean := false;
begin
  if p_company_id is distinct from '13f3cb80-487a-4a19-96a1-fb3103200230'::uuid
     or p_location_id is distinct from '9a95f63b-18e6-447b-a449-8530b67ddbae'::uuid
     or p_org_id is distinct from '54309413522' then
    raise exception using errcode = '22023', message = 'REVIEW_SCOPE_INVALID';
  end if;

  select pc.id, pc.status, pc.enabled, pc.last_error
    into v_connection
    from public.review_provider_connections as pc
   where pc.company_id = p_company_id
     and pc.provider = 'yandex'
     and pc.enabled = true
     and pc.config->>'location_id' = p_location_id::text
     and pc.config->>'external_org_id' = p_org_id
   for update;

  if not found then
    raise exception using errcode = '22023', message = 'REVIEW_CONNECTION_NOT_FOUND';
  end if;

  select ys.state
    into v_session_state
    from review_private.yandex_sessions as ys
   where ys.company_id = p_company_id
     and ys.location_id = p_location_id
     and ys.external_org_id = p_org_id;

  if not found or v_session_state <> 'READY' then
    raise exception using errcode = '22023', message = 'SESSION_NOT_READY';
  end if;

  if v_connection.status = 'ERROR'
     and v_connection.last_error = 'SESSION_DECRYPT_FAILED' then
    update public.review_provider_connections as pc
       set status = 'READY',
           last_error = null,
           updated_at = now()
     where pc.id = v_connection.id
       and pc.company_id = p_company_id
       and pc.provider = 'yandex'
       and pc.status = 'ERROR'
       and pc.last_error = 'SESSION_DECRYPT_FAILED';
    v_changed := found;
  elsif v_connection.status = 'READY' and v_connection.last_error is null then
    v_changed := false;
  else
    raise exception using errcode = '22023', message = 'RECONCILIATION_NOT_ALLOWED';
  end if;

  return jsonb_build_object(
    'ok', true,
    'changed', v_changed,
    'status', 'READY',
    'session_state', 'READY'
  );
end;
$$;

revoke all on function public.review_reconcile_yandex_connection(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.review_reconcile_yandex_connection(uuid, uuid, text)
  to service_role, postgres;
notify pgrst, 'reload schema';
commit;
