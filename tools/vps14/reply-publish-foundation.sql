begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local search_path=pg_catalog,public;

do $$
declare v_count integer;
begin
  if current_database() <> 'review_activator_lab' then raise exception 'VPS14_DATABASE_INVALID'; end if;
  if to_regclass('public.review_reply_actions') is null then raise exception 'VPS14_REPLY_ACTIONS_MISSING'; end if;
  select count(*) into v_count
  from public.review_locations l
  where l.id='9a95f63b-18e6-447b-a449-8530b67ddbae'::uuid
    and l.company_id='13f3cb80-487a-4a19-96a1-fb3103200230'::uuid;
  if v_count <> 1 then raise exception 'VPS14_SCOPE_INVALID'; end if;
  if exists(select 1 from public.review_reply_actions where status in ('QUEUED','SENDING','SENT','FAILED')) then
    raise exception 'VPS14_PREEXISTING_PUBLISH_STATE';
  end if;
end
$$;

alter table public.review_reply_actions
  add column if not exists approval_fingerprint text,
  add column if not exists approval_prepared_by uuid,
  add column if not exists approval_prepared_at timestamptz,
  add column if not exists approval_expires_at timestamptz,
  add column if not exists approved_by uuid,
  add column if not exists approved_at timestamptz,
  add column if not exists idempotency_key uuid,
  add column if not exists sending_started_at timestamptz,
  add column if not exists finished_at timestamptz;

do $$
begin
  if not exists(select 1 from pg_constraint where conname='review_reply_actions_approval_fingerprint_ck') then
    alter table public.review_reply_actions add constraint review_reply_actions_approval_fingerprint_ck
      check(approval_fingerprint is null or approval_fingerprint ~ '^[0-9a-f]{64}$');
  end if;
  if not exists(select 1 from pg_constraint where conname='review_reply_actions_publish_approval_ck') then
    alter table public.review_reply_actions add constraint review_reply_actions_publish_approval_ck
      check(status not in ('QUEUED','SENDING','SENT','FAILED') or
        (approval_fingerprint is not null and approval_prepared_by is not null and
         approval_prepared_at is not null and approval_expires_at is not null and
         approved_by is not null and approved_at is not null and idempotency_key is not null));
  end if;
end
$$;

create unique index if not exists review_reply_actions_idempotency_uq
  on public.review_reply_actions(idempotency_key) where idempotency_key is not null;

create or replace function vps_lab_private.reply_approval_fingerprint(
  p_action_id uuid,p_external_review_id text,p_reply_text text,
  p_company_id uuid,p_location_id uuid,p_provider text
)
returns text
language plpgsql
immutable
security invoker
set search_path=''
as $$
declare
  v_material text;
begin
  if p_action_id is null or p_external_review_id is null or p_reply_text is null
     or p_company_id is null or p_location_id is null or p_provider is null then
    raise exception 'REPLY_APPROVAL_INPUT_INVALID';
  end if;
  v_material :=
    octet_length(convert_to(p_action_id::text,'UTF8'))::text||':'||p_action_id::text||
    octet_length(convert_to(p_external_review_id,'UTF8'))::text||':'||p_external_review_id||
    octet_length(convert_to(p_reply_text,'UTF8'))::text||':'||p_reply_text||
    octet_length(convert_to(p_company_id::text,'UTF8'))::text||':'||p_company_id::text||
    octet_length(convert_to(p_location_id::text,'UTF8'))::text||':'||p_location_id::text||
    octet_length(convert_to(p_provider,'UTF8'))::text||':'||p_provider;
  return encode(sha256(convert_to(v_material,'UTF8')),'hex');
end;
$$;

revoke all on function vps_lab_private.reply_approval_fingerprint(uuid,text,text,uuid,uuid,text)
from public,anon,authenticated,service_role;

create or replace function vps_lab_private.invalidate_reply_approval_on_draft_edit()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
begin
  if old.status='DRAFT' and new.status='DRAFT' and new.reply_text is distinct from old.reply_text then
    new.approval_fingerprint=null;
    new.approval_prepared_by=null;
    new.approval_prepared_at=null;
    new.approval_expires_at=null;
    new.approved_by=null;
    new.approved_at=null;
    new.idempotency_key=null;
    new.queued_at=null;
  end if;
  return new;
end;
$$;

drop trigger if exists review_reply_actions_invalidate_approval on public.review_reply_actions;
create trigger review_reply_actions_invalidate_approval
before update of reply_text on public.review_reply_actions
for each row execute function vps_lab_private.invalidate_reply_approval_on_draft_edit();

