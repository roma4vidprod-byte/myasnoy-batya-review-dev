begin;
do $$
declare
  v_owner_count integer;
  v_target_count integer;
begin
  if current_database() <> 'review_activator_lab' then
    raise exception 'VPS11_DATABASE_INVALID';
  end if;
  select count(*) into v_owner_count
  from public.review_admins
  where email='owner@vps04.invalid' and role='owner' and active=true;
  if v_owner_count <> 1 then
    raise exception 'VPS11_OWNER_INVALID';
  end if;
  select count(*) into v_target_count
  from public.review_locations l
  where l.id='9a95f63b-18e6-447b-a449-8530b67ddbae'
    and l.company_id='13f3cb80-487a-4a19-96a1-fb3103200230';
  if v_target_count <> 1 then
    raise exception 'VPS11_SCOPE_INVALID';
  end if;
end
$$;

insert into vps_lab_private.memberships(user_id,company_id)
select a.user_id,'13f3cb80-487a-4a19-96a1-fb3103200230'::uuid
from public.review_admins a
where a.email='owner@vps04.invalid' and a.role='owner' and a.active=true
on conflict (user_id,company_id) do nothing;
create or replace function public.review_admin_reviews_scoped(
  p_company_id uuid,
  p_location_id uuid,
  p_external_location_id text,
  p_provider text default 'yandex',
  p_rating_min integer default null,
  p_rating_max integer default null,
  p_unanswered_only boolean default false,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  id uuid, company_id uuid, location_id uuid, provider text,
  external_location_id text, location_name text, external_review_id text,
  author_name text, rating numeric, review_text text,
  published_at timestamptz, owner_reply_text text,
  owner_replied_at timestamptz, reply_state text, observed_at timestamptz,
  total_count bigint, unanswered_count bigint
)
language plpgsql
security definer
stable
set search_path to 'pg_catalog','public'
as $$
begin
  if not public.review_is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if not vps_lab_private.has_company(p_company_id) then
    raise exception using errcode='42501',message='COMPANY_ACCESS_DENIED';
  end if;
  if p_company_id not in (
       '10000000-0000-4000-8000-000000000001'::uuid,
       '10000000-0000-4000-8000-000000000002'::uuid,
       '13f3cb80-487a-4a19-96a1-fb3103200230'::uuid)
     or p_location_id is null
     or p_provider is distinct from 'yandex'
     or p_external_location_id is distinct from (
       case p_company_id
         when '10000000-0000-4000-8000-000000000001'::uuid then 'lab-org-a'
         when '10000000-0000-4000-8000-000000000002'::uuid then 'lab-org-b'
         when '13f3cb80-487a-4a19-96a1-fb3103200230'::uuid then '54309413522'
       end)
     or (p_company_id='13f3cb80-487a-4a19-96a1-fb3103200230'::uuid
         and p_location_id is distinct from '9a95f63b-18e6-447b-a449-8530b67ddbae'::uuid)
     or p_limit is null or p_limit < 1 or p_limit > 50
     or p_offset is null or p_offset < 0
     or (p_rating_min is not null and (p_rating_min < 1 or p_rating_min > 5))
     or (p_rating_max is not null and (p_rating_max < 1 or p_rating_max > 5))
     or (p_rating_min is not null and p_rating_max is not null and p_rating_min > p_rating_max)
  then raise exception 'REVIEW_SCOPE_INVALID'; end if;

  if not exists (
    select 1 from public.review_locations as l_check
    where l_check.id=p_location_id and l_check.company_id=p_company_id
  ) then raise exception 'REVIEW_SCOPE_INVALID'; end if;
  return query
  select r.id,r.company_id,r.location_id,r.provider,r.external_location_id,
         l.name as location_name,r.external_review_id,r.author_name,r.rating,
         r.review_text,r.published_at,r.owner_reply_text,r.owner_replied_at,
         r.reply_state,r.observed_at,
         count(*) over () as total_count,
         count(*) filter (where r.owner_reply_text is null) over () as unanswered_count
  from public.review_external_reviews r
  left join public.review_locations l on l.id=r.location_id
  where r.company_id=p_company_id
    and r.location_id=p_location_id
    and r.provider=p_provider
    and r.external_location_id=p_external_location_id
    and (p_rating_min is null or r.rating>=p_rating_min)
    and (p_rating_max is null or r.rating<=p_rating_max)
    and (not coalesce(p_unanswered_only,false) or r.owner_reply_text is null)
  order by coalesce(r.published_at,r.observed_at) desc,r.id desc
  limit p_limit offset p_offset;
end;
$$;

revoke all on function public.review_admin_reviews_scoped(uuid,uuid,text,text,integer,integer,boolean,integer,integer)
from public,anon,service_role;
grant execute on function public.review_admin_reviews_scoped(uuid,uuid,text,text,integer,integer,boolean,integer,integer)
to authenticated;
commit;
