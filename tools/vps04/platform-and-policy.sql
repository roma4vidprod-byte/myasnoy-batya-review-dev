-- VPS04 ONLY. Not a Cloud migration. Official Auth migrations run FIRST.
begin;
do $$ begin
  if current_database() <> 'review_activator_lab' or not exists (
    select 1 from information_schema.columns where table_schema='auth' and table_name='users' and column_name='encrypted_password'
  ) then raise exception 'OFFICIAL_LAB_AUTH_REQUIRED'; end if;
end $$;
-- Platform compatibility helpers: use verified PostgREST JSON claims, not headers.
-- Auth remains owner. No application table substitutes for auth.users.
create or replace function auth.uid() returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claims',true)::jsonb->>'sub','')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable
as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
alter function auth.uid() owner to supabase_auth_admin;
alter function auth.jwt() owner to supabase_auth_admin;
revoke all on auth.users from public,anon,authenticated,service_role;
grant references on auth.users to postgres;
grant usage on schema auth to anon,authenticated,service_role;
revoke all on function auth.uid(),auth.jwt() from public;
grant execute on function auth.uid(),auth.jwt() to anon,authenticated,service_role,postgres;
-- Empty migration compatibility only, no extension/job/timer.
create schema cron authorization supabase_admin;
create table cron.job(jobid bigint generated always as identity primary key,jobname text not null,active boolean not null);
alter table cron.job owner to supabase_admin;
alter table cron.job enable row level security;
revoke all on schema cron from public,anon,authenticated,service_role;
revoke all on cron.job from public,anon,authenticated,service_role;
grant usage on schema cron to postgres;
grant select on cron.job to postgres;
commit;
