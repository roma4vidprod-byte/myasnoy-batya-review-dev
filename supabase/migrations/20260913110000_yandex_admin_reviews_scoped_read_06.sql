-- Scoped read-only admin reviews path for Asbest DEV.
-- No reply, matching, promo, scheduler or provider writes.
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
  id uuid,
  company_id uuid,
  location_id uuid,
  provider text,
  external_location_id text,
  location_name text,
  external_review_id text,
  author_name text,
  rating numeric,
  review_text text,
  published_at timestamptz,
  owner_reply_text text,
  owner_replied_at timestamptz,
  reply_state text,
  observed_at timestamptz,
  total_count bigint,
  unanswered_count bigint
)
language plpgsql
security definer
stable
set search_path to 'pg_catalog','public'
as $$
begin
  if not public.review_is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if p_company_id is null or p_location_id is null
     or p_external_location_id is distinct from '54309413522'
     or p_provider is distinct from 'yandex'
     or p_limit is null or p_limit < 1 or p_limit > 50
     or p_offset is null or p_offset < 0
     or (p_rating_min is not null and (p_rating_min < 1 or p_rating_min > 5))
     or (p_rating_max is not null and (p_rating_max < 1 or p_rating_max > 5))
     or (p_rating_min is not null and p_rating_max is not null and p_rating_min > p_rating_max) then
    raise exception 'REVIEW_SCOPE_INVALID';
  end if;
  if not exists (
    select 1 from public.review_locations
    where id=p_location_id and company_id=p_company_id
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

revoke all on function public.review_admin_reviews_scoped(uuid,uuid,text,text,integer,integer,boolean,integer,integer) from public,anon;
grant execute on function public.review_admin_reviews_scoped(uuid,uuid,text,text,integer,integer,boolean,integer,integer) to authenticated;
revoke all on function public.review_admin_reviews(text,integer,integer,boolean,integer) from public,anon,authenticated,service_role;
