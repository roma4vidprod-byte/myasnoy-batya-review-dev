import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  ASBEST_SYNC_SCOPE,
  ASBEST_SYNC_ACCOUNT,
  createReviewSyncHealth,
  createReviewSyncWorkerHandler
} from '../lib/server/review-sync-worker.js';
import { createYandexSessionService } from '../lib/server/yandex-session/service.js';
import { encryptSession } from '../lib/server/yandex-session/crypto.js';

const NOW = 1900000000000;
const SECRET = 'synthetic-worker-secret';
const material = {
  account: ASBEST_SYNC_ACCOUNT,
  cookies: [{ name: 'fixture', value: 'SYNTHETIC_COOKIE', domain: '.yandex.ru', path: '/sprav/api', secure: true, httpOnly: true, expires: -1 }]
};
const page = JSON.parse(readFileSync(new URL('./fixtures/yandex/single-review.json', import.meta.url), 'utf8'));

const preflight = () => ({
  pretransport: 'PASS', session_decrypt: 'PASS', session_validation: 'PASS',
  scope: 'PASS', mode: 'PASS', page_base: 'PASS', endpoint: 'PASS',
  keyring_parse: 'PASS', active_kid: 'PASS', env_present: {}, runtime_location: 'synthetic',
  session_state: 'NOT_CONFIGURED', revision: 12, provenance: { runtime: 'synthetic', environment: 'test' }, error: null
});

function response(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function fixtureStore(ring, { read, transition } = {}) {
  const encrypted = encryptSession(ASBEST_SYNC_SCOPE, material, ring, NOW);
  let row = {
    ...encrypted,
    company_id: ASBEST_SYNC_SCOPE.companyId,
    location_id: ASBEST_SYNC_SCOPE.locationId,
    external_org_id: ASBEST_SYNC_SCOPE.organizationId,
    state: 'NOT_CONFIGURED', revision: 12,
    last_session_check_at: null, last_successful_sync_at: null, last_error_code: null
  };
  let reads = 0;
  let transitions = 0;
  return {
    row: () => row,
    reads: () => reads,
    transitions: () => transitions,
    read: async scope => {
      reads += 1;
      if (read) return read({ scope, row, reads });
      return row;
    },
    transition: async (scope, expectedRevision, result) => {
      transitions += 1;
      if (transition) return transition({ scope, expectedRevision, result, row, transitions });
      assert.equal(expectedRevision, row.revision);
      row = { ...row, ...result, last_error_code: result.error_code ?? row.last_error_code, revision: row.revision + 1 };
      return row;
    },
    claimAlert: async () => ({ claimed: false })
  };
}

async function invokeHealth({ store, fetchImpl }) {
  const ring = { currentKid: 'fixture', keys: { fixture: Buffer.alloc(32, 7) } };
  const health = createReviewSyncHealth({
    preflight,
    keyringFactory: () => ring,
    serviceFactory: createYandexSessionService,
    storeFactory: () => store,
    fetchImpl,
    now: () => new Date(NOW)
  });
  const output = { statusCode: 200, headers: {}, body: null,
    setHeader() {}, status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; } };
  const handler = createReviewSyncWorkerHandler({
    getSecret: () => SECRET,
    health,
    run: async () => { throw new Error('worker path must not run'); }
  });
  await handler({ method: 'POST', headers: { authorization: `Bearer ${SECRET}` }, body: { operation: 'health' } }, output);
  ring.keys.fixture.fill(0);
  return output;
}

test('health integration: NOT_CONFIGURED session performs one page-1 GET, parses, and CASes READY', async () => {
  const calls = [];
  const store = fixtureStore({ currentKid: 'fixture', keys: { fixture: Buffer.alloc(32, 7) }});
  const output = await invokeHealth({
    store,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(200, page);
    }
  });
  assert.equal(output.statusCode, 200);
  assert.equal(output.body.ok, true);
  assert.equal(output.body.health_get, 'PASS');
  assert.equal(output.body.state_before, 'NOT_CONFIGURED');
  assert.equal(output.body.state_after, 'READY');
  assert.equal(output.body.revision_before, 12);
  assert.equal(output.body.revision_after, 13);
  assert.equal(output.body.seen, 1);
  assert.equal(output.body.pages_fetched, 1);
  assert.equal(output.body.yandex_requests, 1);
  assert.equal(output.body.transport_attempted, 1);
  assert.equal(output.body.transport_completed, 1);
  assert.equal(output.body.provider_http_status, 200);
  assert.equal(output.body.failure_stage, null);
  assert.equal(output.body.last_completed_stage, 'HEALTH_CAS');
  assert.equal(output.body.health_cas, 'SUCCESS');
  assert.equal(output.body.last_successful_sync_at, null);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/sprav\/api\/54309413522\/reviews\?.*page=1$/);
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.redirect, 'manual');
  assert.equal(store.transitions(), 1);
  assert.equal(store.row().state, 'READY');
});

