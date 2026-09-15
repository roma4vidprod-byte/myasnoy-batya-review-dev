-- Review Activator canonical fresh-schema baseline.
--
-- This is the application schema that predates the retained 20260912+
-- migrations.  It is deliberately not a pg_dump and contains no data.
-- The auth and cron objects below are an explicitly isolated migration-test
-- compatibility boundary for native PostgreSQL; they are not an Auth server
-- and they are not a VPS scheduler.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local search_path = pg_catalog, public;

-- PostgreSQL 17 provides gen_random_uuid() in pg_catalog.  DEV lists
-- pgcrypto/uuid-ossp as historical extensions, but neither is required by
-- this baseline and installing pgcrypto would collide with that built-in.

do $$
begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_admin') then create role supabase_admin nologin nosuperuser nobypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_auth_admin') then create role supabase_auth_admin nologin nosuperuser nobypassrls; end if;
end;
$$;

-- Minimal compile-time Auth boundary.  It proves only SQL dependency wiring;
-- it does not provide authentication or an Auth user store.
create schema if not exists auth;
alter schema auth owner to supabase_auth_admin;
create table if not exists auth.users (id uuid primary key);
alter table auth.users owner to supabase_auth_admin;
revoke all on auth.users from public, anon, authenticated, service_role;
grant references on auth.users to postgres;
create or replace function auth.uid()
returns uuid language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.jwt()
returns jsonb language sql stable
as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
alter function auth.uid() owner to supabase_auth_admin;
alter function auth.jwt() owner to supabase_auth_admin;
revoke all on function auth.uid() from public, anon, authenticated, service_role;
revoke all on function auth.jwt() from public, anon, authenticated, service_role;
grant execute on function auth.uid() to postgres;
grant execute on function auth.jwt() to postgres;

-- Migration-only scheduler catalog boundary.  No pg_cron extension, job, or
-- timer is installed; the retained migrations only need a paused-state probe.
create schema if not exists cron;
alter schema cron owner to supabase_admin;
create table if not exists cron.job (
  jobid bigint generated always as identity primary key,
  jobname text not null,
  active boolean not null
);
alter table cron.job owner to supabase_admin;
alter table cron.job enable row level security;
revoke all on schema cron from public, anon, authenticated, service_role;
grant usage on schema cron to postgres;
revoke all on cron.job from public, anon, authenticated, service_role, postgres;
grant select on cron.job to postgres;

