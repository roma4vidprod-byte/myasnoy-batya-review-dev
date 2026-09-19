-- VPS-only capability adapter. Never apply to Supabase/Cloud. Existing session
-- table and CAS RPC are reused without rewriting historical migrations.
begin;
set local lock_timeout='5s';
do $$ begin
  if current_database() not in ('review_activator_lab','vps08a_disposable') then
    raise exception 'VPS_DATABASE_REQUIRED';
  end if;
  if not exists(select 1 from vps_lab_private.version where version='vps04-auth-api-v1') then
    raise exception 'VPS_PROFILE_REQUIRED';
  end if;
end $$;
create role vps_yandex_owner nologin nosuperuser nobypassrls noinherit;
create role "review-yandex-reader" login nosuperuser nobypassrls noinherit;
create role "review-yandex-import" login nosuperuser nobypassrls noinherit;
do $$ begin
  execute format('grant connect on database %I to "review-yandex-reader","review-yandex-import"',current_database());
end $$;
create schema vps_yandex_private authorization vps_yandex_owner;
revoke all on schema vps_yandex_private from public;
grant usage on schema public,review_private to vps_yandex_owner;
grant select(id,company_id) on public.review_locations to vps_yandex_owner;
create policy vps08a_scope_lookup on public.review_locations for select to vps_yandex_owner
  using(id='9a95f63b-18e6-447b-a449-8530b67ddbae' and company_id='13f3cb80-487a-4a19-96a1-fb3103200230');
grant select,insert,update on review_private.yandex_sessions to vps_yandex_owner;
create policy vps08a_private_scope on review_private.yandex_sessions to vps_yandex_owner
  using(company_id='13f3cb80-487a-4a19-96a1-fb3103200230' and location_id='9a95f63b-18e6-447b-a449-8530b67ddbae' and external_org_id='54309413522')
  with check(company_id='13f3cb80-487a-4a19-96a1-fb3103200230' and location_id='9a95f63b-18e6-447b-a449-8530b67ddbae' and external_org_id='54309413522');
grant execute on function public.review_yandex_session_store(uuid,uuid,text,text,bigint,jsonb) to vps_yandex_owner;

create function vps_yandex_private.session_call(
  p_company_id uuid,p_location_id uuid,p_org_id text,p_action text,
  p_expected_revision bigint default null,p_data jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  -- session_user is the peer-authenticated DB login, not client JWT/SET ROLE.
  if session_user not in ('review-yandex-reader','review-yandex-import') then raise exception 'SESSION_ROLE_DENIED'; end if;
  if p_company_id is distinct from '13f3cb80-487a-4a19-96a1-fb3103200230'::uuid
    or p_location_id is distinct from '9a95f63b-18e6-447b-a449-8530b67ddbae'::uuid
    or p_org_id is distinct from '54309413522' then raise exception 'SESSION_SCOPE_INVALID'; end if;
  if p_action is null or p_data is null or jsonb_typeof(p_data)<>'object' then raise exception 'SESSION_INPUT_INVALID'; end if;
  if p_action='status' then
    result:=public.review_yandex_session_store(p_company_id,p_location_id,p_org_id,'read',null,'{}');
    return case when result is null then null else jsonb_build_object('state',result->'state','revision',result->'revision',
      'credential_version',result->'credential_version','kid',result->'envelope'->'kid',
      'last_session_check_at',result->'last_session_check_at','last_error_code',result->'last_error_code') end;
  end if;
  if session_user='review-yandex-import' then
    if p_action<>'replace' then raise exception 'SESSION_ROLE_DENIED'; end if;
  else
    if p_action not in ('read','transition') then raise exception 'SESSION_ROLE_DENIED'; end if;
    if p_action='transition' and (
      p_data->>'state' is null or p_data->>'state' not in ('READY','ERROR','REAUTH_REQUIRED')
      or p_data->'sync_ok' is distinct from 'false'::jsonb
      or not(p_data ?& array['state','auth_ok','sync_ok','error_code'])
    ) then raise exception 'SESSION_TRANSITION_INVALID'; end if;
  end if;
  return public.review_yandex_session_store(p_company_id,p_location_id,p_org_id,p_action,p_expected_revision,p_data);
end $$;
alter function vps_yandex_private.session_call(uuid,uuid,text,text,bigint,jsonb) owner to vps_yandex_owner;
revoke all on function vps_yandex_private.session_call(uuid,uuid,text,text,bigint,jsonb) from public;
grant usage on schema vps_yandex_private to "review-yandex-reader","review-yandex-import";
grant execute on function vps_yandex_private.session_call(uuid,uuid,text,text,bigint,jsonb) to "review-yandex-reader","review-yandex-import";
-- No direct table/RPC privileges for either login; no role memberships/Cloud JWT.
-- Prevent statement/parameter payloads reaching logs for these private logins.
alter role "review-yandex-reader" set log_statement='none';
alter role "review-yandex-reader" set log_min_error_statement='panic';
alter role "review-yandex-reader" set log_min_duration_statement=-1;
alter role "review-yandex-reader" set log_parameter_max_length_on_error=0;
alter role "review-yandex-reader" set log_error_verbosity='terse';
alter role "review-yandex-import" set log_statement='none';
alter role "review-yandex-import" set log_min_error_statement='panic';
alter role "review-yandex-import" set log_min_duration_statement=-1;
alter role "review-yandex-import" set log_parameter_max_length_on_error=0;
alter role "review-yandex-import" set log_error_verbosity='terse';
commit;