test('health read failure is classified at SESSION_READ and never becomes fake NOT_STARTED generic failure', async () => {
  let networkCalls = 0;
  const store = fixtureStore({ currentKid: 'fixture', keys: { fixture: Buffer.alloc(32, 7) } }, {
    read: async () => { throw Object.assign(new Error('SYNTHETIC_PRIVATE_STORAGE_MARKER'), { code: 'SESSION_STORAGE_FAILED' }); }
  });
  const output = await invokeHealth({ store, fetchImpl: async () => { networkCalls += 1; throw new Error('must not fetch'); } });
  assert.equal(output.statusCode, 503);
  assert.equal(output.body.error, 'SESSION_STORAGE_FAILED');
  assert.equal(output.body.health_get, 'FAIL');
  assert.equal(output.body.failure_stage, 'SESSION_READ');
  assert.equal(output.body.last_completed_stage, 'NONE');
  assert.equal(output.body.state_after, 'NOT_CONFIRMED');
  assert.equal(output.body.revision_after, 'NOT_CONFIRMED');
  assert.equal(output.body.health_cas, 'NOT_ATTEMPTED');
  assert.equal(output.body.yandex_requests, 0);
  assert.equal(output.body.transport_attempted, 0);
  assert.equal(output.body.transport_completed, 0);
  assert.equal(networkCalls, 0);
  assert.equal(store.transitions(), 0);
  assert.doesNotMatch(JSON.stringify(output.body), /SYNTHETIC_PRIVATE_STORAGE_MARKER/);
});

for (const [label, fetchImpl] of [
  ['synchronous transport throw', () => { throw Object.assign(new Error('SYNTHETIC_COOKIE_TOKEN'), { code: 'YANDEX_NETWORK_ERROR' }); }],
  ['rejected transport promise', async () => { throw Object.assign(new Error('SYNTHETIC_COOKIE_TOKEN'), { code: 'YANDEX_NETWORK_ERROR' }); }]
]) {
  test(`health ${label} preserves attempted transport and does not retry`, async () => {
    const store = fixtureStore({ currentKid: 'fixture', keys: { fixture: Buffer.alloc(32, 7) } });
    const output = await invokeHealth({ store, fetchImpl });
    assert.equal(output.statusCode, 503);
    assert.equal(output.body.error, 'YANDEX_NETWORK_ERROR');
    assert.equal(output.body.health_get, 'FAIL');
    assert.equal(output.body.failure_stage, 'TRANSPORT');
    assert.equal(output.body.yandex_requests, 1);
    assert.equal(output.body.transport_attempted, 1);
    assert.equal(output.body.transport_completed, 0);
    assert.equal(output.body.provider_http_status, 'NOT_RETURNED');
    assert.equal(output.body.health_cas, 'SUCCESS');
    assert.doesNotMatch(JSON.stringify(output.body), /SYNTHETIC_COOKIE_TOKEN/);
  });
}

test('health parser failure keeps the completed HTTP response and parser stage', async () => {
  const store = fixtureStore({ currentKid: 'fixture', keys: { fixture: Buffer.alloc(32, 7) } });
  const output = await invokeHealth({ store, fetchImpl: async () => response(200, { list: {} }) });
  assert.equal(output.statusCode, 503);
  assert.equal(output.body.error, 'YANDEX_CONTRACT_DRIFT');
  assert.equal(output.body.health_get, 'FAIL');
  assert.equal(output.body.failure_stage, 'PARSER');
  assert.equal(output.body.last_completed_stage, 'SESSION_RECHECK');
  assert.equal(output.body.yandex_requests, 1);
  assert.equal(output.body.transport_completed, 1);
  assert.equal(output.body.provider_http_status, 200);
  assert.equal(output.body.health_cas, 'SUCCESS');
});

test('health CAS failure is not retried or reported as a transport failure', async () => {
  const store = fixtureStore({ currentKid: 'fixture', keys: { fixture: Buffer.alloc(32, 7) } }, {
    transition: async () => { throw Object.assign(new Error('SYNTHETIC_ENVELOPE_MARKER'), { code: 'SESSION_STORAGE_FAILED' }); }
  });
  const output = await invokeHealth({ store, fetchImpl: async () => response(200, page) });
  assert.equal(output.statusCode, 503);
  assert.equal(output.body.error, 'SESSION_STORAGE_FAILED');
  assert.equal(output.body.health_get, 'FAIL');
  assert.equal(output.body.failure_stage, 'HEALTH_CAS');
  assert.equal(output.body.last_completed_stage, 'PARSER');
  assert.equal(output.body.health_cas, 'FAILED');
  assert.equal(output.body.yandex_requests, 1);
  assert.equal(output.body.provider_http_status, 200);
  assert.equal(store.transitions(), 1);
  assert.doesNotMatch(JSON.stringify(output.body), /SYNTHETIC_ENVELOPE_MARKER/);
});

test('health revision conflict preserves successful transport evidence and does not transition stale state', async () => {
  const store = fixtureStore({ currentKid: 'fixture', keys: { fixture: Buffer.alloc(32, 7) } }, {
    read: async ({ row, reads }) => reads === 1 ? row : { ...row, revision: row.revision + 1 }
  });
  const output = await invokeHealth({ store, fetchImpl: async () => response(200, page) });
  assert.equal(output.statusCode, 503);
  assert.equal(output.body.error, 'SESSION_CHANGED');
  assert.equal(output.body.failure_stage, 'SESSION_RECHECK');
  assert.equal(output.body.health_cas, 'CONFLICT');
  assert.equal(output.body.yandex_requests, 0);
  assert.equal(output.body.state_after, 'NOT_CONFIRMED');
  assert.equal(store.transitions(), 0);
});
