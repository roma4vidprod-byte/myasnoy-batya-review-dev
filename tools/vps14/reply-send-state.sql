begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
set local search_path=pg_catalog,public;

do $$
begin
  if current_database() <> 'review_activator_lab' or current_user <> 'postgres'
     or (select version from vps_lab_private.version) <> 'vps04-auth-api-v1'
     or to_regclass('public.review_reply_actions') is null
     or not exists(
       select 1 from information_schema.columns
       where table_schema='public' and table_name='review_reply_actions'
         and column_name='approval_fingerprint'
     )
  then raise exception 'VPS14_SEND_INSTALL_GUARD'; end if;
end
$$;

do $$
begin
  if not exists(select 1 from pg_roles where rolname='review-yandex-writer') then
    create role "review-yandex-writer"
      login nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
end
$$;

grant connect on database review_activator_lab to "review-yandex-writer";
grant usage on schema vps_yandex_private to "review-yandex-writer";

drop function if exists vps_yandex_private.reply_worker_call(text,uuid,uuid,text);

create or replace function vps_yandex_private.reply_worker_claim_next()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_action public.review_reply_actions%rowtype;
  v_review public.review_external_reviews%rowtype;
  v_now timestamptz;
  v_expected text;
begin
  if session_user <> 'review-yandex-writer' then
    raise exception 'REPLY_WRITER_ROLE_DENIED';
  end if;

  loop
    v_now:=clock_timestamp();
    select a.* into v_action
    from public.review_reply_actions a
    join public.review_external_reviews r on r.id=a.external_review_row_id
    where a.status='QUEUED'
      and a.company_id='13f3cb80-487a-4a19-96a1-fb3103200230'::uuid
      and a.provider='yandex'
      and r.company_id=a.company_id
      and r.location_id='9a95f63b-18e6-447b-a449-8530b67ddbae'::uuid
      and r.provider='yandex'
      and r.external_location_id='54309413522'
      and r.external_review_id=a.external_review_id
    order by a.queued_at nulls last,a.created_at,a.id
    for update of a,r skip locked
    limit 1;

    if not found then return null; end if;

    select * into v_review
    from public.review_external_reviews
    where id=v_action.external_review_row_id
    for update;

    if v_action.idempotency_key is null
       or v_action.approval_fingerprint is null
       or v_action.approved_at is null
       or v_action.approval_expires_at is null
       or v_action.approved_at > v_now
       or v_action.approval_expires_at <= v_now
       or v_action.attempt_count <> 0
       or length(trim(v_action.reply_text)) < 1
       or length(trim(v_action.reply_text)) > 2500 then
      update public.review_reply_actions
      set status='FAILED',last_error='REPLY_APPROVAL_EXPIRED',
          finished_at=v_now,updated_at=v_now
      where id=v_action.id and status='QUEUED';
      if v_review.owner_reply_text is null then
        update public.review_external_reviews
        set reply_state='FAILED'
        where id=v_review.id and reply_state='QUEUED';
      end if;
      continue;
    end if;

    v_expected:=vps_lab_private.reply_approval_fingerprint(
      v_action.id,v_action.external_review_id,v_action.reply_text,
      v_action.company_id,'9a95f63b-18e6-447b-a449-8530b67ddbae'::uuid,
      v_action.provider
    );
    if v_expected is distinct from v_action.approval_fingerprint then
      update public.review_reply_actions
      set status='FAILED',last_error='REPLY_APPROVAL_INVALID',
          finished_at=v_now,updated_at=v_now
      where id=v_action.id and status='QUEUED';
      if v_review.owner_reply_text is null then
        update public.review_external_reviews
        set reply_state='FAILED'
        where id=v_review.id and reply_state='QUEUED';
      end if;
      continue;
    end if;

    if v_review.owner_reply_text is not null then
      update public.review_reply_actions
      set status='FAILED',last_error='REVIEW_ALREADY_ANSWERED',
          finished_at=v_now,updated_at=v_now
      where id=v_action.id and status='QUEUED';
      update public.review_external_reviews
      set reply_state='SYNCED_EXTERNAL'
      where id=v_review.id;
      continue;
    end if;

    update public.review_reply_actions
    set status='SENDING',attempt_count=attempt_count+1,
        sending_started_at=v_now,last_error=null,updated_at=v_now
    where id=v_action.id and status='QUEUED'
    returning * into v_action;

    if not found then continue; end if;

    return jsonb_build_object(
      'status','SENDING',
      'action_id',v_action.id,
      'external_review_id',v_action.external_review_id,
      'reply_text',v_action.reply_text,
      'idempotency_key',v_action.idempotency_key,
      'approval_fingerprint',v_action.approval_fingerprint,
      'approved_at_ms',floor(extract(epoch from v_action.approved_at)*1000)::bigint,
      'approval_expires_at_ms',
        floor(extract(epoch from v_action.approval_expires_at)*1000)::bigint,
      'attempt_count',v_action.attempt_count
    );
  end loop;
end
$$;

revoke all on function vps_yandex_private.reply_worker_claim_next()
from public,anon,authenticated,service_role;
grant execute on function vps_yandex_private.reply_worker_claim_next()
to "review-yandex-writer";

