-- Administrative, evidence-attested recovery only. This migration does NOT recover a connection.
-- No HTTP endpoint, no worker-secret capability, no change to the old decrypt-only RPC.
-- The operator must independently verify project/DEV identity and approve the evidence.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
begin
  if current_user <> 'postgres' then
    raise exception using errcode='42501', message='RECOVERY_ADMIN_REQUIRED';
  end if;
  if to_regclass('review_private.yandex_contract_recoveries') is not null
     and obj_description(to_regclass('review_private.yandex_contract_recoveries'),'pg_class')
         is distinct from 'review-contract-recovery/operator-attested/v1' then
    raise exception using errcode='22023', message='RECOVERY_HISTORY_BASELINE_MISMATCH';
  end if;
  if to_regclass('review_private.yandex_sessions') is null
     or to_regclass('public.review_provider_connections') is null
     or to_regclass('public.review_sync_runs') is null then
    raise exception using errcode='22023', message='RECOVERY_BASELINE_REQUIRED';
  end if;
end;
$$;

-- Historical audit deliberately has no cascading FK to business records.
-- Only successful executions are inserted; declined operations change no business/audit rows.
create table if not exists review_private.yandex_contract_recoveries (
  request_id uuid primary key,
  connection_id uuid not null,
  company_id uuid not null,
  location_id uuid not null,
  external_org_id text not null,
  expected_session_revision bigint not null check(expected_session_revision > 0),
  connection_updated_at_before timestamptz not null,
  connection_updated_at_after timestamptz not null,
  session_updated_at timestamptz not null,
  approval_expires_at timestamptz not null,
  evidence jsonb not null check(jsonb_typeof(evidence)='object'),
  status_before text not null check(status_before='ERROR'),
  error_before text not null check(error_before='YANDEX_CONTRACT_DRIFT'),
  status_after text not null check(status_after='READY'),
  executed_by name not null,
  applied_at timestamptz not null,
  unique(connection_id, connection_updated_at_before)
);
comment on table review_private.yandex_contract_recoveries is 'review-contract-recovery/operator-attested/v1';
alter table review_private.yandex_contract_recoveries enable row level security;
alter table review_private.yandex_contract_recoveries force row level security;
revoke all on review_private.yandex_contract_recoveries from public, anon, authenticated, service_role;
-- Explicit admin-only policies avoid depending on the database owner's BYPASSRLS attribute.
drop policy if exists contract_recovery_admin_read on review_private.yandex_contract_recoveries;
create policy contract_recovery_admin_read on review_private.yandex_contract_recoveries for select to postgres using (true);
drop policy if exists contract_recovery_admin_insert on review_private.yandex_contract_recoveries;
create policy contract_recovery_admin_insert on review_private.yandex_contract_recoveries for insert to postgres with check (true);

create or replace function review_private.reject_contract_recovery_history_edit()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  raise exception using errcode='22023', message='RECOVERY_HISTORY_IMMUTABLE';
end;
$$;
revoke all on function review_private.reject_contract_recovery_history_edit() from public, anon, authenticated, service_role;
create or replace trigger yandex_contract_recoveries_immutable
before update or delete on review_private.yandex_contract_recoveries
for each row execute function review_private.reject_contract_recovery_history_edit();
create or replace trigger yandex_contract_recoveries_no_truncate
before truncate on review_private.yandex_contract_recoveries
for each statement execute function review_private.reject_contract_recovery_history_edit();

