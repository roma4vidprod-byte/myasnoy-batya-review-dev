-- Yandex scoped persistence + atomic writer 04.
-- Review Activator DEV only. No provider fetch, reply, scheduler or data import.
-- Fail closed if the paused-job/data preflight is no longer true.
do $$
begin
  if exists (select 1 from cron.job where jobname='review-provider-due-check-hourly' and active) then
    raise exception 'PAUSE_REVIEW_DEV_SCHEDULER_FIRST';
  end if;
  if exists (select 1 from public.review_external_reviews where company_id is null or location_id is null or provider is null or external_review_id is null) then
    raise exception 'REVIEW_EXTERNAL_REVIEWS_NULL_SCOPE';
  end if;
  if exists (
    select 1 from public.review_external_reviews r
    left join public.review_locations l on l.id=r.location_id
    where l.id is null or l.company_id is distinct from r.company_id
  ) then raise exception 'REVIEW_EXTERNAL_REVIEWS_LOCATION_SCOPE_DRIFT'; end if;
  if exists (select 1 from (select company_id,location_id,provider,external_review_id from public.review_external_reviews group by 1,2,3,4 having count(*)>1) d) then
    raise exception 'REVIEW_EXTERNAL_REVIEWS_SCOPED_DUPLICATES';
  end if;
  if exists (select 1 from (select provider,external_review_id from public.review_external_reviews group by 1,2 having count(*)>1) d) then
    raise exception 'REVIEW_EXTERNAL_REVIEWS_GLOBAL_ID_COLLISION';
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.review_locations'::regclass and conname='review_locations_id_company_uq'
  ) then
    alter table public.review_locations add constraint review_locations_id_company_uq unique (id,company_id);
  end if;
end;
$$;

alter table public.review_external_reviews alter column location_id set not null;
alter table public.review_external_reviews drop constraint review_external_reviews_location_id_fkey;
alter table public.review_external_reviews add constraint review_external_reviews_location_company_fk
  foreign key (location_id,company_id) references public.review_locations(id,company_id)
  on delete no action deferrable initially deferred;

alter table public.review_external_reviews drop constraint review_external_reviews_company_id_provider_external_review_key;
drop index public.review_external_reviews_provider_external_id_uq;
alter table public.review_external_reviews add constraint review_external_reviews_company_location_provider_external_review_key
  unique (company_id,location_id,provider,external_review_id);

revoke insert,update,delete,truncate,references,trigger,maintain
  on table public.review_external_reviews from public,anon,authenticated;

