-- Yandex Session Transport v1. DEV proposal; no credentials or review writes.
begin;
set local lock_timeout = '5s';
create schema review_private;
revoke all on schema review_private from public, anon, authenticated;
grant usage on schema review_private to service_role;
alter table public.review_locations add constraint review_locations_id_company_uq unique(id,company_id);

create table review_private.yandex_sessions (
  company_id uuid not null references public.review_companies(id) on delete cascade,
  location_id uuid not null,
  external_org_id text not null check(external_org_id='54309413522'),
  credential_version uuid,
  envelope jsonb,
  revision bigint not null default 1 check(revision>0),
  state text not null default 'NOT_CONFIGURED' check(state in ('NOT_CONFIGURED','READY','REAUTH_REQUIRED','ERROR','DISABLED')),
  last_session_check_at timestamptz,
  last_successful_sync_at timestamptz,
  last_error_code text check(last_error_code in (
    'YANDEX_HTTP_401','YANDEX_HTTP_403','YANDEX_LOGIN_REDIRECT','YANDEX_LOGIN_HTML','YANDEX_CHALLENGE',
    'YANDEX_MALFORMED_JSON','YANDEX_CONTRACT_DRIFT','YANDEX_PAGINATION_CHANGED','YANDEX_PAGINATION_LIMIT_EXCEEDED',
    'YANDEX_NETWORK_ERROR','YANDEX_HTTP_ERROR','YANDEX_RESPONSE_TOO_LARGE','SESSION_DECRYPT_FAILED',
    'SESSION_COOKIE_INVALID','PAGE_BASE_AMBIGUOUS','PAGE_BASE_MISMATCH','REVIEW_SCOPE_COLLISION','SESSION_OPERATION_FAILED'
  )),
  incident_id uuid,
  alert_claimed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key(company_id,location_id,external_org_id),
  foreign key(location_id,company_id) references public.review_locations(id,company_id) on delete cascade,
  check ((envelope is null) = (credential_version is null)),
  check (state <> 'READY' or (envelope is not null and last_session_check_at is not null)),
  check (envelope is null or (
    jsonb_typeof(envelope)='object' and envelope - array['v','kid','iv','tag','ciphertext'] = '{}'::jsonb
    and envelope->'v'='1'::jsonb
    and jsonb_typeof(envelope->'kid')='string' and envelope->>'kid' ~ '^[A-Za-z0-9_-]{1,64}$'
    and jsonb_typeof(envelope->'iv')='string' and jsonb_typeof(envelope->'tag')='string'
    and jsonb_typeof(envelope->'ciphertext')='string'
    and envelope->>'iv' ~ '^[A-Za-z0-9+/]{16}$'
    and envelope->>'tag' ~ '^[A-Za-z0-9+/]{22}==$'
    and length(envelope->>'ciphertext') between 4 and 90000
    and envelope->>'ciphertext' ~ '^[A-Za-z0-9+/]+={0,2}$'
    and envelope ?& array['v','kid','iv','tag','ciphertext']
  ) is true)
);
alter table review_private.yandex_sessions enable row level security;
alter table review_private.yandex_sessions force row level security;
revoke all on review_private.yandex_sessions from public,anon,authenticated;
grant select,insert,update on review_private.yandex_sessions to service_role;

-- One scoped storage/CAS boundary. INVOKER: service-role privileges, never public definer.
create function public.review_yandex_session_store(
  p_company_id uuid, p_location_id uuid, p_org_id text, p_action text,
  p_expected_revision bigint default null, p_data jsonb default '{}'::jsonb
) returns jsonb language plpgsql security invoker set search_path=''
as $$
declare
  row_data review_private.yandex_sessions%rowtype;
  next_state text;
  error_code text;
  auth_ok boolean;
  sync_ok boolean;
