begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local search_path=pg_catalog,public;

do $$
begin
  if current_database() <> 'review_activator_lab'
     or current_user <> 'postgres'
     or not exists(select 1 from pg_roles where rolname='review-yandex-writer')
     or not exists(select 1 from pg_roles where rolname='vps_yandex_owner')
     or to_regprocedure(
       'public.review_yandex_session_store(uuid,uuid,text,text,bigint,jsonb)'
     ) is null
     or to_regprocedure(
       'vps_yandex_private.reply_worker_claim_next()'
     ) is null
  then raise exception 'VPS14_WRITER_ACCESS_INSTALL_GUARD'; end if;
end
$$;

create or replace function vps_yandex_private.reply_session_read()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_row jsonb;
begin
  if session_user <> 'review-yandex-writer' then
    raise exception 'REPLY_WRITER_ROLE_DENIED';
  end if;

  v_row:=public.review_yandex_session_store(
    '13f3cb80-487a-4a19-96a1-fb3103200230'::uuid,
    '9a95f63b-18e6-447b-a449-8530b67ddbae'::uuid,
    '54309413522',
    'read',
    null,
    '{}'::jsonb
  );

  if v_row is null then
    raise exception 'SESSION_NOT_READY';
  end if;
  if v_row->>'state' is distinct from 'READY'
     or v_row->'envelope' is null
     or v_row->>'credential_version' is null then
    raise exception 'SESSION_NOT_READY';
  end if;

  return v_row;
end
$$;

alter function vps_yandex_private.reply_session_read()
owner to vps_yandex_owner;

revoke all on function vps_yandex_private.reply_session_read()
from public,anon,authenticated,service_role,
     "review-yandex-reader","review-yandex-import";
grant execute on function vps_yandex_private.reply_session_read()
to "review-yandex-writer";

commit;
