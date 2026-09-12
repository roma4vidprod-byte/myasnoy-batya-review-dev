-- DEV verification only. Run using a trusted SQL connection to the verified Review Activator project.
-- No credentials, no real company scope, no scheduler execution; every transaction rolls back.

begin; set transaction read only; set local role anon;
do $$
begin
  begin
    perform public.review_public_request_due_syncs('invalid-fixture-token');
    raise exception 'TEST_FAILED_LEGACY_RPC_ALLOWED';
  exception when insufficient_privilege then null; end;
  begin
    perform public.review_enqueue_due_syncs('00000000-0000-4000-8000-000000000000'::uuid);
    raise exception 'TEST_FAILED_SCOPED_RPC_ALLOWED';
  exception when insufficient_privilege then null; end;
end;
$$;
select current_user::text as tested_role, 'PASS: both direct enqueue calls denied with 42501' as result,
  (select count(*) from public.review_public_sync_status('invalid-fixture-token')) as read_rows;
rollback;

begin; set transaction read only; set local role authenticated;
do $$
begin
  begin
    perform public.review_public_request_due_syncs('invalid-fixture-token');
    raise exception 'TEST_FAILED_LEGACY_RPC_ALLOWED';
  exception when insufficient_privilege then null; end;
  begin
    perform public.review_enqueue_due_syncs('00000000-0000-4000-8000-000000000000'::uuid);
    raise exception 'TEST_FAILED_SCOPED_RPC_ALLOWED';
  exception when insufficient_privilege then null; end;
end;
$$;
select current_user::text as tested_role, 'PASS: both direct enqueue calls denied with 42501' as result,
  (select count(*) from public.review_public_sync_status('invalid-fixture-token')) as read_rows;
rollback;

begin;
set local statement_timeout = '5s';
do $$
begin
  if exists(select 1 from public.review_companies where id='00000000-0000-4000-8000-000000000000'::uuid)
     or exists(select 1 from public.review_provider_connections where company_id='00000000-0000-4000-8000-000000000000'::uuid) then
    raise exception 'FIXTURE_COMPANY_MUST_NOT_EXIST';
  end if;
end;
$$;
set local role service_role;
select current_user::text as tested_role,
 public.review_enqueue_due_syncs('00000000-0000-4000-8000-000000000000'::uuid) as enqueued,
 'Absent fixture company; transaction rolled back; no real queue rows selected' as boundary;
rollback;