begin
  if p_company_id is null or p_location_id is null or p_org_id is distinct from '54309413522' then
    raise exception 'SESSION_SCOPE_INVALID';
  end if;
  if not exists(select 1 from public.review_locations where id=p_location_id and company_id=p_company_id) then
    raise exception 'SESSION_SCOPE_INVALID';
  end if;
  if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'SESSION_INPUT_INVALID'; end if;
  if p_action='snapshot' then
    if jsonb_typeof(p_data->'ids') is distinct from 'array' or jsonb_array_length(p_data->'ids')>10000 then
      raise exception 'SESSION_INPUT_INVALID';
    end if;
    -- Read identity-only collisions across scopes, never raw reviews/session data.
    return (select coalesce(jsonb_agg(jsonb_build_object(
      'company_id',company_id,'location_id',location_id,'provider',provider,
      'external_review_id',external_review_id,'external_location_id',external_location_id
    )),'[]'::jsonb) from public.review_external_reviews
      where provider='yandex' and external_review_id in (select jsonb_array_elements_text(p_data->'ids')));
  end if;
  if p_action='read' then
    select * into row_data from review_private.yandex_sessions
      where company_id=p_company_id and location_id=p_location_id and external_org_id=p_org_id;
    return case when found then to_jsonb(row_data) else null end;
  end if;
  if p_expected_revision is null or p_expected_revision<0 then raise exception 'SESSION_REVISION_REQUIRED'; end if;
  if p_action='replace' then
    if p_data - array['credential_version','envelope'] <> '{}'::jsonb
      or p_data->'envelope' is null or p_data->'envelope'='null'::jsonb
      or p_data->>'credential_version' is null then raise exception 'SESSION_INPUT_INVALID'; end if;
    if p_expected_revision=0 then
      insert into review_private.yandex_sessions(company_id,location_id,external_org_id,credential_version,envelope)
        values(p_company_id,p_location_id,p_org_id,(p_data->>'credential_version')::uuid,p_data->'envelope')
        on conflict(company_id,location_id,external_org_id) do nothing returning * into row_data;
    else
      update review_private.yandex_sessions set
        credential_version=(p_data->>'credential_version')::uuid,envelope=p_data->'envelope',
        revision=revision+1,state='NOT_CONFIGURED',last_session_check_at=null,last_error_code=null,
        incident_id=null,alert_claimed=false,updated_at=now()
      where company_id=p_company_id and location_id=p_location_id and external_org_id=p_org_id
        and revision=p_expected_revision returning * into row_data;
    end if;
    if not found then raise exception 'SESSION_CHANGED'; end if;
    return to_jsonb(row_data) - 'envelope';
  end if;

  select * into row_data from review_private.yandex_sessions
    where company_id=p_company_id and location_id=p_location_id and external_org_id=p_org_id for update;
  if not found or row_data.revision<>p_expected_revision then raise exception 'SESSION_CHANGED'; end if;
  if p_action='claim_alert' then
    if row_data.state not in ('ERROR','REAUTH_REQUIRED') or row_data.alert_claimed then
      return jsonb_build_object('claimed',false);
    end if;
    update review_private.yandex_sessions set alert_claimed=true
      where company_id=p_company_id and location_id=p_location_id and external_org_id=p_org_id;
    return jsonb_build_object('claimed',true,'incident_id',row_data.incident_id);
  end if;
  if p_action='transition' then
    if p_data - array['state','error_code','auth_ok','sync_ok'] <> '{}'::jsonb then raise exception 'SESSION_INPUT_INVALID'; end if;
    next_state:=p_data->>'state'; error_code:=p_data->>'error_code';
    auth_ok:=coalesce((p_data->>'auth_ok')::boolean,false); sync_ok:=coalesce((p_data->>'sync_ok')::boolean,false);
    if next_state is null or next_state not in ('READY','REAUTH_REQUIRED','ERROR','DISABLED')
       or row_data.state='DISABLED'
       or (next_state='READY' and (not auth_ok or error_code is not null or row_data.envelope is null))
       or (next_state in ('ERROR','REAUTH_REQUIRED') and error_code is null)
       or (next_state<>'READY' and (auth_ok or sync_ok)) then raise exception 'SESSION_TRANSITION_INVALID'; end if;
    update review_private.yandex_sessions set
      state=next_state,last_error_code=error_code,
      last_session_check_at=case when auth_ok then now() else last_session_check_at end,
      last_successful_sync_at=case when sync_ok then now() else last_successful_sync_at end,
      incident_id=case when next_state in ('ERROR','REAUTH_REQUIRED') then
        case when state=next_state then coalesce(incident_id,gen_random_uuid()) else gen_random_uuid() end else null end,
      alert_claimed=case when state=next_state then alert_claimed else false end,
      envelope=case when next_state='DISABLED' then null else envelope end,
      credential_version=case when next_state='DISABLED' then null else credential_version end,
      revision=revision+1,updated_at=now()
    where company_id=p_company_id and location_id=p_location_id and external_org_id=p_org_id
      returning * into row_data;
    return to_jsonb(row_data) - 'envelope';
  end if;
  raise exception 'SESSION_ACTION_INVALID';
end;
$$;
revoke all on function public.review_yandex_session_store(uuid,uuid,text,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.review_yandex_session_store(uuid,uuid,text,text,bigint,jsonb) to service_role;
-- No changes to cron.job, public reviews, queue, Matching or notification tables.
notify pgrst, 'reload schema';
commit;
