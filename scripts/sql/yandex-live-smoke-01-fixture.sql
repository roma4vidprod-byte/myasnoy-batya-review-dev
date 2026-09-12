-- ONE-TIME DATA FIXTURE, NOT a schema migration or application runtime caller.
-- Only execute against verified Review Activator DEV project ykiubttldgyjpajmsuas.
-- Owner authorized an isolated synthetic scope for Asbest org 54309413522.
-- Do not reuse an unrelated company. Duplicate slug fails, never upserts/reassigns.
begin;
set local lock_timeout = '5s';
do $$
begin
  if exists(select 1 from cron.job where jobname='review-provider-due-check-hourly' and active) then
    raise exception 'SMOKE_REQUIRES_PAUSED_SCHEDULER';
  end if;
  if exists(select 1 from public.review_locations where city='Асбест' and address='Ленинградская 41А') then
    raise exception 'ASBEST_SCOPE_ALREADY_EXISTS_REVIEW_REQUIRED';
  end if;
end;
$$;
with fixture_company as (
  insert into public.review_companies(slug,name)
  values ('review-dev-yandex-smoke-01-asbest','[DEV SYNTHETIC] Review Activator — Asbest smoke 01')
  returning id
), fixture_location as (
  insert into public.review_locations(company_id,name,city,address,active)
  select id,'[DEV SYNTHETIC] Асбест — Yandex 54309413522','Асбест','Ленинградская 41А',false
  from fixture_company returning id,company_id
)
select company_id,id as location_id from fixture_location;
commit;
-- No QR, contact details, provider connections, sessions, reviews, matching or cron writes.
-- yandex_review_url remains NULL: a public review link was not verified and is not guessed.
