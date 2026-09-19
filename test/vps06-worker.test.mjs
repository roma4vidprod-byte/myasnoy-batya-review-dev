import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runOnce, profileGuard, processSynthetic, validateSyntheticClaim, validateConfig,
  COMPANY, LOCATION, CONNECTION, ORG } from '../tools/vps06/worker.mjs';
import { singleSyncRun } from '../lib/server/single-sync-run.js';
import { rpcAdapter, safeError } from '../tools/vps06/pg.mjs';

const env = { RA_RUNTIME_PROFILE: 'vps-lab', RA_WORKER_PROVIDER: 'synthetic-vps06' };
const config = { mode: 'synthetic-vps06', location_id: LOCATION, external_org_id: ORG };
const claim = { claimed: true, company_id: COMPANY, provider_connection_id: CONNECTION, provider: 'yandex',
  external_account_id: 'vps06-synthetic', config, run_id: '63000000-0000-4000-8000-000000000006' };
function boundary(options = {}) {
  const calls = [];
  let closes = 0;
  const db = { async query(sql) {
    calls.push(sql);
    if (options.failure && sql.includes(options.failure)) throw safeError('DB_OPERATION_FAILED');
    if (sql.includes("'db',current_database()")) return { db: 'review_activator_lab', role: 'review-activator', version: 170011, lab: 'vps04-auth-api-v1' };
    if (sql.includes('pg_try_advisory_xact_lock')) return options.lock !== false;
    if (sql.includes('coalesce(json_agg')) return options.empty ? [] : [{ id: CONNECTION, config, enabled: true, status: 'READY' }];
    if (sql.includes('review_enqueue_due_syncs')) return 0;
    if (sql.includes('review_claim_next_sync_run')) return options.empty ? { claimed: false } : claim;
    if (sql.includes("'meta',meta")) return { fresh: !options.stale, meta: { vps06: { operation: options.fail ? 'fail' : 'success', delay_ms: 0 } } };
    if (sql.includes('review_complete_sync_run')) return { status: 'SUCCEEDED' };
    if (sql.includes('review_fail_sync_run')) return { status: 'FAILED' };
    return null;
  }, close() { closes++; }, abort() {} };
  return { db, calls, get closes() { return closes; } };
}
for (const bad of [{}, { ...env, RA_RUNTIME_PROFILE: 'cloud-dev' }, { ...env, RA_RUNTIME_PROFILE: 'other' },
  { ...env, RA_WORKER_PROVIDER: undefined }, { ...env, RA_WORKER_PROVIDER: 'yandex' },
  { ...env, SUPABASE_URL: 'forbidden' }, { ...env, YANDEX_SESSION_KEYS_JSON: 'synthetic' },
  { ...env, DATABASE_URL: 'synthetic' }]) {
  test(`profile guard before connection ${JSON.stringify(Object.keys(bad))} ${bad.RA_RUNTIME_PROFILE}`, async () => {
    let connected = 0;
    await assert.rejects(runOnce({ env: bad, connect: () => { connected++; } }));
    assert.equal(connected, 0);
  });
}
test('valid explicit synthetic profile', () => profileGuard(env));
test('empty queue commits no business work, no provider', async () => {
  const b = boundary({ empty: true });
  const result = await runOnce({ env, connect: () => b.db });
  assert.equal(result.code, 'EMPTY'); assert.equal(result.provider_calls, 0);
  assert.equal(b.calls.filter(x => x.includes('complete_sync')).length, 0);
  assert.equal(b.closes, 1); assert.ok(b.calls.includes('commit;'));
});
test('one invocation claims and completes exactly one', async () => {
  const b = boundary(); const result = await runOnce({ env, connect: () => b.db });
  assert.equal(result.code, 'COMPLETED'); assert.equal(result.mode, 'synthetic');
  for (const rpc of ['enqueue_due','claim_next','complete']) assert.equal(b.calls.filter(x => x.includes(`review_${rpc}`)).length, 1);
  assert.equal(b.calls.filter(x => x.includes('review_fail')).length, 0);
});
test('busy advisory lock exits before enqueue/claim', async () => {
  const b = boundary({ lock: false }); const result = await runOnce({ env, connect: () => b.db });
  assert.equal(result.code, 'ALREADY_RUNNING'); assert.ok(b.calls.includes('rollback;'));
  assert.ok(!b.calls.some(x => x.includes('review_')));
});
for (const failure of ["'db',current_database()", 'review_enqueue_due_syncs', 'review_claim_next_sync_run', 'review_complete_sync_run']) {
  test(`SQL failure rollback no retry: ${failure}`, async () => {
    const b = boundary({ failure });
    await assert.rejects(runOnce({ env, connect: () => b.db }), { code: 'DB_OPERATION_FAILED' });
    assert.ok(b.calls.includes('rollback;')); assert.ok(!b.calls.includes('commit;'));
    assert.equal(b.calls.filter(x => x.includes('review_fail')).length, 0);
    assert.equal(b.calls.filter(x => x.includes(failure)).length, 1);
  });
}
for (const options of [{ fail: true }, { stale: true }]) {
  test(`invalid/failed work fails once ${JSON.stringify(options)}`, async () => {
    const b = boundary(options); const result = await runOnce({ env, connect: () => b.db });
    assert.equal(result.code, 'PROCESS_FAILED');
    assert.equal(b.calls.filter(x => x.includes('review_fail')).length, 1);
    assert.ok(!b.calls.some(x => x.includes('review_complete'))); assert.ok(b.calls.includes('commit;'));
  });
}
test('unexpected processor error is sanitized and fail RPC once', async () => {
  const b = boundary();
  const result = await runOnce({ env, connect: () => b.db, processor() { throw Error('DO_NOT_PRINT_SYNTHETIC_SECRET'); } });
  assert.equal(result.code, 'PROCESS_FAILED'); assert.ok(!JSON.stringify(result).includes('DO_NOT_PRINT'));
  assert.equal(b.calls.filter(x => x.includes('review_fail')).length, 1);
});
for (const field of ['company_id','provider_connection_id','provider','external_account_id']) {
  test(`wrong claim ${field} denied`, () => assert.throws(() => validateSyntheticClaim({ ...claim, [field]: 'wrong' })));
}
test('wrong location/org config denied', () => {
  assert.throws(() => validateConfig({ ...config, location_id: COMPANY }));
  assert.throws(() => validateConfig({ ...config, external_org_id: 'real' }));
  assert.throws(() => validateConfig({ ...config, extra: true }));
});
test('synthetic operation has no fallback', async () => {
  for (const vps06 of [null, {}, { operation: 'yandex', delay_ms: 0 }, { operation: 'success', delay_ms: -1 }]) {
    await assert.rejects(processSynthetic({ vps06 }));
  }
});
test('RPC rejects arbitrary names and SQL injection', async () => {
  let queries = 0; const rpc = rpcAdapter({ query() { queries++; } });
  await assert.rejects(rpc('drop', { p_company_id: "';--" }));
  await assert.rejects(rpc('review_complete_sync_run', { p_company_id: COMPANY, p_run_id: claim.run_id, p_result: {} }));
  assert.equal(queries, 0);
});
test('shared engine completion failure rollback does not attempt fail on aborted SQL', async () => {
  const calls = [];
  await assert.rejects(singleSyncRun({ companyId: COMPANY, validateClaim: x => x,
    rpc: async name => { calls.push(name); if (name.includes('claim')) return claim; throw safeError('DB_OPERATION_FAILED'); },
    processClaim: () => processSynthetic({ vps06: { operation: 'success', delay_ms: 0 } }),
    summarize: x => x, completionFailure: 'rollback' }));
  assert.deepEqual(calls, ['review_claim_next_sync_run','review_complete_sync_run']);
});
test('service hardening and timer safe cadence', () => {
  const service = readFileSync(new URL('../tools/vps06/review-activator-worker.service', import.meta.url), 'utf8');
  for (const value of ['Type=oneshot','User=review-activator','PrivateNetwork=yes','RestrictAddressFamilies=AF_UNIX',
    'Restart=no','KillMode=control-group','TimeoutStartSec=25']) assert.ok(service.includes(value));
  const timer = readFileSync(new URL('../tools/vps06/review-activator-worker.timer', import.meta.url), 'utf8');
  assert.ok(timer.includes('OnCalendar=hourly')); assert.ok(timer.includes('Persistent=false'));
});
test('installer separates root-only report permissions from traversable runtime', () => {
  const source = readFileSync(new URL('../tools/vps06/install.py', import.meta.url), 'utf8');
  assert.ok(source.includes('DEST.parent.chmod(0o755)'));
  assert.ok(source.includes('DEST.chmod(0o755)'));
  assert.ok(source.includes('current.chmod(0o755)'));
  assert.ok(source.includes("(DEST / 'package.json').chmod(0o644)"));
});
test('installed runtime dependency graph has no provider/cloud/http/Windows imports', () => {
  for (const file of ['tools/vps06/worker.mjs','tools/vps06/pg.mjs','tools/vps06/once.mjs','lib/server/single-sync-run.js']) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from ['"].*(?:yandex|supabase|review-sync\.js|node:https?|node:net)|fetch\(|C:\\|powershell|putty/i);
  }
});