drop function if exists public.review_admin_prepare_reply_approval_scoped(uuid,uuid,uuid,uuid,text,text,integer);

create or replace function public.review_admin_prepare_reply_approval_scoped(
  p_action_id uuid,
  p_external_review_row_id uuid,
  p_company_id uuid,
  p_location_id uuid,
  p_external_location_id text,
  p_provider text,
  p_ttl_seconds integer default 600
)
returns table(action_id uuid,approval_fingerprint text,idempotency_key uuid,approval_expires_at timestamptz,reply_length integer)
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_review public.review_external_reviews%rowtype;
  v_action public.review_reply_actions%rowtype;
  v_fingerprint text;
  v_key uuid;
  v_expires timestamptz;
begin
  if not public.review_is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if not vps_lab_private.has_company(p_company_id) then
    raise exception using errcode='42501',message='COMPANY_ACCESS_DENIED';
  end if;
  if p_company_id is distinct from '13f3cb80-487a-4a19-96a1-fb3103200230'::uuid
     or p_location_id is distinct from '9a95f63b-18e6-447b-a449-8530b67ddbae'::uuid
     or p_external_location_id is distinct from '54309413522'
     or p_provider is distinct from 'yandex'
     or p_ttl_seconds is null or p_ttl_seconds < 60 or p_ttl_seconds > 1800
  then raise exception 'REVIEW_SCOPE_INVALID'; end if;

  select * into v_review from public.review_external_reviews r
  where r.id=p_external_review_row_id and r.company_id=p_company_id
    and r.location_id=p_location_id and r.provider=p_provider
    and r.external_location_id=p_external_location_id
  for update;
  if not found then raise exception 'REVIEW_NOT_FOUND'; end if;
  if v_review.owner_reply_text is not null then raise exception 'REVIEW_ALREADY_ANSWERED'; end if;

  select * into v_action from public.review_reply_actions a
  where a.id=p_action_id and a.external_review_row_id=v_review.id
    and a.company_id=p_company_id and a.provider=p_provider
  for update;
  if not found then raise exception 'REPLY_ACTION_NOT_FOUND'; end if;
  if v_action.status <> 'DRAFT' then raise exception 'REPLY_ACTION_NOT_DRAFT'; end if;
  if length(trim(v_action.reply_text)) < 1 then raise exception 'REPLY_TEXT_REQUIRED'; end if;
  if length(trim(v_action.reply_text)) > 2500 then raise exception 'REPLY_TEXT_TOO_LONG_FOR_PUBLISH'; end if;

  v_fingerprint:=vps_lab_private.reply_approval_fingerprint(
    v_action.id,v_action.external_review_id,v_action.reply_text,
    v_action.company_id,p_location_id,v_action.provider);
  v_key:=coalesce(v_action.idempotency_key,gen_random_uuid());
  v_expires:=clock_timestamp()+make_interval(secs=>p_ttl_seconds);

  update public.review_reply_actions
  set approval_fingerprint=v_fingerprint,
      approval_prepared_by=auth.uid(),
      approval_prepared_at=clock_timestamp(),
      approval_expires_at=v_expires,
      approved_by=null,approved_at=null,idempotency_key=v_key,
      queued_at=null,last_error=null,updated_at=clock_timestamp()
  where id=v_action.id and public.review_reply_actions.status='DRAFT';

  return query select v_action.id,v_fingerprint,v_key,v_expires,length(v_action.reply_text);
end;
$$;

create or replace function public.review_admin_approve_reply_scoped(
  p_action_id uuid,
  p_external_review_row_id uuid,
  p_company_id uuid,
  p_location_id uuid,
  p_external_location_id text,
  p_provider text,
  p_expected_fingerprint text
)
returns table(action_id uuid,idempotency_key uuid,status text,approval_expires_at timestamptz)
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_review public.review_external_reviews%rowtype;
  v_action public.review_reply_actions%rowtype;
  v_current text;
