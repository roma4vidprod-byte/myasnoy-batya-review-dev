// Synthetic-only schema subset: no remote credentials, no transport, no production rows.
export const ids = Object.freeze({
  company:'11111111-1111-4111-8111-111111111111',
  location:'22222222-2222-4222-8222-222222222222',
  connection:'33333333-3333-4333-8333-333333333333',
  otherCompany:'44444444-4444-4444-8444-444444444444',
  otherLocation:'55555555-5555-4555-8555-555555555555',
  otherConnection:'66666666-6666-4666-8666-666666666666',
  request:'77777777-7777-4777-8777-777777777777',
  otherRequest:'88888888-8888-4888-8888-888888888888',
  org:'54309413522', revision:13, connectionTime:'2020-01-01T00:00:00.000Z'
});
export const fixtureSql = `
create role anon; create role authenticated; create role service_role;
create schema review_private; create schema cron;
grant usage on schema public,review_private to service_role;
create table cron.job(jobid bigint primary key,jobname text,active boolean);
insert into cron.job values(1,'review-provider-due-check-hourly',false);
create table public.review_provider_connections (
 id uuid primary key, company_id uuid not null, provider text not null,
 enabled boolean not null, status text not null,last_error text,config jsonb not null,
 updated_at timestamptz not null,next_sync_at timestamptz,
 last_sync_requested_at timestamptz,last_sync_started_at timestamptz,
 last_sync_completed_at timestamptz,last_success_at timestamptz,
 unique(company_id,provider)
);
create table review_private.yandex_sessions (
 company_id uuid not null,location_id uuid not null,external_org_id text not null,
 state text not null,revision bigint not null,envelope jsonb,credential_version uuid,
 last_error_code text,last_session_check_at timestamptz,last_successful_sync_at timestamptz,
 updated_at timestamptz not null,primary key(company_id,location_id,external_org_id)
);
create table public.review_sync_runs(id uuid primary key,provider_connection_id uuid not null references public.review_provider_connections(id),
 status text not null,error text,meta jsonb);
create table public.review_external_reviews(id uuid primary key,company_id uuid,location_id uuid,
 provider text,external_review_id text,review_text text);
insert into public.review_provider_connections values
 ('${ids.connection}','${ids.company}','yandex',true,'ERROR','YANDEX_CONTRACT_DRIFT',
  '{"location_id":"${ids.location}","external_org_id":"${ids.org}"}',
  '2020-01-01T00:00:00Z','2020-01-02T00:00:00Z','2020-01-01T00:00:00Z','2020-01-01T00:00:00Z',null,null),
 ('${ids.otherConnection}','${ids.otherCompany}','yandex',true,'ERROR','YANDEX_CONTRACT_DRIFT',
  '{"location_id":"${ids.otherLocation}","external_org_id":"${ids.org}"}',
  '2020-01-01','2020-01-02','2020-01-01','2020-01-01',null,null);
insert into review_private.yandex_sessions values
 ('${ids.company}','${ids.location}','${ids.org}','READY',13,'{"synthetic":true}',
  '99999999-9999-4999-8999-999999999999',null,'2020-01-03','2019-01-01','2020-01-03');
insert into public.review_sync_runs values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${ids.connection}','FAILED','YANDEX_CONTRACT_DRIFT','{"synthetic":true}'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','${ids.connection}','FAILED','SESSION_DECRYPT_FAILED','{}'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','${ids.connection}','SKIPPED_NOT_CONFIGURED',null,'{}');
insert into public.review_external_reviews values
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','${ids.company}','${ids.location}','yandex','synthetic-id','synthetic text');
grant select,update on public.review_provider_connections,public.review_sync_runs to service_role;
grant select on review_private.yandex_sessions to service_role;
`;
export function evidence(overrides={}) {
 return {
  basis:'OPERATOR_ATTESTED_FULL_DIAGNOSTIC',artifact_sha256:'a'.repeat(64),
  source_sha:'b'.repeat(40),deployment_id:'dpl_SYNTHETICONLY',company_id:ids.company,
  location_id:ids.location,org_id:ids.org,revision:13,operation:'contract_diagnostic_full',
  pretransport:'PASS',decrypt:'PASS',validation:'PASS',completeness:'PASS',provider_http_status:200,
  pages_fetched:4,received_count:69,unique_count:69,reported_total:69,page_limit:20,
  max_pages:5,page_base:1,transport_attempted:4,transport_completed:4,
  review_persistence:'OFF',session_mutations:'OFF',connection_mutations:'OFF',queue_mutations:'OFF',
  notifications:'OFF',...overrides
 };
}
export const rpcSql = `select review_private.recover_yandex_contract_connection(
 $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text,$6::bigint,$7::timestamptz,$8::jsonb,$9::timestamptz
) as result`;
export function args(overrides={}) {
 const a = {...ids, expires:new Date(Date.now()+15*60_000).toISOString(),evidence:evidence(),...overrides};
 return [a.request,a.connection,a.company,a.location,a.org,a.revision,a.connectionTime,JSON.stringify(a.evidence),a.expires];
}