create or replace function public.review_persist_external_reviews(
  p_company_id uuid,
  p_location_id uuid,
  p_provider text,
  p_external_location_id text,
  p_reviews jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path to 'pg_catalog','public'
as $$
declare
  v_item record;
  v_existing public.review_external_reviews%rowtype;
  v_id uuid;
  v_seen integer := 0;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_unchanged integer := 0;
  v_allowed_raw text[] := array['contract_version','type_confirmation','id','cmnt_entity_id','external_id_source','author_name','full_text','rating','time_created','owner_comment','comments_count','lang','public_rating'];
begin
  if p_company_id is null or p_location_id is null or p_provider not in ('yandex','2gis') or nullif(btrim(coalesce(p_external_location_id,'')),'') is null then
    raise exception 'REVIEW_SCOPE_REQUIRED';
  end if;
  if jsonb_typeof(p_reviews) is distinct from 'array' or jsonb_array_length(p_reviews)>10000 then
    raise exception 'REVIEW_BATCH_INVALID';
  end if;
  if not exists (select 1 from public.review_locations where id=p_location_id and company_id=p_company_id) then
    raise exception 'REVIEW_SCOPE_INVALID';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_reviews) as x(
      external_review_id text,author_name text,rating numeric,review_text text,
      published_at timestamptz,observed_at timestamptz,owner_reply_text text,
      owner_replied_at timestamptz,raw_payload jsonb
    ) where nullif(btrim(coalesce(external_review_id,'')),'') is null
       or rating is null or rating<1 or rating>5
       or observed_at is null
       or jsonb_typeof(raw_payload) is distinct from 'object'
  ) then raise exception 'REVIEW_ROW_INVALID'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_reviews) as x(external_review_id text)
    group by external_review_id having count(*)>1
  ) then raise exception 'REVIEW_BATCH_DUPLICATE'; end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_reviews) as x(raw_payload jsonb)
    cross join lateral jsonb_object_keys(x.raw_payload) k(key)
    where not (k.key = any(v_allowed_raw))
  ) then raise exception 'REVIEW_RAW_PAYLOAD_INVALID'; end if;

  for v_item in
    select * from jsonb_to_recordset(p_reviews) as x(
      external_review_id text,author_name text,rating numeric,review_text text,
      published_at timestamptz,observed_at timestamptz,owner_reply_text text,
      owner_replied_at timestamptz,raw_payload jsonb
    ) order by external_review_id
  loop
    v_seen := v_seen + 1;
    select * into v_existing from public.review_external_reviews
      where company_id=p_company_id and location_id=p_location_id
        and provider=p_provider and external_review_id=v_item.external_review_id
      for update;
    if found then
      if v_existing.external_location_id is distinct from p_external_location_id then
        raise exception 'REVIEW_SCOPE_COLLISION';
      end if;
      if v_existing.author_name is not distinct from v_item.author_name
         and v_existing.rating is not distinct from v_item.rating
         and v_existing.review_text is not distinct from v_item.review_text
         and v_existing.published_at is not distinct from v_item.published_at
         and v_existing.observed_at is not distinct from v_item.observed_at
         and v_existing.owner_reply_text is not distinct from v_item.owner_reply_text
         and v_existing.owner_replied_at is not distinct from v_item.owner_replied_at
         and v_existing.raw_payload is not distinct from v_item.raw_payload then
        v_unchanged := v_unchanged + 1;
      else
        update public.review_external_reviews set
          author_name=v_item.author_name,rating=v_item.rating,review_text=v_item.review_text,
          published_at=v_item.published_at,observed_at=v_item.observed_at,
          raw_payload=v_item.raw_payload,owner_reply_text=v_item.owner_reply_text,
          owner_replied_at=v_item.owner_replied_at
        where id=v_existing.id;
        v_updated := v_updated + 1;
      end if;
    else
      insert into public.review_external_reviews(
        company_id,location_id,provider,external_review_id,external_location_id,
        author_name,rating,review_text,published_at,observed_at,raw_payload,
        owner_reply_text,owner_replied_at
      ) values (
        p_company_id,p_location_id,p_provider,v_item.external_review_id,p_external_location_id,
        v_item.author_name,v_item.rating,v_item.review_text,v_item.published_at,v_item.observed_at,v_item.raw_payload,
        v_item.owner_reply_text,v_item.owner_replied_at
      ) on conflict (company_id,location_id,provider,external_review_id) do nothing
        returning id into v_id;
      if v_id is not null then
        v_inserted := v_inserted + 1;
      else
        select * into v_existing from public.review_external_reviews
          where company_id=p_company_id and location_id=p_location_id
            and provider=p_provider and external_review_id=v_item.external_review_id
          for update;
        if not found or v_existing.external_location_id is distinct from p_external_location_id then
          raise exception 'REVIEW_SCOPE_COLLISION';
        end if;
        if v_existing.author_name is not distinct from v_item.author_name
           and v_existing.rating is not distinct from v_item.rating
           and v_existing.review_text is not distinct from v_item.review_text
           and v_existing.published_at is not distinct from v_item.published_at
           and v_existing.observed_at is not distinct from v_item.observed_at
           and v_existing.owner_reply_text is not distinct from v_item.owner_reply_text
           and v_existing.owner_replied_at is not distinct from v_item.owner_replied_at
           and v_existing.raw_payload is not distinct from v_item.raw_payload then
          v_unchanged := v_unchanged + 1;
        else
          update public.review_external_reviews set
            author_name=v_item.author_name,rating=v_item.rating,review_text=v_item.review_text,
            published_at=v_item.published_at,observed_at=v_item.observed_at,
            raw_payload=v_item.raw_payload,owner_reply_text=v_item.owner_reply_text,
            owner_replied_at=v_item.owner_replied_at
          where id=v_existing.id;
          v_updated := v_updated + 1;
        end if;
      end if;
    end if;
  end loop;
  return jsonb_build_object('inserted',v_inserted,'updated',v_updated,'unchanged',v_unchanged,'seen',v_seen,'persistence_enabled',true);
end;
$$;
revoke all on function public.review_persist_external_reviews(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.review_persist_external_reviews(uuid,uuid,text,text,jsonb) to service_role;
