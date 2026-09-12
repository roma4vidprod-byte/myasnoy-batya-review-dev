-- Run ONLY on Review Activator DEV ykiubttldgyjpajmsuas after owner-approved migration.
-- No imports/credentials/review writes/cron calls. READ ONLY, rollback at end.
begin read only;
do $$
declare client_role text; statement text; denied boolean; n bigint;
begin
  foreach client_role in array array['anon','authenticated'] loop
    if has_schema_privilege(client_role,'review_private','USAGE')
       or has_table_privilege(client_role,'review_private.yandex_sessions','SELECT,INSERT,UPDATE,DELETE')
       or has_function_privilege(client_role,'public.review_yandex_session_store(uuid,uuid,text,text,bigint,jsonb)','EXECUTE') then
      raise exception 'CLIENT_SESSION_PRIVILEGE_UNSAFE';
    end if;
    execute format('set local role %I',client_role);
    foreach statement in array array[
      'select count(*) from review_private.yandex_sessions',
      'explain insert into review_private.yandex_sessions default values',
      'explain update review_private.yandex_sessions set state=''DISABLED''',
      'explain delete from review_private.yandex_sessions',
      'select public.review_yandex_session_store(null::uuid,null::uuid,''54309413522'',''read'')'
    ] loop
      denied:=false;
      begin execute statement;
      exception when insufficient_privilege then denied:=true;
      end;
      if not denied then raise exception 'CLIENT_SESSION_ACCESS_UNEXPECTED'; end if;
    end loop;
    execute 'reset role';
  end loop;
  if not has_schema_privilege('service_role','review_private','USAGE')
     or not has_table_privilege('service_role','review_private.yandex_sessions','SELECT')
     or not has_table_privilege('service_role','review_private.yandex_sessions','INSERT')
     or not has_table_privilege('service_role','review_private.yandex_sessions','UPDATE')
     or has_table_privilege('service_role','review_private.yandex_sessions','DELETE')
     or not has_function_privilege('service_role','public.review_yandex_session_store(uuid,uuid,text,text,bigint,jsonb)','EXECUTE') then
    raise exception 'SERVER_SESSION_PRIVILEGE_INCORRECT';
  end if;
  execute 'set local role service_role';
  select count(*) into n from review_private.yandex_sessions;
  if n <> 0 then raise exception 'SESSION_STORAGE_MUST_REMAIN_EMPTY'; end if;
  -- Enter the server-only RPC without asserting any unverified Asbest location mapping.
  denied:=false;
  begin perform public.review_yandex_session_store(null::uuid,null::uuid,'54309413522','read');
  exception when raise_exception then
    if sqlerrm='SESSION_SCOPE_INVALID' then denied:=true; else raise; end if;
  end;
  if not denied then raise exception 'SERVER_SCOPE_CHECK_MISSING'; end if;
  execute 'reset role';
  if exists(select 1 from cron.job where jobname='review-provider-due-check-hourly' and active) then
    raise exception 'SCHEDULER_MUST_REMAIN_PAUSED';
  end if;
end;
$$;
rollback;
select 'PASS: actual client denial, server access, zero stored sessions, paused scheduler' as verification;
