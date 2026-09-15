-- Metadata-only application schema fingerprint for VPS03.
-- Never selects application rows or Auth/session material.
with objects(line) as (
  select format('schema|%s|%s|%s', n.nspname, pg_get_userbyid(n.nspowner), coalesce(n.nspacl::text,''))
    from pg_namespace n where n.nspname in ('public','review_private')
  union all
  select format('table|%s.%s|%s|%s|%s|%s', n.nspname,c.relname,pg_get_userbyid(c.relowner),c.relkind,c.relrowsecurity,c.relforcerowsecurity)
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname in ('public','review_private') and c.relkind in ('r','p','v','m')
  union all
  select format('column|%s.%s|%s|%s|%s|%s|%s', table_schema,table_name,column_name,ordinal_position,data_type,is_nullable,coalesce(column_default,''))
    from information_schema.columns where table_schema in ('public','review_private')
  union all
  select format('constraint|%s.%s|%s|%s', n.nspname,c.relname,con.conname,pg_get_constraintdef(con.oid,true))
    from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace
   where n.nspname in ('public','review_private')
  union all
  select format('index|%s.%s|%s|%s', n.nspname,c.relname,i.relname,pg_get_indexdef(i.oid))
    from pg_index x join pg_class c on c.oid=x.indrelid join pg_class i on i.oid=x.indexrelid join pg_namespace n on n.oid=c.relnamespace
   where n.nspname in ('public','review_private')
  union all
  select format('function|%s.%s(%s)|%s|%s|%s|%s|%s', n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),pg_get_userbyid(p.proowner),p.prosecdef,p.provolatile,coalesce(array_to_string(p.proconfig,','),''),coalesce(p.proacl::text,''))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname in ('public','review_private') and p.prokind='f'
  union all
  select format('functiondef|%s.%s(%s)|%s', n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),pg_get_functiondef(p.oid))
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname in ('public','review_private') and p.prokind='f'
  union all
  select format('policy|%s.%s|%s|%s|%s|%s', n.nspname,c.relname,pol.polname,pol.polcmd,coalesce(pg_get_expr(pol.polqual,pol.polrelid),''),coalesce(pg_get_expr(pol.polwithcheck,pol.polrelid),''))
    from pg_policy pol join pg_class c on c.oid=pol.polrelid join pg_namespace n on n.oid=c.relnamespace
   where n.nspname in ('public','review_private')
  union all
  select format('trigger|%s.%s|%s|%s', n.nspname,c.relname,t.tgname,pg_get_triggerdef(t.oid))
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
   where not t.tgisinternal and n.nspname in ('public','review_private')
  union all
  select format('extension|%s|%s', extname,extversion) from pg_extension
)
select md5(string_agg(line,E'\n' order by line)) as fingerprint, count(*) as metadata_lines from objects;
