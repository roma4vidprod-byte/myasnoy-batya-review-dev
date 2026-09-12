import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = read('../supabase/migrations/20260912095126_review_sync_server_boundary.sql');
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const LA = '33333333-3333-4333-8333-333333333333';
const LB = '44444444-4444-4444-8444-444444444444';
const LA2 = '55555555-5555-4555-8555-555555555555';
const insertReview = (company, location, provider = 'yandex') => `
 insert into public.review_external_reviews(company_id,location_id,provider,external_review_id,external_location_id,review_text)
 values ('${company}','${location}','${provider}','same-id','fixture-org','original')
`;

test('PostgreSQL migration, roles, scoped queue and index behavior (isolated in memory)', async t => {
  const db = await PGlite.create();
  t.after(() => db.close());
  await db.exec(read('./fixtures/db/review-sync-baseline.sql'));
  await db.exec(`
    insert into public.review_companies values ('${A}'),('${B}');
    insert into public.review_locations values ('${LA}','${A}'),('${LB}','${B}'),('${LA2}','${A}');
    insert into public.review_qr_sources values ('${LA}','fixture-a',true),('${LB}','fixture-b',true);
    insert into public.review_provider_connections(company_id,provider,status,last_error)
      values ('${A}','yandex','READY','synthetic-sensitive-marker'),('${A}','2gis','WAITING_ACCESS',null),('${B}','yandex','READY',null);
  `);
  await t.test('before: PUBLIC plus explicit anon/authenticated grants reproduce bypass', async () => {
    for (const role of ['anon','authenticated','service_role']) {
      const { rows } = await db.query(`select has_function_privilege('${role}','public.review_public_request_due_syncs(text)','EXECUTE') as allowed`);
      assert.equal(rows[0].allowed, true);
    }
  });
  await t.test('migration refuses active legacy job and rolls back', async () => {
    await db.exec('update cron.job set active=true');
    await assert.rejects(db.exec(migration), /PAUSE_REVIEW_DEV_SCHEDULER_FIRST/);
    await db.exec('rollback; update cron.job set active=false');
  });
  await t.test('the exact deployable migration applies', async () => {
    await db.exec(migration);
    const { rows } = await db.query(`select to_regprocedure('public.review_enqueue_due_syncs()') is null as old_removed,
      to_regprocedure('public.review_enqueue_due_syncs(uuid)') is not null as scoped_exists`);
    assert.deepEqual(rows[0], { old_removed: true, scoped_exists: true });
  });
  async function inRole(role, run) {
    await db.exec(`begin; set local role ${role}`);
    try { return await run(); } finally { await db.exec('rollback'); }
  }
  for (const role of ['anon','authenticated']) {
    await t.test(`${role}: direct legacy/scoped enqueue calls denied (SQLSTATE 42501)`, async () => {
      for (const sql of [
        "select public.review_public_request_due_syncs('fixture-a')",
        `select public.review_enqueue_due_syncs('${A}'::uuid)`
      ]) {
        await assert.rejects(inRole(role, () => db.query(sql)), { code: '42501' });
      }
    });
    await t.test(`${role}: status is readable, redacted, stable; cannot INSERT queue directly`, async () => {
      await inRole(role, async () => {
        const { rows } = await db.query("select * from public.review_public_sync_status('fixture-a')");
        assert.equal(rows.length, 2);
        assert.equal(rows.some(row => row.last_error === 'PROVIDER_SYNC_ERROR'), true);
        assert.equal(JSON.stringify(rows).includes('synthetic-sensitive-marker'), false);
      });
      await assert.rejects(inRole(role, () => db.exec(`insert into public.review_sync_runs(provider_connection_id,provider,status)
        values ('00000000-0000-4000-8000-000000000000','yandex','QUEUED')`)), { code: '42501' });
    });
  }
  await t.test('service_role: scoped engine allowed, company B unchanged, retry deterministic', async () => {
    await inRole('service_role', async () => {
      const beforeB = (await db.query(`select * from public.review_provider_connections where company_id='${B}'`)).rows;
      assert.equal((await db.query(`select public.review_enqueue_due_syncs('${A}'::uuid) as count`)).rows[0].count, 2);
      assert.equal((await db.query(`select public.review_enqueue_due_syncs('${A}'::uuid) as count`)).rows[0].count, 0);
      const runs = (await db.query(`select r.status,pc.company_id from public.review_sync_runs r
        join public.review_provider_connections pc on pc.id=r.provider_connection_id`)).rows;
      assert.equal(runs.length, 2);
      assert.equal(runs.every(r => r.company_id === A), true);
      assert.deepEqual(runs.map(r => r.status).sort(), ['QUEUED','SKIPPED_NOT_CONFIGURED']);
      assert.deepEqual((await db.query(`select * from public.review_provider_connections where company_id='${B}'`)).rows, beforeB);
      assert.equal((await db.query('select count(*)::integer as n from public.review_external_reviews')).rows[0].n, 0);
    });
  });
  await t.test('service_role cannot use legacy RPC or omit company; non-existent company is a no-op', async () => {
    await assert.rejects(inRole('service_role', () => db.query("select public.review_public_request_due_syncs('fixture-a')")), { code: '42501' });
    await assert.rejects(inRole('service_role', () => db.query('select public.review_enqueue_due_syncs(null::uuid)')), { code: '22023' });
    const value = await inRole('service_role', () => db.query("select public.review_enqueue_due_syncs('00000000-0000-4000-8000-000000000000'::uuid) as n"));
    assert.equal(value.rows[0].n, 0);
  });
  await t.test('retired function remains harmless even if EXECUTE is accidentally re-granted', async () => {
    await db.exec('begin; grant execute on function public.review_public_request_due_syncs(text) to anon; set local role anon');
    try {
      await assert.rejects(db.query("select public.review_public_request_due_syncs('fixture-a')"), error => error.code === '42501' && error.message === 'PUBLIC_SYNC_DISABLED');
    } finally { await db.exec('rollback'); }
  });
  await t.test('status has no mutation capability; enqueue uses invoker privileges', async () => {
    const { rows } = await db.query(`select proname,provolatile,prosecdef,prosrc from pg_proc
      where proname in ('review_public_sync_status','review_enqueue_due_syncs')`);
    const status = rows.find(r => r.proname === 'review_public_sync_status');
    assert.equal(status.provolatile, 's');
    assert.doesNotMatch(status.prosrc, /insert|update|delete|enqueue|request_due/i);
    assert.equal(rows.find(r => r.proname === 'review_enqueue_due_syncs').prosecdef, false);
    assert.equal((await db.query('select count(*)::integer as n from public.review_sync_runs')).rows[0].n, 0);
  });
  await t.test('current indexes reject same provider ID across companies and across locations', async () => {
    for (const [company, location] of [[B, LB], [A, LA2], [A, LA]]) {
      await db.exec('begin');
      try {
        await db.exec(insertReview(A, LA));
        await assert.rejects(db.exec(insertReview(company, location)), { code: '23505' });
      } finally { await db.exec('rollback'); }
    }
  });
  await t.test('current index allows distinct providers; unsafe global upsert demonstrates unresolved reassignment risk', async () => {
    await db.exec('begin');
    try {
      await db.exec(insertReview(A, LA));
      await db.exec(insertReview(B, LB, '2gis'));
      assert.equal((await db.query('select count(*)::integer as n from public.review_external_reviews')).rows[0].n, 2);
      // Deliberately unsafe SQL, LOCAL TEST ONLY: proves why a global conflict writer is forbidden.
      await db.exec(insertReview(B, LB) + ` on conflict(provider,external_review_id)
        do update set company_id=excluded.company_id,location_id=excluded.location_id`);
      assert.equal((await db.query("select company_id from public.review_external_reviews where provider='yandex'")).rows[0].company_id, B);
    } finally { await db.exec('rollback'); }
  });
  await t.test('candidate scoped index/FK plan: separate scopes allowed; same scope deterministic; bad company/location denied', async () => {
    await db.exec('begin');
    try {
      await db.exec(read('./fixtures/db/scoped-index-plan.sql'));
      await db.exec(insertReview(A, LA));
      await db.exec(insertReview(B, LB));
      await db.exec(insertReview(A, LA2));
      await db.exec(insertReview(A, LA) + ` on conflict(company_id,location_id,provider,external_review_id)
        do update set review_text='updated-same-scope'`);
      const rows = (await db.query('select company_id,location_id,review_text from public.review_external_reviews')).rows;
      assert.equal(rows.length, 3);
      assert.equal(rows.find(r => r.company_id === B).review_text, 'original');
      assert.equal(rows.find(r => r.location_id === LA).review_text, 'updated-same-scope');
      await db.exec('set constraints all immediate');
      await assert.rejects(db.exec(insertReview(A, LB, '2gis')), { code: '23503' });
    } finally { await db.exec('rollback'); }
  });
  await t.test('candidate index plan was rolled back: original global index still present', async () => {
    const { rows } = await db.query("select to_regclass('public.review_external_reviews_provider_external_id_uq') is not null as present");
    assert.equal(rows[0].present, true);
  });
});
