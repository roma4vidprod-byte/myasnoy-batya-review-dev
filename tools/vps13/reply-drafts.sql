begin;
do $$
declare
  v_location_count integer;
begin
  if current_database() <> 'review_activator_lab' then
    raise exception 'VPS13_DATABASE_INVALID';
  end if;
  if to_regclass('public.review_reply_actions') is null then
    raise exception 'VPS13_REPLY_ACTIONS_MISSING';
  end if;
  select count(*) into v_location_count
  from public.review_locations l
  where l.id='9a95f63b-18e6-447b-a449-8530b67ddbae'::uuid
    and l.company_id='13f3cb80-487a-4a19-96a1-fb3103200230'::uuid;
  if v_location_count <> 1 then raise exception 'VPS13_SCOPE_INVALID'; end if;
end
$$;

create or replace function public.review_admin_reviews_with_drafts_scoped(
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
  draft_action_id uuid, draft_reply_text text, draft_source text,
  draft_status text, draft_updated_at timestamptz,
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
         a.id,a.reply_text,a.draft_source,a.status,a.updated_at,
         count(*) over (),
         count(*) filter (where r.owner_reply_text is null) over ()
  from public.review_external_reviews r
  left join public.review_locations l on l.id=r.location_id
  left join lateral (
    select ra.id,ra.reply_text,ra.draft_source,ra.status,ra.updated_at
    from public.review_reply_actions ra
    where ra.external_review_row_id=r.id and ra.status='DRAFT'
    order by ra.updated_at desc,ra.created_at desc limit 1
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

create or replace function public.review_admin_save_reply_draft_scoped(
  p_external_review_row_id uuid,
  p_company_id uuid,
  p_location_id uuid,
  p_external_location_id text,
  p_provider text,
  p_reply_text text,
  p_draft_source text default 'human',
  p_ai_model text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_review public.review_external_reviews%rowtype;
  v_id uuid;
  v_text text := trim(coalesce(p_reply_text,''));
begin
  if not public.review_is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if not vps_lab_private.has_company(p_company_id) then
    raise exception using errcode='42501',message='COMPANY_ACCESS_DENIED';
  end if;
  if p_company_id is distinct from '13f3cb80-487a-4a19-96a1-fb3103200230'::uuid
     or p_location_id is distinct from '9a95f63b-18e6-447b-a449-8530b67ddbae'::uuid
     or p_external_location_id is distinct from '54309413522'
     or p_provider is distinct from 'yandex'
  then raise exception 'REVIEW_SCOPE_INVALID'; end if;
  if v_text='' then raise exception 'REPLY_TEXT_REQUIRED'; end if;
  if length(v_text)>5000 then raise exception 'REPLY_TEXT_TOO_LONG'; end if;
  if p_draft_source not in ('human','ai') then raise exception 'DRAFT_SOURCE_INVALID'; end if;

  select * into v_review
  from public.review_external_reviews r
  where r.id=p_external_review_row_id and r.company_id=p_company_id
    and r.location_id=p_location_id and r.provider=p_provider
    and r.external_location_id=p_external_location_id;
  if not found then raise exception 'REVIEW_NOT_FOUND'; end if;
  if v_review.owner_reply_text is not null then raise exception 'REVIEW_ALREADY_ANSWERED'; end if;
  insert into public.review_reply_actions(
    external_review_row_id,company_id,provider,external_review_id,
    reply_text,status,created_by,draft_source,ai_model,ai_generated_at
  )
  values(
    v_review.id,v_review.company_id,v_review.provider,v_review.external_review_id,
    v_text,'DRAFT',auth.uid()::text,p_draft_source,p_ai_model,
    case when p_draft_source='ai' then now() else null end
  )
  on conflict (external_review_row_id) where status in ('DRAFT','QUEUED','SENDING')
  do update set
    reply_text=excluded.reply_text,
    status='DRAFT',
    draft_source=excluded.draft_source,
    ai_model=excluded.ai_model,
    ai_generated_at=excluded.ai_generated_at,
    edited_after_ai=(public.review_reply_actions.draft_source='ai' and excluded.draft_source='human'),
    updated_at=now()
  where public.review_reply_actions.status='DRAFT'
  returning id into v_id;

  if v_id is null then raise exception 'DRAFT_LOCKED_BY_PUBLISH'; end if;
  update public.review_external_reviews
  set reply_state='DRAFT'
  where id=v_review.id and owner_reply_text is null;
  return v_id;
end;
$$;
create or replace function public.review_admin_discard_reply_draft_scoped(
  p_external_review_row_id uuid,
  p_company_id uuid,
  p_location_id uuid,
  p_external_location_id text,
  p_provider text
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog','public'
as $$
declare
  v_review public.review_external_reviews%rowtype;
  v_cancelled integer;
begin
  if not public.review_is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if not vps_lab_private.has_company(p_company_id) then
    raise exception using errcode='42501',message='COMPANY_ACCESS_DENIED';
  end if;
  if p_company_id is distinct from '13f3cb80-487a-4a19-96a1-fb3103200230'::uuid
     or p_location_id is distinct from '9a95f63b-18e6-447b-a449-8530b67ddbae'::uuid
     or p_external_location_id is distinct from '54309413522'
     or p_provider is distinct from 'yandex'
  then raise exception 'REVIEW_SCOPE_INVALID'; end if;

  select * into v_review
  from public.review_external_reviews r
  where r.id=p_external_review_row_id and r.company_id=p_company_id
    and r.location_id=p_location_id and r.provider=p_provider
    and r.external_location_id=p_external_location_id;
  if not found then raise exception 'REVIEW_NOT_FOUND'; end if;

  if exists (
    select 1 from public.review_reply_actions
    where external_review_row_id=v_review.id and status in ('QUEUED','SENDING')
  ) then raise exception 'DRAFT_LOCKED_BY_PUBLISH'; end if;

  update public.review_reply_actions
  set status='CANCELLED',updated_at=now()
  where external_review_row_id=v_review.id and status='DRAFT';
  get diagnostics v_cancelled = row_count;

  if v_cancelled>0 and v_review.owner_reply_text is null then
    update public.review_external_reviews set reply_state='NONE'
    where id=v_review.id and reply_state='DRAFT';
  end if;
  return v_cancelled>0;
end;
$$;

revoke all on function public.review_admin_reviews_with_drafts_scoped(uuid,uuid,text,text,integer,integer,boolean,integer,integer)
from public,anon,service_role;
grant execute on function public.review_admin_reviews_with_drafts_scoped(uuid,uuid,text,text,integer,integer,boolean,integer,integer)
to authenticated;

revoke all on function public.review_admin_save_reply_draft_scoped(uuid,uuid,uuid,text,text,text,text,text)
from public,anon,service_role;
grant execute on function public.review_admin_save_reply_draft_scoped(uuid,uuid,uuid,text,text,text,text,text)
to authenticated;

revoke all on function public.review_admin_discard_reply_draft_scoped(uuid,uuid,uuid,text,text)
from public,anon,service_role;
grant execute on function public.review_admin_discard_reply_draft_scoped(uuid,uuid,uuid,text,text)
to authenticated;

commit;
