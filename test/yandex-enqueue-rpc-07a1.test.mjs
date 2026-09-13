import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20260913160000_yandex_enqueue_rpc_07a1_ambiguity_fix.sql', import.meta.url), 'utf8');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const LA = '33333333-3333-4333-8333-333333333333';
const LB = '44444444-4444-4444-8444-444444444444';
const ORG = '54309413522';

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
    create table public.review_companies(id uuid primary key);
    create table public.review_locations(id uuid primary key, company_id uuid not null references public.review_companies(id));
    create table public.review_provider_connections(
      id uuid primary key,
      company_id uuid not null references public.review_companies(id),
      provider text not null,
      enabled boolean not null default true,
      status text not null,
      config jsonb not null default '{}'::jsonb,
      sync_interval_minutes integer not null default 60,
      last_sync_requested_at timestamptz,
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
    grant select, insert, update on public.review_provider_connections, public.review_sync_runs to service_role;
    grant select on review_private.yandex_sessions to service_role;
  `);
  return db;
}

async function asRole(db, role, query) {
  await db.exec(`begin; set local role ${role}`);
  try { return await query(); } finally { await db.exec('rollback'); }
}

async function asPersistentRole(db, role, query) {
  await db.exec(`set role ${role}`);
  try { return await query(); } finally { await db.exec('reset role'); }
}

test('07A.1 enqueue regression removes 42702 and preserves scoped queue semantics', async t => {
  const db = await createDb();
  t.after(() => db.close());
  await db.exec(`
    insert into public.review_companies values ('${A}'), ('${B}');
    insert into public.review_locations values ('${LA}', '${A}'), ('${LB}', '${B}');
    insert into public.review_provider_connections(id,company_id,provider,status,config)
      values
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${A}','yandex','READY',jsonb_build_object('external_org_id','${ORG}','location_id','${LA}')),
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','${B}','yandex','READY',jsonb_build_object('external_org_id','${ORG}','location_id','${LB}'));
    insert into review_private.yandex_sessions(company_id,location_id,external_org_id,state)
      values ('${A}','${LA}','${ORG}','READY'), ('${B}','${LB}','${ORG}','READY');
  `);
  await db.exec(migration);

  for (const role of ['anon', 'authenticated']) {
    await t.test(`${role} is denied`, async () => {
      await assert.rejects(
        asRole(db, role, () => db.query(`select public.review_enqueue_due_syncs('${A}'::uuid)`)),
        { code: '42501' }
      );
    });
  }

  await t.test('service_role enqueues one exact scoped job without 42702', async () => {
    const result = await asPersistentRole(db, 'service_role', () => db.query(`select public.review_enqueue_due_syncs('${A}'::uuid) as enqueued`));
    assert.equal(result.rows[0].enqueued, 1);
    const { rows } = await db.query(`
      select r.status, pc.company_id, pc.config->>'location_id' as location_id,
             r.provider, r.meta->>'external_org_id' as external_org_id,
             r.meta->>'location_id' as meta_location_id
      from public.review_sync_runs r
      join public.review_provider_connections pc on pc.id=r.provider_connection_id
    `);
    assert.deepEqual(rows, [{ status: 'QUEUED', company_id: A, location_id: LA, provider: 'yandex', external_org_id: ORG, meta_location_id: LA }]);
  });

  await t.test('repeat enqueue is deterministic and isolated', async () => {
    const repeat = await asPersistentRole(db, 'service_role', () => db.query(`select public.review_enqueue_due_syncs('${A}'::uuid) as enqueued`));
    assert.equal(repeat.rows[0].enqueued, 0);
    const other = await asPersistentRole(db, 'service_role', () => db.query(`select public.review_enqueue_due_syncs('${B}'::uuid) as enqueued`));
    assert.equal(other.rows[0].enqueued, 1);
    const { rows } = await db.query(`select pc.company_id from public.review_sync_runs r join public.review_provider_connections pc on pc.id=r.provider_connection_id order by pc.company_id`);
    assert.deepEqual(rows.map(row => row.company_id), [A, B]);
  });

  await t.test('invalid input rolls back with no new run', async () => {
    const before = (await db.query('select count(*)::integer as n from public.review_sync_runs')).rows[0].n;
    await assert.rejects(asRole(db, 'service_role', () => db.query('select public.review_enqueue_due_syncs(null::uuid)')), { code: '22023' });
    const after = (await db.query('select count(*)::integer as n from public.review_sync_runs')).rows[0].n;
    assert.equal(after, before);
  });
});

test('07A.1 source explicitly qualifies columns and renames location variable', () => {
  assert.doesNotMatch(migration, /\blocation_id\s+uuid/);
  assert.match(migration, /v_location_id\s+uuid/);
  assert.match(migration, /pc\.company_id = p_company_id/);
  assert.match(migration, /ys\.location_id = v_location_id/);
  assert.match(migration, /grant execute on function public\.review_enqueue_due_syncs\(uuid\) to service_role, postgres/);
});
