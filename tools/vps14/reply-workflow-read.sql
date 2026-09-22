begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create or replace function public.review_admin_reply_workflow_scoped(
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
  reply_action_id uuid, reply_action_text text, reply_action_source text,
  reply_action_status text, approval_fingerprint text,
  approval_expires_at timestamptz, idempotency_key uuid,
  approved_at timestamptz, reply_action_last_error text,
  reply_action_attempt_count integer, reply_action_sent_at timestamptz,
  reply_action_finished_at timestamptz, reply_action_updated_at timestamptz,
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
  if p_company_id is distinct from '13f3cb80-487a-4a19-96a1-fb3103200230'::uuid
     or p_location_id is distinct from '9a95f63b-18e6-447b-a449-8530b67ddbae'::uuid
     or p_external_location_id is distinct from '54309413522'
     or p_provider is distinct from 'yandex'
     or p_limit is null or p_limit < 1 or p_limit > 50
     or p_offset is null or p_offset < 0
     or (p_rating_min is not null and (p_rating_min < 1 or p_rating_min > 5))
     or (p_rating_max is not null and (p_rating_max < 1 or p_rating_max > 5))
     or (p_rating_min is not null and p_rating_max is not null and p_rating_min > p_rating_max)
  then raise exception 'REVIEW_SCOPE_INVALID'; end if;

  return query
  select r.id,r.company_id,r.location_id,r.provider,r.external_location_id,
         l.name,r.external_review_id,r.author_name,r.rating,r.review_text,
         r.published_at,r.owner_reply_text,r.owner_replied_at,r.reply_state,r.observed_at,
         a.id,a.reply_text,a.draft_source,a.status,a.approval_fingerprint,
         a.approval_expires_at,a.idempotency_key,a.approved_at,a.last_error,
         a.attempt_count,a.sent_at,a.finished_at,a.updated_at,
         count(*) over (),
         count(*) filter (where r.owner_reply_text is null) over ()
  from public.review_external_reviews r
  left join public.review_locations l on l.id=r.location_id
  left join lateral (
    select ra.id,ra.reply_text,ra.draft_source,ra.status,
           ra.approval_fingerprint,ra.approval_expires_at,ra.idempotency_key,
           ra.approved_at,ra.last_error,ra.attempt_count,ra.sent_at,
           ra.finished_at,ra.updated_at
    from public.review_reply_actions ra
    where ra.external_review_row_id=r.id
      and ra.status<>'CANCELLED'
    order by ra.updated_at desc,ra.created_at desc
    limit 1
  ) a on true
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

revoke all on function public.review_admin_reply_workflow_scoped(uuid,uuid,text,text,integer,integer,boolean,integer,integer)
from public,anon,service_role;
grant execute on function public.review_admin_reply_workflow_scoped(uuid,uuid,text,text,integer,integer,boolean,integer,integer)
to authenticated;

commit;