create or replace function vps_yandex_private.reply_worker_finish(
  p_operation text,
  p_action_id uuid,
  p_idempotency_key uuid,
  p_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_action public.review_reply_actions%rowtype;
  v_review public.review_external_reviews%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_error text;
begin
  if session_user <> 'review-yandex-writer' then
    raise exception 'REPLY_WRITER_ROLE_DENIED';
  end if;
  if p_action_id is null or p_idempotency_key is null
     or p_operation not in ('complete','fail') then
    raise exception 'REPLY_WRITER_INPUT_INVALID';
  end if;

  select a.* into v_action
  from public.review_reply_actions a
  join public.review_external_reviews r on r.id=a.external_review_row_id
  where a.id=p_action_id
    and a.idempotency_key=p_idempotency_key
    and a.company_id='13f3cb80-487a-4a19-96a1-fb3103200230'::uuid
    and a.provider='yandex'
    and r.company_id=a.company_id
    and r.location_id='9a95f63b-18e6-447b-a449-8530b67ddbae'::uuid
    and r.provider='yandex'
    and r.external_location_id='54309413522'
    and r.external_review_id=a.external_review_id
  for update of a;
  if not found then raise exception 'REPLY_WRITER_ACTION_NOT_FOUND'; end if;

    select * into v_review
  from public.review_external_reviews
  where id=v_action.external_review_row_id
  for update;

  if v_action.status <> 'SENDING' then
    raise exception 'REPLY_WRITER_STATE_CONFLICT';
  end if;

  if p_operation='complete' then
    update public.review_reply_actions
    set status='SENT',sent_at=v_now,finished_at=v_now,
        last_error=null,updated_at=v_now
    where id=v_action.id and status='SENDING'
      and idempotency_key=p_idempotency_key;

    update public.review_external_reviews
    set reply_state=case
      when owner_reply_text is null then 'SENT'
      else 'SYNCED_EXTERNAL'
    end
    where id=v_review.id;

    return jsonb_build_object(
      'status','SENT','action_id',v_action.id
    );
  end if;

  v_error:=case when p_error_code in (
    'YANDEX_REPLY_APPROVAL_INVALID',
    'YANDEX_REPLY_REVIEW_NOT_FOUND',
    'YANDEX_REPLY_ALREADY_ANSWERED',
    'YANDEX_REPLY_REVIEWS_CSRF_MISSING',
    'YANDEX_REPLY_DISCOVERY_DRIFT',
    'YANDEX_REPLY_CSRF_BOOTSTRAP_NETWORK',
    'YANDEX_REPLY_CSRF_BOOTSTRAP_DRIFT',
    'YANDEX_REPLY_HTTP_401',
    'YANDEX_REPLY_HTTP_403',
    'YANDEX_REPLY_REDIRECT',
    'YANDEX_REPLY_RATE_LIMITED',
    'YANDEX_REPLY_CHALLENGE',
    'YANDEX_REPLY_HTML',
    'YANDEX_REPLY_RESPONSE_DRIFT',
    'YANDEX_REPLY_RESPONSE_TOO_LARGE',
    'YANDEX_REPLY_RESULT_UNKNOWN',
    'YANDEX_REPLY_OPERATION_FAILED'
  ) then p_error_code else 'YANDEX_REPLY_OPERATION_FAILED' end;

  update public.review_reply_actions
  set status='FAILED',last_error=v_error,
      finished_at=v_now,updated_at=v_now
  where id=v_action.id and status='SENDING'
    and idempotency_key=p_idempotency_key;

  update public.review_external_reviews
  set reply_state=case
    when owner_reply_text is null then 'FAILED'
    else 'SYNCED_EXTERNAL'
  end
  where id=v_review.id;

  return jsonb_build_object(
    'status','FAILED','action_id',v_action.id,'error',v_error
  );
end
$$;

revoke all on function vps_yandex_private.reply_worker_finish(text,uuid,uuid,text)
from public,anon,authenticated,service_role;
grant execute on function vps_yandex_private.reply_worker_finish(text,uuid,uuid,text)
to "review-yandex-writer";

create or replace function vps_lab_private.sync_external_reply_state()
returns trigger
language plpgsql
security invoker
set search_path=''
as $$
begin
  if new.owner_reply_text is not null then
    new.reply_state='SYNCED_EXTERNAL';
  end if;
  return new;
end
$$;

drop trigger if exists review_external_reviews_sync_reply_state
on public.review_external_reviews;
create trigger review_external_reviews_sync_reply_state
before insert or update of owner_reply_text on public.review_external_reviews
for each row execute function vps_lab_private.sync_external_reply_state();

revoke all on function vps_lab_private.sync_external_reply_state()
from public,anon,authenticated,service_role,"review-yandex-writer";

alter role "review-yandex-writer" set log_statement='none';
alter role "review-yandex-writer" set log_min_error_statement='panic';
alter role "review-yandex-writer" set log_min_duration_statement=-1;
alter role "review-yandex-writer" set log_parameter_max_length_on_error=0;
alter role "review-yandex-writer" set log_error_verbosity='terse';

commit;
