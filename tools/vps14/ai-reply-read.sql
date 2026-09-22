begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create or replace function public.review_admin_review_for_ai_scoped(
  p_review_id uuid,
  p_company_id uuid,
  p_location_id uuid,
  p_external_location_id text,
  p_provider text default 'yandex'
)
returns table(
  id uuid, provider text, author_name text, rating numeric,
  review_text text, location_name text
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
  if p_company_id is distinct from '13f3cb80-487a-4a19-96a1-fb3103200230'::uuid
     or p_location_id is distinct from '9a95f63b-18e6-447b-a449-8530b67ddbae'::uuid
     or p_external_location_id is distinct from '54309413522'
     or p_provider is distinct from 'yandex'
     or p_review_id is null
  then raise exception 'REVIEW_SCOPE_INVALID'; end if;

  return query
  select r.id,r.provider,r.author_name,r.rating,r.review_text,l.name
  from public.review_external_reviews r
  left join public.review_locations l on l.id=r.location_id
  where r.id=p_review_id
    and r.company_id=p_company_id
    and r.location_id=p_location_id
    and r.provider=p_provider
    and r.external_location_id=p_external_location_id
    and r.owner_reply_text is null
  limit 1;
end;
$$;

revoke all on function public.review_admin_review_for_ai_scoped(uuid,uuid,uuid,text,text)
from public,anon,service_role;
grant execute on function public.review_admin_review_for_ai_scoped(uuid,uuid,uuid,text,text)
to authenticated;

commit;