begin
  if not public.review_is_admin() then raise exception 'ADMIN_REQUIRED'; end if;
  if not vps_lab_private.has_company(p_company_id) then
    raise exception using errcode='42501',message='COMPANY_ACCESS_DENIED';
  end if;
  if p_company_id is distinct from '13f3cb80-487a-4a19-96a1-fb3103200230'::uuid
     or p_location_id is distinct from '9a95f63b-18e6-447b-a449-8530b67ddbae'::uuid
     or p_external_location_id is distinct from '54309413522'
     or p_provider is distinct from 'yandex'
     or p_expected_fingerprint is null
     or p_expected_fingerprint !~ '^[0-9a-f]{64}$'
  then raise exception 'REVIEW_SCOPE_INVALID'; end if;

  select * into v_review from public.review_external_reviews r
  where r.id=p_external_review_row_id and r.company_id=p_company_id
    and r.location_id=p_location_id and r.provider=p_provider
    and r.external_location_id=p_external_location_id
  for update;
  if not found then raise exception 'REVIEW_NOT_FOUND'; end if;
  if v_review.owner_reply_text is not null then raise exception 'REVIEW_ALREADY_ANSWERED'; end if;

  select * into v_action from public.review_reply_actions a
  where a.id=p_action_id and a.external_review_row_id=v_review.id
    and a.company_id=p_company_id and a.provider=p_provider
  for update;
  if not found then raise exception 'REPLY_ACTION_NOT_FOUND'; end if;
  if v_action.status <> 'DRAFT' then raise exception 'REPLY_ACTION_NOT_DRAFT'; end if;
  if v_action.approval_fingerprint is null or v_action.approval_expires_at is null
     or clock_timestamp() > v_action.approval_expires_at then
    raise exception 'REPLY_APPROVAL_EXPIRED';
  end if;
  if v_action.idempotency_key is null then raise exception 'REPLY_IDEMPOTENCY_NOT_PREPARED'; end if;

  v_current:=vps_lab_private.reply_approval_fingerprint(
    v_action.id,v_action.external_review_id,v_action.reply_text,
    v_action.company_id,p_location_id,v_action.provider);
  if v_current is distinct from v_action.approval_fingerprint
     or p_expected_fingerprint is distinct from v_action.approval_fingerprint then
    raise exception 'REPLY_APPROVAL_FINGERPRINT_MISMATCH';
  end if;

  update public.review_reply_actions
  set status='QUEUED',approved_by=auth.uid(),approved_at=clock_timestamp(),
      queued_at=clock_timestamp(),last_error=null,
      updated_at=clock_timestamp()
  where id=v_action.id and public.review_reply_actions.status='DRAFT';

  update public.review_external_reviews
  set reply_state='QUEUED'
  where id=v_review.id and owner_reply_text is null;

  return query
  select a.id,a.idempotency_key,a.status,a.approval_expires_at
  from public.review_reply_actions a where a.id=v_action.id;
end;
$$;

create or replace function public.review_admin_cancel_queued_reply_scoped(
  p_action_id uuid,
  p_external_review_row_id uuid,
  p_company_id uuid,
  p_location_id uuid,
  p_external_location_id text,
  p_provider text
)
returns boolean
language plpgsql
security definer
set search_path='pg_catalog','public'
as $$
declare
  v_review public.review_external_reviews%rowtype;
  v_count integer;
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

  select * into v_review from public.review_external_reviews r
  where r.id=p_external_review_row_id and r.company_id=p_company_id
    and r.location_id=p_location_id and r.provider=p_provider
    and r.external_location_id=p_external_location_id
  for update;
  if not found then raise exception 'REVIEW_NOT_FOUND'; end if;

  update public.review_reply_actions
  set status='DRAFT',
      approval_fingerprint=null,approval_prepared_by=null,approval_prepared_at=null,
      approval_expires_at=null,approved_by=null,approved_at=null,
      idempotency_key=null,queued_at=null,last_error=null,updated_at=clock_timestamp()
  where id=p_action_id and external_review_row_id=v_review.id
    and company_id=p_company_id and provider=p_provider and status='QUEUED';
  get diagnostics v_count=row_count;

  if v_count>0 and v_review.owner_reply_text is null then
    update public.review_external_reviews set reply_state='DRAFT'
    where id=v_review.id and reply_state='QUEUED';
  end if;
  return v_count>0;
end;
$$;

revoke all on function public.review_admin_prepare_reply_approval_scoped(uuid,uuid,uuid,uuid,text,text,integer)
from public,anon,service_role;
grant execute on function public.review_admin_prepare_reply_approval_scoped(uuid,uuid,uuid,uuid,text,text,integer)
to authenticated;

revoke all on function public.review_admin_approve_reply_scoped(uuid,uuid,uuid,uuid,text,text,text)
from public,anon,service_role;
grant execute on function public.review_admin_approve_reply_scoped(uuid,uuid,uuid,uuid,text,text,text)
to authenticated;

revoke all on function public.review_admin_cancel_queued_reply_scoped(uuid,uuid,uuid,uuid,text,text)
from public,anon,service_role;
grant execute on function public.review_admin_cancel_queued_reply_scoped(uuid,uuid,uuid,uuid,text,text)
to authenticated;

commit;
