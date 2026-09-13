import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ASBEST_SYNC_SCOPE, ASBEST_SYNC_ACCOUNT, ASBEST_PAGE_BASE,
  createReviewSyncWorker, createReviewSyncHealth, authorizedWorkerRequest, createReviewSyncWorkerHandler
} from '../lib/server/review-sync-worker.js';

const runId = '11111111-1111-4111-8111-111111111111';
const config = { location_id: ASBEST_SYNC_SCOPE.locationId, external_org_id: ASBEST_SYNC_SCOPE.organizationId };
const claim = { claimed: true, run_id: runId, provider: 'yandex', company_id: ASBEST_SYNC_SCOPE.companyId,
  config, external_account_id: ASBEST_SYNC_ACCOUNT };
const result = { ok: true, state: 'READY', pagesFetched: 4, seen: 67,
  persistenceResult: { inserted: 0, updated: 0, unchanged: 67, seen: 67 } };
const keyring = { currentKid: 'fixture', keys: { fixture: Buffer.alloc(32) } };

test('worker claims one scoped item, persists through existing service and completes atomically', async () => {
  const calls = [];
  const worker = createReviewSyncWorker({
    allowRead: () => true, keyringFactory: () => keyring,
    rpc: async (name, payload) => {
      calls.push([name, payload]);
      if (name === 'review_claim_next_sync_run') return claim;
      if (name === 'review_complete_sync_run') return { status: 'SUCCEEDED' };
      throw new Error('unexpected');
    },
    serviceFactory: options => {
      assert.equal(options.allowRead, true);
      assert.equal(options.keyring, keyring);
      return { run: async (scope, options) => {
        assert.deepEqual(scope, ASBEST_SYNC_SCOPE);
        assert.deepEqual(options, { mode: 'persist', pageBase: ASBEST_PAGE_BASE, maxPages: 20, persistenceExpected: 'any' });
        return result;
      } };
    }
  });
  assert.deepEqual(await worker(), { ok: true, claimed: true, state: 'READY', mode: 'persist',
    pages_fetched: 4, fetched_count: 67, inserted: 0, updated: 0, unchanged: 67, seen: 67 });
  assert.equal(calls[0][0], 'review_claim_next_sync_run');
  assert.equal(calls[1][0], 'review_complete_sync_run');
  assert.equal(calls[1][1].p_company_id, ASBEST_SYNC_SCOPE.companyId);
  assert.equal(calls[1][1].p_run_id, runId);
});

test('worker does not call Yandex or service when queue is empty', async () => {
  let services = 0;
  const worker = createReviewSyncWorker({ allowRead: () => true, keyringFactory: () => keyring,
    rpc: async name => { assert.equal(name, 'review_claim_next_sync_run'); return { claimed: false }; },
    serviceFactory: () => { services++; throw new Error('must not run'); } });
  assert.deepEqual(await worker(), { ok: true, claimed: false, queue: 'EMPTY' });
  assert.equal(services, 0);
});

test('worker fail-closes reauth and never completes the run', async () => {
  const calls = [];
  const worker = createReviewSyncWorker({ allowRead: () => true, keyringFactory: () => keyring,
    rpc: async (name, payload) => { calls.push([name, payload]); return name === 'review_claim_next_sync_run' ? claim : { status: 'FAILED' }; },
    serviceFactory: () => ({ run: async () => ({ ok: false, state: 'REAUTH_REQUIRED', errorCode: 'YANDEX_HTTP_401' }) }) });
  assert.deepEqual(await worker(), { ok: false, claimed: true, state: 'REAUTH_REQUIRED', errorCode: 'YANDEX_HTTP_401' });
  assert.equal(calls.filter(([name]) => name === 'review_complete_sync_run').length, 0);
  assert.equal(calls.filter(([name]) => name === 'review_fail_sync_run').length, 1);
});

test('worker rejects missing read approval before claiming queue', async () => {
  let calls = 0;
  const worker = createReviewSyncWorker({ allowRead: () => false, keyringFactory: () => keyring,
    rpc: async () => { calls++; return claim; } });
  await assert.rejects(worker(), { code: 'WORKER_READ_NOT_APPROVED' });
  assert.equal(calls, 0);
});

test('claim scope and account are strict', async () => {
  const worker = createReviewSyncWorker({ allowRead: () => true, keyringFactory: () => keyring,
    rpc: async () => ({ ...claim, config: { ...config, location_id: '22222222-2222-4222-8222-222222222222' } }) });
  assert.deepEqual(await worker(), { ok: false, claimed: true, state: 'ERROR', errorCode: 'SYNC_OPERATION_FAILED' });
});

