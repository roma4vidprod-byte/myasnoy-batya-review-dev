-- Applied after unchanged application baseline/retained chain, never to Cloud.
begin;
create schema vps_lab_private;
revoke all on schema vps_lab_private from public;
create table vps_lab_private.version(version text primary key check(version='vps04-auth-api-v1'));
insert into vps_lab_private.version values('vps04-auth-api-v1');
create table vps_lab_private.memberships(user_id uuid references auth.users(id),company_id uuid references public.review_companies(id),primary key(user_id,company_id));
alter table vps_lab_private.version enable row level security;
alter table vps_lab_private.memberships enable row level security;
create function vps_lab_private.has_company(p_company uuid) returns boolean
language sql stable security definer set search_path=''
as $$ select exists(select 1 from vps_lab_private.memberships m join public.review_admins a on a.user_id=m.user_id and a.active where m.user_id=auth.uid() and m.company_id=p_company) $$;
revoke all on function vps_lab_private.has_company(uuid) from public;
grant usage on schema vps_lab_private to authenticated;
grant execute on function vps_lab_private.has_company(uuid) to authenticated;
-- Strip broad baseline grants. Only tested, read-only RPCs/columns are exposed.
revoke all on all functions in schema public from public,anon,authenticated,service_role;
revoke all on all tables in schema public from anon,authenticated,service_role;
revoke all on all sequences in schema public from anon,authenticated,service_role;
revoke all on schema review_private from public,anon,authenticated,service_role;
revoke all on all functions in schema review_private from public,anon,authenticated,service_role;
revoke all on all tables in schema review_private from public,anon,authenticated,service_role;
grant execute on function public.review_public_sync_status(text) to anon,authenticated;
grant execute on function public.review_admin_profile(),public.review_is_admin() to authenticated;
grant execute on function public.review_admin_reviews_scoped(uuid,uuid,text,text,integer,integer,boolean,integer,integer) to authenticated;
grant select(id,company_id,location_id,provider,external_location_id,external_review_id,author_name,rating,review_text,published_at,owner_reply_text,owner_replied_at,observed_at,reply_state) on public.review_external_reviews to authenticated;
create policy vps04_company_admin_read on public.review_external_reviews for select to authenticated using(vps_lab_private.has_company(company_id));
-- Server-issued role/audience verified by PostgREST before this pre-request hook.
create function public.vps_lab_check_claims() returns void language plpgsql stable security invoker set search_path='' as $$
declare c jsonb := coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb);
begin
  if current_user not in ('anon','authenticated','service_role') then raise sqlstate 'PT401' using message='LAB_ROLE_INVALID'; end if;
  if c='{}'::jsonb then
    if current_user <> 'anon' then raise sqlstate 'PT401' using message='LAB_JWT_REQUIRED'; end if;
    return;
  end if;
  if c->>'iss' is distinct from 'http://127.0.0.1:13000/auth/v1' then raise sqlstate 'PT401' using message='LAB_ISSUER_INVALID'; end if;
  if c->>'aud' is distinct from 'authenticated' then raise sqlstate 'PT401' using message='LAB_AUDIENCE_INVALID'; end if;
  if c->>'role' is distinct from current_user then raise sqlstate 'PT401' using message='LAB_ROLE_INVALID'; end if;
  if current_user='authenticated' and (c->>'sub' is null or auth.uid() is null) then raise sqlstate 'PT401' using message='LAB_SUBJECT_REQUIRED'; end if;
end $$;
revoke all on function public.vps_lab_check_claims() from public;
grant execute on function public.vps_lab_check_claims() to anon,authenticated,service_role;
create function public.vps_lab_readiness() returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('profile','vps-lab','version',(select version from vps_lab_private.version),
   'auth_schema',exists(select 1 from auth.schema_migrations),'database',current_database())
$$;
revoke all on function public.vps_lab_readiness() from public;
grant execute on function public.vps_lab_readiness() to anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
