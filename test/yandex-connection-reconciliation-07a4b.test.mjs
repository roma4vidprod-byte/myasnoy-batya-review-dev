import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20260913200000_yandex_connection_state_reconciliation_07a4b.sql', import.meta.url), 'utf8');
const A = '13f3cb80-487a-4a19-96a1-fb3103200230';
const LA = '9a95f63b-18e6-447b-a449-8530b67ddbae';
const ORG = '54309413522';
const CONNECTION = '1a388488-fff9-48f8-a79c-52dc50e9db2b';
const LAST_SUCCESS = '2026-09-12T19:45:37.284055+00:00';

async function createDb() {
  const db = await PGlite.create();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema cron;
    create table cron.job(jobname text primary key, active boolean not null);
    insert into cron.job values ('review-provider-due-check-hourly', false);
    create schema review_private;
    create table review_private.yandex_sessions(
      company_id uuid not null,
      location_id uuid not null,
      external_org_id text not null,
      state text not null,
      primary key(company_id, location_id, external_org_id)
    );
    create table public.review_provider_connections(
      id uuid primary key,
      company_id uuid not null,
      provider text not null,
      enabled boolean not null default true,
      status text not null,
      config jsonb not null default '{}'::jsonb,
      sync_interval_minutes integer not null default 60,
      last_sync_requested_at timestamptz,
      last_sync_started_at timestamptz,
      last_sync_completed_at timestamptz,
      last_success_at timestamptz,
      next_sync_at timestamptz not null default now(),
      last_error text,
      updated_at timestamptz not null default now()
    );
    create table public.review_sync_runs(
      id uuid primary key default gen_random_uuid(),
      provider_connection_id uuid not null references public.review_provider_connections(id),
      provider text not null,
      status text not null,
      requested_at timestamptz not null default now(),
      finished_at timestamptz,
      error text,
      meta jsonb not null default '{}'::jsonb
    );
    grant usage on schema public, review_private to anon, authenticated, service_role;
    grant select, update on public.review_provider_connections to service_role;
    grant select, insert, update on public.review_sync_runs to service_role;
    grant select, update on review_private.yandex_sessions to service_role;
  `);
  await db.exec(migration);
  return db;
}

async function asPersistentRole(db, role, query) {
  await db.exec(`set role ${role}`);
  try { return await query(); } finally { await db.exec('reset role'); }
}

async function asRole(db, role, query) {
  await db.exec(`begin; set local role ${role}`);
  try { return await query(); } finally { await db.exec('rollback'); }
}

const call = (db, scope = { company: A, location: LA, org: ORG }) => db.query(
  `select public.review_reconcile_yandex_connection('${scope.company}'::uuid, '${scope.location}'::uuid, '${scope.org}') as result`
);

test('07A.4B reconciliation is scoped, idempotent and server-only', async t => {
  const db = await createDb();
  t.after(() => db.close());

  await t.test('READY session + stale decrypt error changes only connection state', async () => {
    await db.exec(`
      insert into public.review_provider_connections(
        id, company_id, provider, enabled, status, config, sync_interval_minutes,
        last_success_at, next_sync_at, last_error
      ) values (
        '${CONNECTION}', '${A}', 'yandex', true, 'ERROR',
        jsonb_build_object('location_id','${LA}','external_org_id','${ORG}'), 60,
        '${LAST_SUCCESS}'::timestamptz, '2030-01-01T00:00:00Z'::timestamptz,
        'SESSION_DECRYPT_FAILED'
      );
      insert into review_private.yandex_sessions(company_id, location_id, external_org_id, state)
        values ('${A}', '${LA}', '${ORG}', 'READY');
    `);
    const before = (await db.query(`select status, last_error, last_success_at, next_sync_at from public.review_provider_connections where id='${CONNECTION}'`)).rows[0];
    const first = await asPersistentRole(db, 'service_role', () => call(db));
    assert.deepEqual(first.rows[0].result, { ok: true, changed: true, status: 'READY', session_state: 'READY' });
    const after = (await db.query(`select status, last_error, last_success_at, next_sync_at from public.review_provider_connections where id='${CONNECTION}'`)).rows[0];
    assert.equal(after.status, 'READY');
    assert.equal(after.last_error, null);
    assert.equal(after.last_success_at.toISOString(), before.last_success_at.toISOString());
    assert.equal(after.next_sync_at.toISOString(), before.next_sync_at.toISOString());
    assert.equal((await db.query('select count(*)::int as n from public.review_sync_runs')).rows[0].n, 0);
  });

  await t.test('repeat is an unchanged no-op and does not create a run', async () => {
    const second = await asPersistentRole(db, 'service_role', () => call(db));
    assert.deepEqual(second.rows[0].result, { ok: true, changed: false, status: 'READY', session_state: 'READY' });
    assert.equal((await db.query('select count(*)::int as n from public.review_sync_runs')).rows[0].n, 0);
  });

  await t.test('NOT_CONFIGURED session and wrong scope are rejected without mutation', async () => {
    await db.exec(`
      update public.review_provider_connections set status='ERROR', last_error='SESSION_DECRYPT_FAILED' where id='${CONNECTION}';
      update review_private.yandex_sessions set state='NOT_CONFIGURED' where company_id='${A}'::uuid;
    `);
    await assert.rejects(asPersistentRole(db, 'service_role', () => call(db)), { code: '22023' });
    await assert.rejects(asPersistentRole(db, 'service_role', () => call(db, {
      company: '00000000-0000-4000-8000-000000000000', location: LA, org: ORG
    })), { code: '22023' });
    const row = (await db.query(`select status, last_error from public.review_provider_connections where id='${CONNECTION}'`)).rows[0];
    assert.deepEqual(row, { status: 'ERROR', last_error: 'SESSION_DECRYPT_FAILED' });
  });

  await t.test('anon/authenticated are denied; service_role can perform a no-op', async () => {
    await db.exec(`
      update public.review_provider_connections set status='READY', last_error=null where id='${CONNECTION}';
      update review_private.yandex_sessions set state='READY' where company_id='${A}'::uuid;
    `);
    for (const role of ['anon', 'authenticated']) {
      await assert.rejects(asRole(db, role, () => call(db)), { code: '42501' });
    }
    const allowed = await asPersistentRole(db, 'service_role', () => call(db));
    assert.deepEqual(allowed.rows[0].result, { ok: true, changed: false, status: 'READY', session_state: 'READY' });
  });
});

test('07A.4B migration has no queue mutation and grants only server roles', () => {
  assert.match(migration, /create or replace function public\.review_reconcile_yandex_connection\(\s*p_company_id uuid,\s*p_location_id uuid,\s*p_org_id text/s);
  assert.match(migration, /security invoker/);
  assert.match(migration, /review_private\.yandex_sessions/);
  assert.match(migration, /status = 'READY'/);
  assert.match(migration, /last_error = null/);
  assert.match(migration, /revoke all on function public\.review_reconcile_yandex_connection\(uuid, uuid, text\)\s+from public, anon, authenticated/s);
  assert.match(migration, /grant execute on function public\.review_reconcile_yandex_connection\(uuid, uuid, text\)\s+to service_role, postgres/s);
  assert.doesNotMatch(migration, /review_sync_runs|next_sync_at\s*=|last_success_at\s*=/);
});