test('worker HTTP boundary is POST-only, secret-protected and safe', async () => {
  assert.equal(authorizedWorkerRequest({ headers: { authorization: 'Bearer secret' } }, 'secret'), true);
  assert.equal(authorizedWorkerRequest({ headers: { authorization: 'Bearer wrong' } }, 'secret'), false);
  assert.equal(authorizedWorkerRequest({ headers: { authorization: 'bearer secret' } }, 'secret'), false);
  const calls = [];
  const handler = createReviewSyncWorkerHandler({ getSecret: () => 'secret', run: async () => { calls.push(1); return { ok: true, claimed: false }; } });
  const res = () => ({ statusCode: 200, headers: {}, setHeader(k,v){this.headers[k.toLowerCase()]=v;}, status(c){this.statusCode=c;return this;}, json(v){this.body=v;return this;} });
  const get = res(); await handler({ method: 'GET', headers: { authorization: 'Bearer secret' } }, get);
  assert.equal(get.statusCode, 405); assert.equal(calls.length, 0);
  const bad = res(); await handler({ method: 'POST', headers: { authorization: 'Bearer wrong' } }, bad);
  assert.equal(bad.statusCode, 401); assert.equal(calls.length, 0);
  const good = res(); await handler({ method: 'POST', headers: { authorization: 'Bearer secret' } }, good);
  assert.equal(good.statusCode, 200); assert.deepEqual(good.body, { ok: true, claimed: false });
});

test('worker diagnostic_only is secret-protected, does not claim queue and returns safe decrypt status', async () => {
  let runs = 0;
  const handler = createReviewSyncWorkerHandler({
    getSecret: () => 'secret',
    run: async () => { runs += 1; return { ok: true, claimed: false }; },
    diagnose: async () => ({ ok: false, decrypt: 'FAIL', error: 'SESSION_DECRYPT_FAILED', yandex_requests: 0, review_persistence: 'OFF' })
  });
  const res = () => ({ statusCode: 200, headers: {}, body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(v) { this.body = v; return this; } });
  const bad = res();
  await handler({ method: 'POST', headers: { authorization: 'Bearer wrong' }, body: { diagnostic_only: true } }, bad);
  assert.equal(bad.statusCode, 401);
  const good = res();
  await handler({ method: 'POST', headers: { authorization: 'Bearer secret' }, body: { diagnostic_only: true } }, good);
  assert.equal(good.statusCode, 503);
  assert.equal(good.body.error, 'SESSION_DECRYPT_FAILED');
  assert.equal(runs, 0);
});

test('server health operations are secret-protected and never enter the claim path', async () => {
  let runs = 0;
  const responses = [];
  const res = () => ({ statusCode: 200, headers: {}, body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(v) { this.body = v; return this; } });
  const handler = createReviewSyncWorkerHandler({
    getSecret: () => 'secret',
    run: async () => { runs += 1; throw new Error('claim path must not run'); },
    preflight: async () => ({
      pretransport: 'PASS', session_decrypt: 'PASS', scope: 'PASS', mode: 'PASS', page_base: 'PASS',
      endpoint: 'PASS', keyring_parse: 'PASS', active_kid: 'PASS', env_present: {},
      runtime_location: 'vercel-server', session_state: 'NOT_CONFIGURED', revision: 8, error: null
    }),
    health: async () => ({
      ok: true, operation: 'health', pretransport: 'PASS', decrypt: 'PASS', validation: 'PASS',
      health_get: 'PASS', state_before: 'NOT_CONFIGURED', revision_before: 8,
      state_after: 'READY', revision_after: 9, yandex_requests: 1, review_persistence: 'OFF'
    })
  });
  const denied = res();
  await handler({ method: 'POST', headers: { authorization: 'Bearer wrong' }, body: { operation: 'preflight' } }, denied);
  assert.equal(denied.statusCode, 401);
  const preflight = res();
  await handler({ method: 'POST', headers: { authorization: 'Bearer secret' }, body: { operation: 'preflight' } }, preflight);
  assert.equal(preflight.statusCode, 200);
  assert.equal(preflight.body.operation, 'preflight');
  assert.equal(preflight.body.yandex_requests, 0);
  const health = res();
  await handler({ method: 'POST', headers: { authorization: 'Bearer secret' }, body: { operation: 'health' } }, health);
  assert.equal(health.statusCode, 200);
  assert.equal(health.body.state_after, 'READY');
  assert.equal(health.body.review_persistence, 'OFF');
  assert.equal(runs, 0);
  responses.push(preflight.body, health.body);
  assert.equal(JSON.stringify(responses).includes('secret'), false);
});