create or replace function review_private.recover_yandex_contract_connection(
  p_request_id uuid,
  p_connection_id uuid,
  p_company_id uuid,
  p_location_id uuid,
  p_org_id text,
  p_expected_session_revision bigint,
  p_expected_connection_updated_at timestamptz,
  p_evidence jsonb,
  p_approval_expires_at timestamptz
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_prior review_private.yandex_contract_recoveries%rowtype;
  v_connection record;
  v_session record;
  v_key text;
  v_pages integer;
  v_total integer;
  v_limit integer;
  v_now timestamptz;
  v_updated timestamptz;
  v_rows bigint;
begin
  -- ACL plus role guard; never grant this recovery capability to the application service role.
  if current_user <> 'postgres' then
    raise exception using errcode='42501', message='RECOVERY_ADMIN_REQUIRED';
  end if;
  if p_request_id is null or p_connection_id is null or p_company_id is null
     or p_location_id is null or p_org_id is null or p_org_id !~ '^[0-9]{1,32}$'
     or p_expected_session_revision is null or p_expected_session_revision < 1
     or p_expected_session_revision > 9007199254740991
     or p_expected_connection_updated_at is null
     or not isfinite(p_expected_connection_updated_at)
     or p_approval_expires_at is null or not isfinite(p_approval_expires_at) then
    raise exception using errcode='22023', message='RECOVERY_INPUT_INVALID';
  end if;

  -- This is an explicitly reviewed OPERATOR ATTESTATION, NOT a provider signature.
  -- Reject any unknown key; do not store raw diagnostics, cookie data, error messages or URLs.
  if jsonb_typeof(p_evidence) is distinct from 'object'
     or not (p_evidence ?& array[
       'basis','artifact_sha256','source_sha','deployment_id','company_id','location_id','org_id',
       'revision','operation','pretransport','decrypt','validation','completeness','provider_http_status',
       'pages_fetched','received_count','unique_count','reported_total','page_limit','max_pages','page_base',
       'transport_attempted','transport_completed','review_persistence','session_mutations',
       'connection_mutations','queue_mutations','notifications'])
     or p_evidence - array[
       'basis','artifact_sha256','source_sha','deployment_id','company_id','location_id','org_id',
       'revision','operation','pretransport','decrypt','validation','completeness','provider_http_status',
       'pages_fetched','received_count','unique_count','reported_total','page_limit','max_pages','page_base',
       'transport_attempted','transport_completed','review_persistence','session_mutations',
       'connection_mutations','queue_mutations','notifications'] <> '{}'::jsonb then
    raise exception using errcode='22023', message='RECOVERY_EVIDENCE_INVALID';
  end if;
  foreach v_key in array array['basis','artifact_sha256','source_sha','deployment_id','company_id',
    'location_id','org_id','operation','pretransport','decrypt','validation','completeness',
    'review_persistence','session_mutations','connection_mutations','queue_mutations','notifications'] loop
    if jsonb_typeof(p_evidence->v_key) is distinct from 'string' then
      raise exception using errcode='22023', message='RECOVERY_EVIDENCE_INVALID';
    end if;
  end loop;
  if p_evidence->>'basis' <> 'OPERATOR_ATTESTED_FULL_DIAGNOSTIC'
     or p_evidence->>'artifact_sha256' !~ '^[0-9a-f]{64}$'
     or p_evidence->>'source_sha' !~ '^[0-9a-f]{40}$'
     or p_evidence->>'deployment_id' !~ '^dpl_[A-Za-z0-9]{1,64}$'
     or p_evidence->>'company_id' <> p_company_id::text
     or p_evidence->>'location_id' <> p_location_id::text
     or p_evidence->>'org_id' <> p_org_id
     or p_evidence->>'operation' <> 'contract_diagnostic_full'
     or p_evidence->>'pretransport' <> 'PASS'
     or p_evidence->>'decrypt' <> 'PASS' or p_evidence->>'validation' <> 'PASS'
     or p_evidence->>'completeness' <> 'PASS'
     or p_evidence->>'review_persistence' <> 'OFF' or p_evidence->>'session_mutations' <> 'OFF'
     or p_evidence->>'connection_mutations' <> 'OFF' or p_evidence->>'queue_mutations' <> 'OFF'
     or p_evidence->>'notifications' <> 'OFF' then
    raise exception using errcode='22023', message='RECOVERY_EVIDENCE_INVALID';
  end if;
  if jsonb_typeof(p_evidence->'revision') is distinct from 'number'
     or p_evidence->>'revision' <> p_expected_session_revision::text then
    raise exception using errcode='22023', message='RECOVERY_EVIDENCE_INVALID';
  end if;
  foreach v_key in array array['provider_http_status','pages_fetched','received_count','unique_count',
    'reported_total','page_limit','max_pages','page_base','transport_attempted','transport_completed'] loop
    if jsonb_typeof(p_evidence->v_key) is distinct from 'number'
       or p_evidence->>v_key !~ '^(0|[1-9][0-9]{0,5})$' then
      raise exception using errcode='22023', message='RECOVERY_EVIDENCE_INVALID';
    end if;
  end loop;
  v_pages := (p_evidence->>'pages_fetched')::integer;
  v_total := (p_evidence->>'reported_total')::integer;
  v_limit := (p_evidence->>'page_limit')::integer;
  if (p_evidence->>'provider_http_status')::integer <> 200
     or (p_evidence->>'page_base')::integer <> 1
     or (p_evidence->>'max_pages')::integer not between 1 and 5
     or v_pages not between 1 and (p_evidence->>'max_pages')::integer
     or v_limit not between 1 and 1000
     or (p_evidence->>'received_count')::integer <> v_total
     or (p_evidence->>'unique_count')::integer <> v_total
     or (p_evidence->>'transport_attempted')::integer <> v_pages
     or (p_evidence->>'transport_completed')::integer <> v_pages then
    raise exception using errcode='22023', message='RECOVERY_EVIDENCE_INVALID';
  end if;
  if v_pages <> greatest(1, (v_total + v_limit - 1) / v_limit) then
    raise exception using errcode='22023', message='RECOVERY_EVIDENCE_INVALID';
  end if;

  -- Serialize duplicate request IDs, including accidental reuse for another connection.
  perform pg_advisory_xact_lock(hashtextextended('review-contract-recovery:' || p_request_id::text, 0));
  select * into v_prior from review_private.yandex_contract_recoveries where request_id=p_request_id;
  if found then
    if v_prior.connection_id is distinct from p_connection_id
       or v_prior.company_id is distinct from p_company_id or v_prior.location_id is distinct from p_location_id
       or v_prior.external_org_id is distinct from p_org_id
       or v_prior.expected_session_revision is distinct from p_expected_session_revision
       or v_prior.connection_updated_at_before is distinct from p_expected_connection_updated_at
       or v_prior.evidence is distinct from p_evidence
       or v_prior.approval_expires_at is distinct from p_approval_expires_at then
      raise exception using errcode='22023', message='RECOVERY_REQUEST_CONFLICT';
    end if;
    -- No mutation or renewed READY assertion. The state may have changed since recovery.
    return jsonb_build_object('ok',true,'outcome','ALREADY_APPLIED','changed',false,
      'request_id',p_request_id,'recorded_status','READY','current_status','NOT_CHECKED');
  end if;

  v_now := clock_timestamp();
  if p_approval_expires_at <= v_now or p_approval_expires_at > v_now + interval '1 hour' then
    raise exception using errcode='22023', message='RECOVERY_APPROVAL_INVALID';
  end if;
  -- Existing paused scheduler is a required operational precondition for this DEV recovery.
  if to_regclass('cron.job') is not null then
    perform 1 from cron.job where jobname='review-provider-due-check-hourly' for share;
    if exists(select 1 from cron.job where jobname='review-provider-due-check-hourly' and active) then
      raise exception using errcode='22023', message='RECOVERY_SCHEDULER_ACTIVE';
    end if;
  end if;

  select pc.id, pc.enabled, pc.status, pc.last_error, pc.updated_at into v_connection
    from public.review_provider_connections pc
   where pc.id=p_connection_id and pc.company_id=p_company_id and pc.provider='yandex'
     and pc.config->>'location_id'=p_location_id::text and pc.config->>'external_org_id'=p_org_id
   for update;
  if not found then
    raise exception using errcode='22023', message='RECOVERY_SCOPE_INVALID';
  end if;
  if v_connection.updated_at is distinct from p_expected_connection_updated_at then
    raise exception using errcode='22023', message='RECOVERY_CONNECTION_CHANGED';
  end if;
  if v_connection.enabled is distinct from true or v_connection.status is distinct from 'ERROR'
     or v_connection.last_error is distinct from 'YANDEX_CONTRACT_DRIFT' then
    raise exception using errcode='22023', message='RECOVERY_NOT_ALLOWED';
  end if;

  select ys.state, ys.revision, ys.updated_at, ys.last_session_check_at,
         ys.envelope is not null as has_material, ys.credential_version is not null as has_version,
         ys.last_error_code is null as error_clear
    into v_session from review_private.yandex_sessions ys
   where ys.company_id=p_company_id and ys.location_id=p_location_id and ys.external_org_id=p_org_id
   for share;
  if not found then
    raise exception using errcode='22023', message='RECOVERY_SESSION_NOT_READY';
  end if;
  if v_session.revision is distinct from p_expected_session_revision then
    raise exception using errcode='22023', message='RECOVERY_SESSION_CHANGED';
  end if;
  if v_session.state is distinct from 'READY' or not v_session.has_material or not v_session.has_version
     or not v_session.error_clear or v_session.last_session_check_at is null then
    raise exception using errcode='22023', message='RECOVERY_SESSION_NOT_READY';
  end if;
  if exists(select 1 from public.review_sync_runs where provider_connection_id=p_connection_id
            and status in ('QUEUED','RUNNING')) then
    raise exception using errcode='22023', message='RECOVERY_ACTIVE_RUN';
  end if;
  -- Approval may have expired while waiting on locks.
  if clock_timestamp() >= p_approval_expires_at then
    raise exception using errcode='22023', message='RECOVERY_APPROVAL_INVALID';
  end if;

  update public.review_provider_connections pc
     set status='READY', last_error=null, updated_at=clock_timestamp()
   where pc.id=p_connection_id and pc.company_id=p_company_id and pc.provider='yandex'
     and pc.enabled=true and pc.status='ERROR' and pc.last_error='YANDEX_CONTRACT_DRIFT'
     and pc.updated_at=p_expected_connection_updated_at
   returning pc.updated_at into v_updated;
  get diagnostics v_rows=row_count;
  if v_rows <> 1 then
    raise exception using errcode='22023', message='RECOVERY_CONNECTION_CHANGED';
  end if;
  insert into review_private.yandex_contract_recoveries (
    request_id,connection_id,company_id,location_id,external_org_id,expected_session_revision,
    connection_updated_at_before,connection_updated_at_after,session_updated_at,approval_expires_at,
    evidence,status_before,error_before,status_after,executed_by,applied_at
  ) values (
    p_request_id,p_connection_id,p_company_id,p_location_id,p_org_id,p_expected_session_revision,
    p_expected_connection_updated_at,v_updated,v_session.updated_at,p_approval_expires_at,
    p_evidence,'ERROR','YANDEX_CONTRACT_DRIFT','READY',current_user,clock_timestamp()
  );
  get diagnostics v_rows=row_count;
  if v_rows <> 1 then
    raise exception using errcode='22023', message='RECOVERY_AUDIT_FAILED';
  end if;
  return jsonb_build_object('ok',true,'outcome','APPLIED','changed',true,'request_id',p_request_id,
    'status','READY','session_revision',v_session.revision,'connection_updated_at',v_updated,
    'connection_rows',1,'audit_rows',v_rows);
  -- These are direct affected-row counts, not a claim about unknown external triggers.
end;
$$;
revoke all on function review_private.recover_yandex_contract_connection(uuid,uuid,uuid,uuid,text,bigint,timestamptz,jsonb,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function review_private.recover_yandex_contract_connection(uuid,uuid,uuid,uuid,text,bigint,timestamptz,jsonb,timestamptz) to postgres;
-- No grants on the private history to service_role, and no exposed PostgREST route.
commit;
