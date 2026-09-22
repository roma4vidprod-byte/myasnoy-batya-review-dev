begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local search_path=pg_catalog,public;

do $$
begin
  if current_database() <> 'review_activator_lab'
     or current_user <> 'postgres'
     or not exists(select 1 from pg_roles where rolname='vps_yandex_owner')
     or to_regprocedure('public.review_yandex_session_store(uuid,uuid,text,text,bigint,jsonb)') is null
  then raise exception 'STAGE13_BROWSER_ACCESS_INSTALL_GUARD'; end if;
  if not exists(select 1 from pg_roles where rolname='review-yandex-browser') then
    create role "review-yandex-browser" login nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
end
$$;

grant connect on database review_activator_lab to "review-yandex-browser";
grant usage on schema vps_yandex_private to "review-yandex-browser";

create or replace function vps_yandex_private.browser_session_read()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_row jsonb;
begin
  if session_user <> 'review-yandex-browser' then
    raise exception 'BROWSER_ROLE_DENIED';
  end if;
  v_row:=public.review_yandex_session_store(
    '13f3cb80-487a-4a19-96a1-fb3103200230'::uuid,
    '9a95f63b-18e6-447b-a449-8530b67ddbae'::uuid,
    '54309413522','read',null,'{}'::jsonb
  );
  if v_row is null
     or v_row->>'state' is distinct from 'READY'
     or v_row->'envelope' is null
     or v_row->>'credential_version' is null
     or (v_row->>'revision')::bigint < 1
  then raise exception 'SESSION_NOT_READY'; end if;
  return v_row;
end
$$;

alter function vps_yandex_private.browser_session_read() owner to vps_yandex_owner;

revoke all on function vps_yandex_private.browser_session_read()
from public,anon,authenticated,service_role,"review-yandex-reader","review-yandex-import","review-yandex-writer";
grant execute on function vps_yandex_private.browser_session_read() to "review-yandex-browser";

revoke all on all tables in schema public,review_private,vps_yandex_private from "review-yandex-browser";
revoke execute on all functions in schema public,review_private from "review-yandex-browser";
revoke usage on schema review_private from "review-yandex-browser";

alter role "review-yandex-browser" set log_statement='none';
alter role "review-yandex-browser" set log_min_error_statement='panic';
alter role "review-yandex-browser" set log_min_duration_statement=-1;
alter role "review-yandex-browser" set log_parameter_max_length_on_error=0;
alter role "review-yandex-browser" set log_error_verbosity='terse';

commit;