create table public.review_companies (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  gift_name text,
  technical_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.review_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.review_companies(id) on delete cascade,
  name text not null,
  city text not null,
  address text not null,
  phone text,
  yandex_review_url text,
  twogis_review_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.review_qr_sources (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.review_locations(id) on delete cascade,
  source_type text not null default 'location',
  label text not null,
  public_token text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.review_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.review_companies(id) on delete cascade,
  location_id uuid not null references public.review_locations(id) on delete cascade,
  qr_source_id uuid references public.review_qr_sources(id) on delete set null,
  client_email text not null,
  platform text not null check (platform in ('yandex','2gis')),
  status text not null default 'WAITING_PUBLICATION' check (status in ('WAITING_PUBLICATION','CANDIDATE','VERIFIED','REWARD_RESERVED','PROMO_SENT','WAITING_PROMO','REJECTED')),
  clicked_at timestamptz not null default now(),
  verified_at timestamptz,
  confidence numeric,
  external_review_id text,
  external_author text,
  external_rating numeric,
  external_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.review_feedback (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.review_companies(id) on delete cascade,
  location_id uuid not null references public.review_locations(id) on delete cascade,
  qr_source_id uuid references public.review_qr_sources(id) on delete set null,
  category text not null,
  message text not null,
  contact text,
  status text not null default 'NEW' check (status in ('NEW','IN_PROGRESS','RESOLVED','CLOSED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.review_promo_codes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.review_companies(id) on delete cascade,
  code text not null,
  status text not null default 'AVAILABLE' check (status in ('AVAILABLE','RESERVED','SENT','REDEEMED','EXPIRED','DISABLED')),
  reward_label text,
  expires_at timestamptz,
  reserved_for_session_id uuid references public.review_sessions(id) on delete set null,
  reserved_at timestamptz,
  sent_at timestamptz,
  redeemed_at timestamptz,
  created_at timestamptz not null default now(),
  unique(company_id, code)
);

create table public.review_matches (
  id uuid primary key default gen_random_uuid(),
  review_session_id uuid not null references public.review_sessions(id) on delete cascade,
  provider text not null,
  external_review_id text,
  confidence numeric not null,
  decision text not null default 'CANDIDATE' check (decision in ('CANDIDATE','AUTO_MATCHED','CONFIRMED','REJECTED')),
  external_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table public.review_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.review_companies(id) on delete cascade,
  feedback_id uuid references public.review_feedback(id) on delete cascade,
  review_session_id uuid references public.review_sessions(id) on delete cascade,
  channel text not null check (channel in ('telegram','email')),
  destination text,
  status text not null default 'QUEUED' check (status in ('QUEUED','SENT','FAILED','SKIPPED')),
  attempt_count integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create table public.review_external_reviews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.review_companies(id) on delete cascade,
  location_id uuid references public.review_locations(id) on delete cascade,
  provider text not null check (provider in ('yandex','2gis')),
  external_review_id text not null,
  external_location_id text,
  author_name text,
  rating numeric,
  review_text text,
  published_at timestamptz,
  observed_at timestamptz not null default now(),
  raw_payload jsonb not null default '{}'::jsonb,
  owner_reply_text text,
  owner_reply_external_id text,
  owner_replied_at timestamptz,
  reply_state text not null default 'NONE' check (reply_state in ('NONE','DRAFT','QUEUED','SENT','FAILED','SYNCED_EXTERNAL')),
  constraint review_external_reviews_company_id_provider_external_review_key
    unique(company_id, provider, external_review_id)
);

create table public.review_reply_actions (
  id uuid primary key default gen_random_uuid(),
  external_review_row_id uuid not null references public.review_external_reviews(id) on delete cascade,
  company_id uuid not null references public.review_companies(id) on delete cascade,
  provider text not null check (provider in ('yandex','2gis')),
  external_review_id text not null,
  reply_text text not null,
  status text not null default 'DRAFT' check (status in ('DRAFT','QUEUED','SENDING','SENT','FAILED','CANCELLED')),
  created_by text,
  attempt_count integer not null default 0,
  last_error text,
  external_reply_id text,
  created_at timestamptz not null default now(),
  queued_at timestamptz,
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  draft_source text not null default 'human' check (draft_source in ('human','ai')),
  ai_model text,
  ai_generated_at timestamptz,
  edited_after_ai boolean not null default false
);

create table public.review_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  role text not null default 'owner' check (role in ('owner','admin','manager')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.review_provider_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.review_companies(id) on delete cascade,
  provider text not null check (provider in ('yandex','2gis')),
  enabled boolean not null default true,
  status text not null default 'WAITING_ACCESS' check (status in ('WAITING_ACCESS','READY','PAUSED','ERROR')),
  auth_mode text not null default 'representative_account',
  external_account_id text,
  config jsonb not null default '{}'::jsonb,
  sync_interval_minutes integer not null default 300 check (sync_interval_minutes between 60 and 10080),
  last_sync_requested_at timestamptz,
  last_sync_started_at timestamptz,
  last_sync_completed_at timestamptz,
  last_success_at timestamptz,
  next_sync_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id, provider)
);

create table public.review_sync_runs (
  id uuid primary key default gen_random_uuid(),
  provider_connection_id uuid not null references public.review_provider_connections(id) on delete cascade,
  provider text not null check (provider in ('yandex','2gis')),
  status text not null check (status in ('QUEUED','RUNNING','SUCCEEDED','FAILED','SKIPPED_NOT_CONFIGURED')),
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  fetched_count integer not null default 0,
  new_count integer not null default 0,
  matched_count integer not null default 0,
  error text,
  meta jsonb not null default '{}'::jsonb
);

create unique index review_admins_email_lower_uq on public.review_admins (lower(email));
create unique index review_external_reviews_provider_external_id_uq on public.review_external_reviews (provider, external_review_id);
create index review_external_reviews_match_idx on public.review_external_reviews (provider, location_id, published_at desc);
create index review_feedback_status_idx on public.review_feedback (status, created_at desc);
create index review_promo_codes_status_idx on public.review_promo_codes (company_id, status, created_at);
create index review_qr_sources_token_idx on public.review_qr_sources (public_token);
create unique index review_reply_actions_one_active_uq on public.review_reply_actions (external_review_row_id) where status in ('DRAFT','QUEUED','SENDING');
create index review_reply_actions_queue_idx on public.review_reply_actions (status, created_at);
create index review_sessions_status_idx on public.review_sessions (status, created_at desc);
create index review_sessions_waiting_match_idx on public.review_sessions (platform, location_id, clicked_at) where status in ('WAITING_PUBLICATION','CANDIDATE');
create index review_sync_runs_connection_requested_idx on public.review_sync_runs (provider_connection_id, requested_at desc);

-- RLS is part of the application contract.  No public policy is added here;
-- later RPCs are the explicit access boundary.
do $$
declare t text;
begin
  foreach t in array array['review_admins','review_companies','review_external_reviews','review_feedback','review_locations','review_matches','review_notification_deliveries','review_promo_codes','review_provider_connections','review_qr_sources','review_reply_actions','review_sessions','review_sync_runs'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

revoke all on all tables in schema public from public;
revoke all on all tables in schema public from anon, authenticated, service_role;
grant all on all tables in schema public to postgres;
grant usage on schema public to postgres, anon, authenticated, service_role;
grant all on public.review_companies, public.review_locations, public.review_qr_sources,
  public.review_feedback, public.review_sessions, public.review_promo_codes,
  public.review_matches, public.review_notification_deliveries, public.review_provider_connections,
  public.review_sync_runs to anon, authenticated, service_role;
grant select on public.review_external_reviews to anon, authenticated;
grant all on public.review_external_reviews to service_role;
grant all on public.review_admins, public.review_reply_actions to service_role;

-- Legacy signature is intentionally present only so the first retained
-- migration can drop it without CASCADE.
create function public.review_enqueue_due_syncs()
returns integer language plpgsql security invoker set search_path=''
as $$ begin raise exception using errcode='42501', message='LEGACY_SYNC_SIGNATURE_RETIRED'; end; $$;

CREATE OR REPLACE FUNCTION public.review_admin_profile()
 RETURNS TABLE(email text, role text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select a.email,a.role from public.review_admins a where a.user_id=auth.uid() and a.active=true limit 1
$function$;


CREATE OR REPLACE FUNCTION public.review_is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists(select 1 from public.review_admins a where a.user_id=auth.uid() and a.active=true)
$function$;


CREATE OR REPLACE FUNCTION public.review_admin_review_for_ai(p_review_id uuid)
 RETURNS TABLE(id uuid, provider text, author_name text, rating numeric, review_text text, location_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select r.id,r.provider,r.author_name,r.rating,r.review_text,l.name
  from public.review_external_reviews r
  left join public.review_locations l on l.id=r.location_id
  where r.id=p_review_id
    and public.review_is_admin()
  limit 1
$function$;


CREATE OR REPLACE FUNCTION public.review_admin_reviews(p_provider text DEFAULT NULL::text, p_rating_min integer DEFAULT NULL::integer, p_rating_max integer DEFAULT NULL::integer, p_unanswered_only boolean DEFAULT false, p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, provider text, external_review_id text, location_id uuid, location_name text, author_name text, rating numeric, review_text text, published_at timestamp with time zone, reply_state text, owner_reply_text text, owner_replied_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select r.id,
         r.provider,
         r.external_review_id,
         r.location_id,
         l.name as location_name,
         r.author_name,
         r.rating,
         r.review_text,
         r.published_at,
         r.reply_state,
         r.owner_reply_text,
         r.owner_replied_at
  from public.review_external_reviews r
  left join public.review_locations l on l.id=r.location_id
  where public.review_is_admin()
    and (p_provider is null or r.provider=p_provider)
    and (p_rating_min is null or r.rating>=p_rating_min)
    and (p_rating_max is null or r.rating<=p_rating_max)
    and (not p_unanswered_only or r.reply_state in ('NONE','FAILED'))
  order by coalesce(r.published_at,r.observed_at) desc
  limit least(greatest(coalesce(p_limit,100),1),500)
$function$;


CREATE OR REPLACE FUNCTION public.review_admin_save_reply_draft(p_external_review_row_id uuid, p_reply_text text, p_draft_source text DEFAULT 'human'::text, p_ai_model text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_review public.review_external_reviews%rowtype;
  v_id uuid;
  v_text text := trim(coalesce(p_reply_text,''));
begin
  if not public.review_is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if v_text='' then raise exception 'REPLY_TEXT_REQUIRED'; end if;
  if length(v_text)>5000 then raise exception 'REPLY_TEXT_TOO_LONG'; end if;
  if p_draft_source not in ('human','ai') then raise exception 'DRAFT_SOURCE_INVALID'; end if;

  select * into v_review from public.review_external_reviews where id=p_external_review_row_id;
  if not found then raise exception 'REVIEW_NOT_FOUND'; end if;

  insert into public.review_reply_actions(
    external_review_row_id,company_id,provider,external_review_id,reply_text,status,created_by,draft_source,ai_model,ai_generated_at
  )
  values(
    v_review.id,v_review.company_id,v_review.provider,v_review.external_review_id,v_text,'DRAFT',auth.uid()::text,p_draft_source,p_ai_model,
    case when p_draft_source='ai' then now() else null end
  )
  on conflict (external_review_row_id) where status in ('DRAFT','QUEUED','SENDING')
  do update set reply_text=excluded.reply_text,
                status='DRAFT',
                draft_source=excluded.draft_source,
                ai_model=excluded.ai_model,
                ai_generated_at=excluded.ai_generated_at,
                edited_after_ai=(public.review_reply_actions.draft_source='ai' and excluded.draft_source='human'),
                updated_at=now()
  returning id into v_id;

  update public.review_external_reviews set reply_state='DRAFT' where id=v_review.id;
  return v_id;
end;
$function$;


CREATE OR REPLACE FUNCTION public.review_claim_initial_owner()
 RETURNS TABLE(email text, role text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_email text := lower(coalesce(auth.jwt()->>'email',''));
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if v_email <> lower('Myasnoibatya@yandex.ru') then
    raise exception 'OWNER_EMAIL_NOT_ALLOWED';
  end if;

  insert into public.review_admins(user_id,email,role,active)
  values(auth.uid(), v_email, 'owner', true)
  on conflict (user_id) do update
    set email=excluded.email, role='owner', active=true;

  return query select a.email,a.role from public.review_admins a where a.user_id=auth.uid();
end;
$function$;


CREATE OR REPLACE FUNCTION public.review_dev_import_promos(p_token text, p_codes text[], p_reward_label text DEFAULT NULL::text)
 RETURNS TABLE(found integer, added integer, duplicates integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_company uuid;
  v_found integer := 0;
  v_added integer := 0;
  v_code text;
begin
  select l.company_id
    into v_company
  from review_qr_sources q
  join review_locations l on l.id = q.location_id
  where q.public_token = p_token
    and q.active = true
    and l.active = true
  limit 1;

  if v_company is null then
    raise exception 'INVALID_TOKEN';
  end if;

  if p_codes is null or array_length(p_codes, 1) is null then
    return query select 0,0,0;
    return;
  end if;

  if array_length(p_codes, 1) > 5000 then
    raise exception 'TOO_MANY_CODES';
  end if;

  foreach v_code in array p_codes loop
    v_code := btrim(v_code);
    if v_code is null or v_code = '' or length(v_code) > 128 then
      continue;
    end if;
    v_found := v_found + 1;
    insert into review_promo_codes(company_id, code, reward_label, status)
    values (v_company, v_code, nullif(btrim(p_reward_label),''), 'AVAILABLE')
    on conflict (company_id, code) do nothing;
    if found then
      v_added := v_added + 1;
    end if;
  end loop;

  return query select v_found, v_added, v_found - v_added;
end;
$function$;


CREATE OR REPLACE FUNCTION public.review_internal_reserve_promo(p_session_id uuid)
 RETURNS TABLE(promo_id uuid, promo_code text, reward_label text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_session public.review_sessions%rowtype;
  v_promo public.review_promo_codes%rowtype;
begin
  select * into v_session
  from public.review_sessions
  where id = p_session_id
  for update;

  if not found then
    raise exception 'SESSION_NOT_FOUND';
  end if;

  if v_session.status not in ('VERIFIED','WAITING_PROMO','REWARD_RESERVED') then
    raise exception 'SESSION_NOT_ELIGIBLE';
  end if;

  select * into v_promo
  from public.review_promo_codes
  where company_id = v_session.company_id
    and status = 'AVAILABLE'
    and (expires_at is null or expires_at > now())
  order by created_at, id
  for update skip locked
  limit 1;

  if not found then
    update public.review_sessions
      set status = 'WAITING_PROMO', updated_at = now()
      where id = p_session_id;
    return;
  end if;

  update public.review_promo_codes
    set status = 'RESERVED',
        reserved_for_session_id = p_session_id,
        reserved_at = now()
    where id = v_promo.id;

  update public.review_sessions
    set status = 'REWARD_RESERVED', updated_at = now()
    where id = p_session_id;

  return query select v_promo.id, v_promo.code, v_promo.reward_label;
end;
$function$;


CREATE OR REPLACE FUNCTION public.review_match_candidates()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  s record;
  r record;
  c numeric;
  created_count integer := 0;
begin
  for s in
    select * from public.review_sessions
    where status in ('WAITING_PUBLICATION','CANDIDATE')
      and clicked_at >= now() - interval '30 days'
    order by clicked_at
  loop
    for r in
      select * from public.review_external_reviews
      where provider = s.platform
        and (location_id = s.location_id or location_id is null)
        and rating = 5
        and coalesce(published_at, observed_at) >= s.clicked_at - interval '30 minutes'
        and coalesce(published_at, observed_at) <= s.clicked_at + interval '14 days'
      order by abs(extract(epoch from (coalesce(published_at, observed_at) - s.clicked_at)))
      limit 5
    loop
      c := 0.55;
      if r.location_id = s.location_id then c := c + 0.20; end if;
      if coalesce(r.published_at, r.observed_at) <= s.clicked_at + interval '48 hours' then c := c + 0.15; end if;
      if r.author_name is not null and length(trim(r.author_name)) > 1 then c := c + 0.05; end if;
      c := least(c, 0.95);

      insert into public.review_matches(review_session_id, provider, external_review_id, confidence, decision, external_payload)
      values (s.id, s.platform, r.external_review_id, c,
        case when c >= 0.90 then 'AUTO_MATCHED' else 'CANDIDATE' end,
        jsonb_build_object('external_review_row_id', r.id, 'author_name', r.author_name, 'rating', r.rating, 'published_at', r.published_at))
      on conflict do nothing;

      if found then
        created_count := created_count + 1;
        update public.review_sessions
        set status = case when c >= 0.90 then 'VERIFIED' else 'CANDIDATE' end,
            confidence = greatest(coalesce(confidence,0), c),
            external_review_id = case when c >= 0.90 then r.external_review_id else external_review_id end,
            external_author = case when c >= 0.90 then r.author_name else external_author end,
            external_rating = case when c >= 0.90 then r.rating else external_rating end,
            external_text = case when c >= 0.90 then r.review_text else external_text end,
            verified_at = case when c >= 0.90 then now() else verified_at end,
            updated_at = now()
        where id = s.id;
      end if;
    end loop;
  end loop;
  return created_count;
end;
$function$;


CREATE OR REPLACE FUNCTION public.review_public_create_session(p_token text, p_email text, p_platform text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_company uuid;
  v_location uuid;
  v_source uuid;
  v_id uuid;
begin
  if p_platform not in ('yandex','2gis') then raise exception 'invalid_platform'; end if;
  if p_email is null or p_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' then raise exception 'invalid_email'; end if;
  select c.id, l.id, s.id into v_company, v_location, v_source
  from public.review_qr_sources s
  join public.review_locations l on l.id=s.location_id
  join public.review_companies c on c.id=l.company_id
  where s.public_token=p_token and s.active and l.active
  limit 1;
  if v_company is null then raise exception 'invalid_source'; end if;
  insert into public.review_sessions(company_id,location_id,qr_source_id,client_email,platform)
  values(v_company,v_location,v_source,lower(trim(p_email)),p_platform)
  returning id into v_id;
  return v_id;
end;
$function$;


CREATE OR REPLACE FUNCTION public.review_public_promo_stats(p_token text)
 RETURNS TABLE(available bigint, reserved bigint, sent bigint, redeemed bigint)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with ctx as (
    select l.company_id
    from public.review_qr_sources q
    join public.review_locations l on l.id = q.location_id
    where q.public_token = p_token and q.active = true and l.active = true
    limit 1
  )
  select
    count(*) filter (where p.status='AVAILABLE')::bigint,
    count(*) filter (where p.status='RESERVED')::bigint,
    count(*) filter (where p.status='SENT')::bigint,
    count(*) filter (where p.status='REDEEMED')::bigint
  from public.review_promo_codes p
  join ctx on ctx.company_id = p.company_id;
$function$;


CREATE OR REPLACE FUNCTION public.review_public_resolve_source(p_token text)
 RETURNS TABLE(company_id uuid, location_id uuid, qr_source_id uuid, company_name text, location_name text, city text, address text, yandex_review_url text, twogis_review_url text, source_label text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id, l.id, s.id, c.name, l.name, l.city, l.address, l.yandex_review_url, l.twogis_review_url, s.label
  from public.review_qr_sources s
  join public.review_locations l on l.id = s.location_id
  join public.review_companies c on c.id = l.company_id
  where s.public_token = p_token and s.active and l.active
  limit 1;
$function$;


CREATE OR REPLACE FUNCTION public.review_public_submit_feedback(p_token text, p_category text, p_message text, p_contact text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_company uuid;
  v_location uuid;
  v_source uuid;
  v_id uuid;
begin
  if length(trim(coalesce(p_category,''))) < 2 then raise exception 'invalid_category'; end if;
  if length(trim(coalesce(p_message,''))) < 2 or length(p_message) > 4000 then raise exception 'invalid_message'; end if;
  select c.id, l.id, s.id into v_company, v_location, v_source
  from public.review_qr_sources s
  join public.review_locations l on l.id=s.location_id
  join public.review_companies c on c.id=l.company_id
  where s.public_token=p_token and s.active and l.active
  limit 1;
  if v_company is null then raise exception 'invalid_source'; end if;
  insert into public.review_feedback(company_id,location_id,qr_source_id,category,message,contact)
  values(v_company,v_location,v_source,trim(p_category),trim(p_message),nullif(trim(coalesce(p_contact,'')),''))
  returning id into v_id;
  return v_id;
end;
$function$;


revoke all on function public.review_enqueue_due_syncs() from public, anon, authenticated, service_role;
grant execute on function public.review_enqueue_due_syncs() to postgres;

revoke all on function public.review_admin_profile() from public;
revoke all on function public.review_admin_review_for_ai(uuid) from public;
revoke all on function public.review_admin_reviews(text,integer,integer,boolean,integer) from public;
revoke all on function public.review_admin_save_reply_draft(uuid,text,text,text) from public;
revoke all on function public.review_claim_initial_owner() from public;
revoke all on function public.review_dev_import_promos(text,text[],text) from public;
revoke all on function public.review_internal_reserve_promo(uuid) from public;
revoke all on function public.review_is_admin() from public;
revoke all on function public.review_match_candidates() from public;
revoke all on function public.review_public_create_session(text,text,text) from public;
revoke all on function public.review_public_promo_stats(text) from public;
revoke all on function public.review_public_resolve_source(text) from public;
revoke all on function public.review_public_submit_feedback(text,text,text,text) from public;
grant execute on function public.review_admin_profile() to authenticated, service_role, postgres;
grant execute on function public.review_admin_review_for_ai(uuid) to authenticated, service_role, postgres;
grant execute on function public.review_admin_reviews(text,integer,integer,boolean,integer) to authenticated, service_role, postgres;
grant execute on function public.review_admin_save_reply_draft(uuid,text,text,text) to authenticated, service_role, postgres;
grant execute on function public.review_claim_initial_owner() to authenticated, service_role, postgres;
grant execute on function public.review_dev_import_promos(text,text[],text) to anon, service_role, postgres;
grant execute on function public.review_internal_reserve_promo(uuid) to service_role, postgres;
grant execute on function public.review_is_admin() to authenticated, service_role, postgres;
grant execute on function public.review_match_candidates() to service_role, postgres;
grant execute on function public.review_public_create_session(text,text,text) to anon, service_role, postgres;
grant execute on function public.review_public_promo_stats(text) to anon, authenticated, service_role, postgres;
grant execute on function public.review_public_resolve_source(text) to anon, authenticated, service_role, postgres;
grant execute on function public.review_public_submit_feedback(text,text,text,text) to anon, authenticated, service_role, postgres;
grant execute on function public.review_public_promo_stats(text) to public;
grant execute on function public.review_public_resolve_source(text) to public;
grant execute on function public.review_public_submit_feedback(text,text,text,text) to public;

commit;