test('health operation rejects extra parameters and does not create another boundary', async () => {
  let preflightCalls = 0;
  const res = () => ({ statusCode: 200, headers: {}, body: null,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    status(c) { this.statusCode = c; return this; },
    json(v) { this.body = v; return this; } });
  const handler = createReviewSyncWorkerHandler({
    getSecret: () => 'secret',
    preflight: async () => { preflightCalls += 1; return { pretransport: 'PASS' }; },
    health: async () => ({ ok: true })
  });
  const bad = res();
  await handler({ method: 'POST', headers: { authorization: 'Bearer secret' }, body: { operation: 'health', page: 1 } }, bad);
  assert.equal(bad.statusCode, 400);
  assert.deepEqual(bad.body, { ok: false, error: 'INVALID_OPERATION' });
  assert.equal(preflightCalls, 0);
});

test('server health stops before keyring/service when preflight fails', async () => {
  let keyrings = 0;
  let services = 0;
  const health = createReviewSyncHealth({
    preflight: async () => ({
      pretransport: 'FAIL', session_decrypt: 'FAIL', scope: 'PASS', mode: 'PASS', page_base: 'PASS',
      endpoint: 'PASS', keyring_parse: 'PASS', active_kid: 'PASS', env_present: {},
      runtime_location: 'vercel-server', session_state: 'NOT_CONFIGURED', revision: 8,
      error: 'SESSION_DECRYPT_FAILED'
    }),
    keyringFactory: () => { keyrings += 1; throw new Error('must not run'); },
    serviceFactory: () => { services += 1; throw new Error('must not run'); }
  });
  const result = await health();
  assert.equal(result.ok, false);
  assert.equal(result.operation, 'health');
  assert.equal(result.error, 'SESSION_DECRYPT_FAILED');
  assert.equal(result.health_get, undefined);
  assert.equal(result.yandex_requests, 0);
  assert.equal(keyrings, 0);
  assert.equal(services, 0);
});

test('server health performs exactly the existing service health path after preflight', async () => {
  const calls = [];
  const keyring = { currentKid: 'fixture', keys: { fixture: Buffer.alloc(32) } };
  const health = createReviewSyncHealth({
    preflight: async () => ({
      pretransport: 'PASS', session_decrypt: 'PASS', scope: 'PASS', mode: 'PASS', page_base: 'PASS',
      endpoint: 'PASS', keyring_parse: 'PASS', active_kid: 'PASS', env_present: {},
      runtime_location: 'vercel-server', session_state: 'NOT_CONFIGURED', revision: 8, error: null
    }),
    keyringFactory: () => keyring,
    storeFactory: () => ({ read: async () => { calls.push('store.read'); return null; } }),
    serviceFactory: options => {
      calls.push('service.create');
      assert.equal(options.allowRead, true);
      assert.equal(options.persistenceWriter, undefined);
      return { run: async (scope, options) => {
        calls.push(['service.run', scope, options]);
        return { ok: true, state: 'READY', revision: 9,
          lastSessionCheckAt: '2026-09-13T00:00:00.000Z', lastSuccessfulSyncAt: null,
          seen: 20, pagesFetched: 1 };
      } };
    }
  });
  const result = await health();
  assert.equal(result.ok, true);
  assert.equal(result.state_before, 'NOT_CONFIGURED');
  assert.equal(result.revision_before, 8);
  assert.equal(result.state_after, 'READY');
  assert.equal(result.revision_after, 9);
  assert.equal(result.health_get, 'PASS');
  assert.equal(result.review_persistence, 'OFF');
  assert.equal(result.yandex_requests, 0);
  assert.equal(calls[0], 'service.create');
  assert.deepEqual(calls[1], ['service.run', ASBEST_SYNC_SCOPE, { mode: 'health', pageBase: 1 }]);
  assert.deepEqual(keyring.keys.fixture, Buffer.alloc(32));
});

test('worker migration defines server-only claim/complete/fail and no Vercel cron', () => {
  const migration = readFileSync(new URL('../supabase/migrations/20260913150000_yandex_hourly_sync_07.sql', import.meta.url), 'utf8');
  for (const name of ['review_claim_next_sync_run','review_complete_sync_run','review_fail_sync_run']) assert.match(migration, new RegExp(name));
  assert.match(migration, /revoke all on function public\.review_claim_next_sync_run\(uuid\) from public,anon,authenticated/);
  assert.match(migration, /grant execute on function public\.review_claim_next_sync_run\(uuid\) to service_role,postgres/);
  assert.match(migration, /review_private\.yandex_sessions/);
  assert.doesNotMatch(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'), /crons/);
});
