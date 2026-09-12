-- LOCAL TEST ONLY. Catalog/migration-derived subset, NOT a deployable baseline.
-- Company/location/QR stubs include only columns needed by these tests.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema cron;
create table cron.job (jobname text, active boolean);
insert into cron.job values ('review-provider-due-check-hourly', false);
create table public.review_companies (id uuid primary key);
create table public.review_locations (id uuid primary key, company_id uuid not null references public.review_companies(id));
create table public.review_qr_sources (location_id uuid references public.review_locations(id), public_token text, active boolean);
create table if not exists public.review_provider_connections (
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

create table if not exists public.review_sync_runs (
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

create table if not exists public.review_external_reviews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.review_companies(id) on delete cascade,
  location_id uuid references public.review_locations(id) on delete set null,
  provider text not null check (provider in ('yandex','2gis')),
  external_review_id text not null,
  external_location_id text,
  author_name text,
  rating numeric,
  review_text text,
  published_at timestamptz,
  observed_at timestamptz not null default now(),
  raw_payload jsonb not null default '{}'::jsonb,
  unique(company_id, provider, external_review_id)
);
alter table public.review_external_reviews
  add column owner_reply_text text,
  add column owner_reply_external_id text,
  add column owner_replied_at timestamptz,
  add column reply_state text not null default 'NONE'
    check(reply_state in ('NONE','DRAFT','QUEUED','SENT','FAILED','SYNCED_EXTERNAL'));
create unique index review_external_reviews_provider_external_id_uq on public.review_external_reviews(provider, external_review_id);
create index review_external_reviews_match_idx on public.review_external_reviews(provider,location_id,published_at desc);
alter table public.review_provider_connections enable row level security;
alter table public.review_sync_runs enable row level security;
alter table public.review_external_reviews enable row level security;
grant usage on schema public to anon,authenticated,service_role;
grant select,insert,update,delete on all tables in schema public to anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.review_enqueue_due_syncs()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  r record;
  queued integer := 0;
  run_status text;
begin
  for r in
    select *
    from public.review_provider_connections
    where enabled = true
      and status <> 'PAUSED'
      and next_sync_at <= now()
    for update skip locked
  loop
    if r.status = 'READY' then
      run_status := 'QUEUED';
    else
      run_status := 'SKIPPED_NOT_CONFIGURED';
    end if;

    insert into public.review_sync_runs(
      provider_connection_id, provider, status, requested_at, finished_at, error, meta
    ) values (
      r.id,
      r.provider,
      run_status,
      now(),
      case when run_status = 'SKIPPED_NOT_CONFIGURED' then now() else null end,
      case when run_status = 'SKIPPED_NOT_CONFIGURED' then 'Provider access is not configured yet' else null end,
      jsonb_build_object('source','scheduler','interval_minutes',r.sync_interval_minutes)
    );

    update public.review_provider_connections
    set last_sync_requested_at = now(),
        next_sync_at = now() + make_interval(mins => r.sync_interval_minutes),
        updated_at = now()
    where id = r.id;

    queued := queued + 1;
  end loop;

  return queued;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.review_public_request_due_syncs(p_token text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_company uuid;
  r record;
  queued integer := 0;
  run_status text;
begin
  select l.company_id into v_company
  from public.review_qr_sources q
  join public.review_locations l on l.id=q.location_id
  where q.public_token=p_token and q.active=true
  limit 1;

  if v_company is null then
    raise exception 'INVALID_PUBLIC_TOKEN';
  end if;

  for r in
    select *
    from public.review_provider_connections
    where company_id=v_company
      and enabled=true
      and status <> 'PAUSED'
      and next_sync_at <= now()
    for update skip locked
  loop
    run_status := case when r.status='READY' then 'QUEUED' else 'SKIPPED_NOT_CONFIGURED' end;

    insert into public.review_sync_runs(
      provider_connection_id, provider, status, requested_at, finished_at, error, meta
    ) values (
      r.id,
      r.provider,
      run_status,
      now(),
      case when run_status='SKIPPED_NOT_CONFIGURED' then now() else null end,
      case when run_status='SKIPPED_NOT_CONFIGURED' then 'Provider access is not configured yet' else null end,
      jsonb_build_object('source','vercel-hourly-cron','interval_minutes',60)
    );

    update public.review_provider_connections
    set last_sync_requested_at=now(),
        next_sync_at=now()+interval '60 minutes',
        updated_at=now()
    where id=r.id;

    queued := queued + 1;
  end loop;

  return queued;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.review_public_sync_status(p_token text)
 RETURNS TABLE(provider text, connection_status text, sync_interval_minutes integer, last_sync_requested_at timestamp with time zone, last_success_at timestamp with time zone, next_sync_at timestamp with time zone, last_error text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select pc.provider,
         pc.status,
         pc.sync_interval_minutes,
         pc.last_sync_requested_at,
         pc.last_success_at,
         pc.next_sync_at,
         pc.last_error
  from public.review_provider_connections pc
  join public.review_locations l on l.company_id = pc.company_id
  join public.review_qr_sources q on q.location_id = l.id
  where q.public_token = p_token
    and q.active = true
  order by pc.provider;
$function$
;
revoke all on function public.review_enqueue_due_syncs() from public,anon,authenticated;
grant execute on function public.review_enqueue_due_syncs() to service_role;
grant execute on function public.review_public_request_due_syncs(text) to anon,authenticated,service_role;
revoke all on function public.review_public_sync_status(text) from public;
grant execute on function public.review_public_sync_status(text) to anon,authenticated,service_role;
