-- VPS09 capability adapter, not another writer. Apply only to the fixed LAB
-- or disposable native fixture. The existing invoker RPC stays unchanged.
begin;
set local lock_timeout='5s';
do $$ begin
  if current_database() not in ('review_activator_lab','vps09_disposable')
    or not exists(select 1 from vps_lab_private.version where version='vps04-auth-api-v1') then
    raise exception 'VPS_DATABASE_REQUIRED';
  end if;
end $$;
grant select,insert on public.review_external_reviews to vps_yandex_owner;
grant update(author_name,rating,review_text,published_at,observed_at,raw_payload,owner_reply_text,owner_replied_at)
  on public.review_external_reviews to vps_yandex_owner;
create policy vps09_exact_reviews on public.review_external_reviews to vps_yandex_owner
  using(company_id='13f3cb80-487a-4a19-96a1-fb3103200230' and location_id='9a95f63b-18e6-447b-a449-8530b67ddbae'
    and provider='yandex' and external_location_id='54309413522')
  with check(company_id='13f3cb80-487a-4a19-96a1-fb3103200230' and location_id='9a95f63b-18e6-447b-a449-8530b67ddbae'
    and provider='yandex' and external_location_id='54309413522');
grant execute on function public.review_persist_external_reviews(uuid,uuid,text,text,jsonb) to vps_yandex_owner;

create function vps_yandex_private.persist_call(p_company_id uuid,p_location_id uuid,p_provider text,
 p_org_id text,p_expected_revision bigint,p_phase text,p_reviews jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_state text; v_revision bigint; v_count bigint; v_result jsonb;
begin
  if session_user is distinct from 'review-yandex-reader' then raise exception 'SESSION_ROLE_DENIED'; end if;
  if p_company_id is distinct from '13f3cb80-487a-4a19-96a1-fb3103200230'::uuid
     or p_location_id is distinct from '9a95f63b-18e6-447b-a449-8530b67ddbae'::uuid
     or p_provider is distinct from 'yandex' or p_org_id is distinct from '54309413522' then
    raise exception 'REVIEW_SCOPE_COLLISION'; end if;
  if p_expected_revision is distinct from 4::bigint then raise exception 'SESSION_CHANGED'; end if;
  if p_phase is null or p_phase not in ('first','replay') then raise exception 'REVIEW_PHASE_INVALID'; end if;
  if jsonb_typeof(p_reviews) is distinct from 'array' or jsonb_array_length(p_reviews)>200 then
    raise exception 'REVIEW_BATCH_INVALID'; end if;
  if exists(select 1 from pg_catalog.pg_trigger where tgrelid='public.review_external_reviews'::regclass and not tgisinternal) then
    raise exception 'REVIEW_DOWNSTREAM_GUARD'; end if;
  perform pg_catalog.pg_advisory_xact_lock(1380013908,9);
  select state,revision into v_state,v_revision from review_private.yandex_sessions
    where company_id=p_company_id and location_id=p_location_id and external_org_id=p_org_id for share;
  if v_state is distinct from 'READY' or v_revision is distinct from p_expected_revision then
    raise exception 'SESSION_CHANGED'; end if;
  select count(*) into v_count from public.review_external_reviews
    where company_id=p_company_id and location_id=p_location_id and provider=p_provider;
  if (p_phase='first' and v_count<>0) or (p_phase='replay' and v_count=0) then raise exception 'REVIEW_PHASE_INVALID'; end if;
  v_result := public.review_persist_external_reviews(p_company_id,p_location_id,p_provider,p_org_id,p_reviews);
  -- Verify the entire normalized batch inside the same transaction. Observation
  -- time alone is intentionally excluded: the accepted writer treats it as no-op.
  if exists(select 1 from jsonb_to_recordset(p_reviews) b(external_review_id text,author_name text,rating numeric,
    review_text text,published_at timestamptz,owner_reply_text text,owner_replied_at timestamptz,raw_payload jsonb)
    left join public.review_external_reviews r on r.company_id=p_company_id and r.location_id=p_location_id
      and r.provider=p_provider and r.external_review_id=b.external_review_id
    where r.id is null or r.external_location_id is distinct from p_org_id
      or r.author_name is distinct from b.author_name or r.rating is distinct from b.rating
      or r.review_text is distinct from b.review_text or r.published_at is distinct from b.published_at
      or r.owner_reply_text is distinct from b.owner_reply_text or r.owner_replied_at is distinct from b.owner_replied_at
      or r.raw_payload is distinct from b.raw_payload) then raise exception 'REVIEW_BATCH_VERIFY_FAILED'; end if;
  return v_result;
end $$;
alter function vps_yandex_private.persist_call(uuid,uuid,text,text,bigint,text,jsonb) owner to vps_yandex_owner;
revoke all on function vps_yandex_private.persist_call(uuid,uuid,text,text,bigint,text,jsonb) from public;
grant execute on function vps_yandex_private.persist_call(uuid,uuid,text,text,bigint,text,jsonb) to "review-yandex-reader";
commit;
