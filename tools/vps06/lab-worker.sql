-- VPS LAB ONLY. Not a Supabase migration. Existing queue + RPCs, no second engine.
begin;
set local lock_timeout='5s';
set local statement_timeout='20s';
do $$ begin
  if current_database() <> 'review_activator_lab' or current_user <> 'postgres'
     or (select version from vps_lab_private.version) <> 'vps04-auth-api-v1'
     or current_setting('server_version_num')::int <> 170011
     or exists(select 1 from review_private.yandex_sessions)
     or exists(select 1 from public.review_provider_connections)
     or exists(select 1 from public.review_sync_runs)
     or exists(select 1 from cron.job)
     or exists(select 1 from pg_roles where rolname='review-activator') then
    raise exception 'VPS06_INSTALL_GUARD';
  end if;
end $$;
create role "review-activator" login nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
grant connect on database review_activator_lab to "review-activator";
grant usage on schema public, vps_lab_private to "review-activator";
grant select on vps_lab_private.version to "review-activator";
create policy vps06_version_read on vps_lab_private.version for select to "review-activator" using (true);
grant select, insert on public.review_sync_runs to "review-activator";
grant update(status,started_at,finished_at,fetched_count,new_count,matched_count,error,meta)
  on public.review_sync_runs to "review-activator";
grant select on public.review_provider_connections to "review-activator";
grant update(status,last_error,next_sync_at,last_sync_requested_at,last_sync_started_at,
  last_sync_completed_at,last_success_at,updated_at) on public.review_provider_connections to "review-activator";
create policy vps06_connection_scope on public.review_provider_connections to "review-activator"
using (id='62000000-0000-4000-8000-000000000006' and company_id='60000000-0000-4000-8000-000000000006'
  and provider='yandex' and external_account_id='vps06-synthetic'
  and config='{"mode":"synthetic-vps06","location_id":"61000000-0000-4000-8000-000000000006","external_org_id":"vps06-synthetic-org"}'::jsonb)
with check (id='62000000-0000-4000-8000-000000000006' and company_id='60000000-0000-4000-8000-000000000006'
  and provider='yandex' and external_account_id='vps06-synthetic'
  and config='{"mode":"synthetic-vps06","location_id":"61000000-0000-4000-8000-000000000006","external_org_id":"vps06-synthetic-org"}'::jsonb);
create policy vps06_run_scope on public.review_sync_runs to "review-activator"
using (provider='yandex' and provider_connection_id in (select id from public.review_provider_connections))
with check (provider='yandex' and provider_connection_id in (select id from public.review_provider_connections));

-- Replace ONLY LAB enqueue eligibility. Claim/complete/fail implementations remain unchanged.
-- Existing provider enum is retained for compatibility, never used to select network transport.
create or replace function public.review_enqueue_due_syncs(p_company_id uuid)
returns integer language plpgsql security invoker set search_path='' as $$
declare v_connection record; v_queued integer := 0;
begin
  if p_company_id is null or p_company_id <> '60000000-0000-4000-8000-000000000006'
     or current_database() <> 'review_activator_lab' or current_user <> 'review-activator' then
    raise exception using errcode='22023', message='VPS06_SCOPE_DENIED';
  end if;
  for v_connection in
    select pc.* from public.review_provider_connections pc
    where pc.company_id=p_company_id and pc.enabled and pc.status='READY'
      and pc.next_sync_at <= now() and pc.id='62000000-0000-4000-8000-000000000006'
      and pc.config='{"mode":"synthetic-vps06","location_id":"61000000-0000-4000-8000-000000000006","external_org_id":"vps06-synthetic-org"}'::jsonb
      and not exists(select 1 from public.review_sync_runs r
        where r.provider_connection_id=pc.id and r.status in ('QUEUED','RUNNING'))
    for update of pc skip locked
  loop
    insert into public.review_sync_runs(provider_connection_id,provider,status,meta)
    values(v_connection.id,v_connection.provider,'QUEUED',jsonb_build_object(
      'source','vps06-synthetic','company_id',p_company_id,
      'location_id','61000000-0000-4000-8000-000000000006','external_org_id','vps06-synthetic-org',
      'vps06',jsonb_build_object('operation','success','delay_ms',0)));
    update public.review_provider_connections pc set last_sync_requested_at=now(),
      next_sync_at=now()+make_interval(mins=>pc.sync_interval_minutes),updated_at=now()
      where pc.id=v_connection.id and pc.company_id=p_company_id;
    v_queued:=v_queued+1;
  end loop;
  return v_queued;
end $$;
revoke all on function public.review_enqueue_due_syncs(uuid) from public,anon,authenticated,service_role;
grant execute on function public.review_enqueue_due_syncs(uuid), public.review_claim_next_sync_run(uuid),
  public.review_complete_sync_run(uuid,uuid,jsonb),public.review_fail_sync_run(uuid,uuid,text) to "review-activator";
commit;
