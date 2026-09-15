-- VPS03 native synthetic privilege/RLS assertions.  All row writes roll back.
begin;
do $$
begin
  if not exists (select 1 from pg_roles where rolname='ra_lab_owner') then create role ra_lab_owner nologin nosuperuser nobypassrls nocreatedb nocreaterole; end if;
  if not exists (select 1 from pg_roles where rolname='ra_lab_migrator') then create role ra_lab_migrator nologin nosuperuser nobypassrls nocreatedb nocreaterole; end if;
  if not exists (select 1 from pg_roles where rolname='ra_lab_runtime') then create role ra_lab_runtime nologin nosuperuser nobypassrls nocreatedb nocreaterole; end if;
end;
$$;
grant usage, create on schema public to ra_lab_migrator;
revoke all on schema review_private from ra_lab_runtime, ra_lab_migrator;

do $$
begin
  if (select rolsuper from pg_roles where rolname='ra_lab_runtime')
     or (select rolbypassrls from pg_roles where rolname='ra_lab_runtime')
     or (select rolcreaterole from pg_roles where rolname='ra_lab_runtime')
     or (select rolcreatedb from pg_roles where rolname='ra_lab_runtime') then
    raise exception 'RUNTIME_ROLE_TOO_POWERFUL';
  end if;
  if has_schema_privilege('ra_lab_runtime','public','CREATE')
     or has_schema_privilege('ra_lab_runtime','review_private','USAGE')
     or has_table_privilege('ra_lab_runtime','review_private.yandex_sessions','SELECT')
     or has_table_privilege('ra_lab_runtime','review_private.yandex_contract_recoveries','SELECT')
     or has_function_privilege('ra_lab_runtime','public.review_yandex_session_store(uuid,uuid,text,text,bigint,jsonb)','EXECUTE') then
    raise exception 'RUNTIME_PRIVILEGE_BOUNDARY_FAILED';
  end if;
  if not has_schema_privilege('ra_lab_migrator','public','CREATE')
     or has_schema_privilege('ra_lab_migrator','review_private','CREATE') then
    raise exception 'MIGRATOR_PRIVILEGE_BOUNDARY_FAILED';
  end if;
  if (select pg_get_userbyid(relowner) from pg_class where oid='review_private.yandex_sessions'::regclass) <> 'postgres' then
    raise exception 'PRIVATE_OWNER_UNEXPECTED';
  end if;
end;
$$;
select 'ROLE_SEPARATION=PASS';

do $$
begin
  if not (select relrowsecurity from pg_class where oid='review_private.yandex_sessions'::regclass)
     or not (select relforcerowsecurity from pg_class where oid='review_private.yandex_sessions'::regclass)
     or not (select relrowsecurity from pg_class where oid='public.review_companies'::regclass)
     or not (select relrowsecurity from pg_class where oid='public.review_external_reviews'::regclass) then
    raise exception 'RLS_CONFIGURATION_FAILED';
  end if;
end;
$$;
select 'RLS_CONFIGURATION=PASS';

-- Synthetic row is visible only inside this transaction and is rolled back.
insert into public.review_companies(id,slug,name) values (gen_random_uuid(),'synthetic-vps03','Synthetic VPS03');
set local role anon;
do $$
begin
  if (select count(*) from public.review_companies) <> 0 then raise exception 'ANON_RLS_LEAK'; end if;
end;
$$;
reset role;
select 'ANON_RLS_DENY=PASS';
rollback;

select 'PRIVATE_SCHEMA_RUNTIME_DENY=PASS' where not has_schema_privilege('ra_lab_runtime','review_private','USAGE');
select 'RECOVERY_HISTORY_RUNTIME_DENY=PASS' where not has_table_privilege('ra_lab_runtime','review_private.yandex_contract_recoveries','SELECT');
select 'SERVICE_ROLE_PLATFORM_BYPASS=' || case when (select rolbypassrls from pg_roles where rolname='service_role') then 'EXPECTED' else 'UNEXPECTED' end;
