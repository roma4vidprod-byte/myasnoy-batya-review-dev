import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import test from 'node:test';
import defaultHandler, { createReviewSyncHandler } from '../api/cron/review-sync.js';
import statusHandler from '../api/review-sync-status.js';
import { createServerSyncBoundary } from '../lib/server/review-sync.js';

const fakeSecret = 'local-fixture-secret';
const company = '11111111-1111-4111-8111-111111111111';
const serviceKey = 'sb_secret_fixture_only';
const goodConfig = () => ({ serviceKey, companyId: company });
function response() {
  return {
    headers: {}, statusCode: 200, body: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}
const req = authorization => ({ method: 'GET', headers: { authorization } });
const authorizedReq = () => req(`Bearer ${fakeSecret}`);
function isolateEnv(t) {
  for (const key of ['CRON_SECRET','SUPABASE_SERVICE_ROLE_KEY','REVIEW_SYNC_COMPANY_ID']) {
    const original = process.env[key]; delete process.env[key];
    t.after(() => { if (original === undefined) delete process.env[key]; else process.env[key] = original; });
  }
}
test('missing/empty/whitespace CRON_SECRET -> 401 and zero RPCs', async () => {
  let calls = 0;
  for (const secret of [undefined, '', ' ', '\t', ' padded ']) {
    const handler = createReviewSyncHandler({ getSecret: () => secret, enqueue: async () => { calls++; } });
    const res = response(); await handler(req(`Bearer ${secret}`), res);
    assert.equal(res.statusCode, 401);
    assert.equal(res.headers['cache-control'], 'no-store');
  }
  assert.equal(calls, 0);
});
test('wrong/missing/array/query/cookie secret -> 401 and zero RPCs', async () => {
  let calls = 0;
  const handler = createReviewSyncHandler({ getSecret: () => fakeSecret, enqueue: async () => { calls++; } });
  for (const value of [undefined, '', 'Bearer wrong', `bearer ${fakeSecret}`, `Bearer ${fakeSecret} `, [`Bearer ${fakeSecret}`], true]) {
    const res = response();
    await handler({ ...req(value), query: { token: fakeSecret }, cookies: { token: fakeSecret } }, res);
    assert.equal(res.statusCode, 401);
  }
  assert.equal(calls, 0);
});
test('correct secret -> server enqueue only; HTTP input cannot choose scope/RPC', async () => {
  const calls = [];
  const handler = createReviewSyncHandler({ getSecret: () => fakeSecret,
    enqueue: async (...args) => { calls.push(['server', args]); return 2; }
  });
  const res = response();
  await handler({ ...authorizedReq(), query: { companyId: 'attacker', rpc: 'evil' }, body: { companyId: 'attacker' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.requested, 2);
  assert.deepEqual(calls, [['server', []]]);
  assert.deepEqual(res.body.providers, []);
});
test('secret is resolved each request, not cached', async () => {
  let secret = fakeSecret, calls = 0;
  const handler = createReviewSyncHandler({ getSecret: () => secret, enqueue: async () => ++calls });
  const first = response(); await handler(authorizedReq(), first); assert.equal(first.statusCode, 200);
  secret = undefined;
  const second = response(); await handler(authorizedReq(), second); assert.equal(second.statusCode, 401);
  assert.equal(calls, 1);
});
test('non-GET -> 405 before any RPC', async () => {
  let calls = 0;
  const handler = createReviewSyncHandler({ getSecret: () => fakeSecret, enqueue: async () => ++calls });
  for (const method of ['POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']) {
    const res = response(); await handler({ ...authorizedReq(), method }, res);
    assert.equal(res.statusCode, 405); assert.equal(res.headers.allow, 'GET');
  }
  assert.equal(calls, 0);
});
test('scheduler and public status failures return safe codes, no raw logs', async t => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  const handler = createReviewSyncHandler({ getSecret: () => fakeSecret, enqueue: async () => { throw new Error('sensitive-marker'); } });
  const res = response(); await handler(authorizedReq(), res);
  assert.deepEqual(res.body, { ok: false, error: 'REVIEW_SYNC_FAILED' });
  assert.equal(res.statusCode, 503);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('sensitive-marker'); });
  const readRes = response(); await statusHandler({ method: 'GET' }, readRes);
  assert.deepEqual(readRes.body, { ok: false, error: 'SYNC_STATUS_FAILED' });
  assert.deepEqual(logs, []);
});
test('default deployed handler: missing secret 401; missing server config 503; zero network', async t => {
  isolateEnv(t);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('network forbidden'); });
  const denied = response(); await defaultHandler(authorizedReq(), denied); assert.equal(denied.statusCode, 401);
  process.env.CRON_SECRET = fakeSecret;
  const unconfigured = response(); await defaultHandler(authorizedReq(), unconfigured); assert.equal(unconfigured.statusCode, 503);
  assert.equal(calls, 0);
});
test('localhost HTTP: missing/wrong 401; correct 200; only mocked server path', async t => {
  let calls = 0;
  const handler = createReviewSyncHandler({ getSecret: () => fakeSecret, enqueue: async () => ++calls });
  const server = createServer((req, res) => {
    res.status = code => { res.statusCode = code; return res; };
    res.json = body => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
    handler(req, res).catch(() => { res.statusCode = 500; res.end(); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const send = authorization => new Promise((resolve, reject) => {
    const r = request({ hostname: '127.0.0.1', port: server.address().port, path: '/api/cron/review-sync', headers: authorization ? { authorization } : {} }, res => {
      let body = ''; res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    r.on('error', reject); r.end();
  });
  assert.equal((await send()).status, 401);
  assert.equal((await send('Bearer incorrect')).status, 401);
  assert.equal(calls, 0);
  assert.equal((await send(`Bearer ${fakeSecret}`)).status, 200);
  assert.equal(calls, 1);
});
test('default authenticated handler sends secret key only to fixed DEV server RPC', async t => {
  isolateEnv(t);
  process.env.CRON_SECRET = fakeSecret;
  process.env.SUPABASE_SERVICE_ROLE_KEY = serviceKey;
  process.env.REVIEW_SYNC_COMPANY_ID = company;
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(url.endsWith('review_enqueue_due_syncs') ? 1 : []));
  });
  const res = response(); await defaultHandler(authorizedReq(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://ykiubttldgyjpajmsuas.supabase.co/rest/v1/rpc/review_enqueue_due_syncs');
  assert.equal(calls[0].options.headers.apikey, serviceKey);
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(calls[0].options.body), { p_company_id: company });
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(JSON.stringify(res.body).includes(serviceKey), false);
});
test('server boundary fails closed for missing key/scope, publishable key, user JWT or wrong project', async () => {
  let calls = 0;
  const jwt = claims => `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
  for (const config of [undefined, {}, { serviceKey }, { ...goodConfig(), companyId: null },
    { ...goodConfig(), serviceKey: 'sb_publishable_fake' },
    { ...goodConfig(), serviceKey: jwt({ role: 'authenticated', ref: 'ykiubttldgyjpajmsuas' }) },
    { ...goodConfig(), serviceKey: jwt({ role: 'service_role', ref: 'another-project' }) }
  ]) {
    await assert.rejects(createServerSyncBoundary({ getConfig: () => config, fetchImpl: async () => calls++ })(),
      { code: 'SERVER_SYNC_NOT_CONFIGURED' });
  }
  assert.equal(calls, 0);
});
test('server boundary accepts legacy service-role JWT; backend verifies its signature', async () => {
  const key = `header.${Buffer.from(JSON.stringify({ role: 'service_role', ref: 'ykiubttldgyjpajmsuas' })).toString('base64url')}.signature`;
  const run = createServerSyncBoundary({ getConfig: () => ({ ...goodConfig(), serviceKey: key }),
    fetchImpl: async (_, options) => {
      assert.equal(options.headers.Authorization, `Bearer ${key}`);
      return new Response('0');
    }
  });
  assert.equal(await run(), 0);
});
test('server boundary rejects backend errors and malformed counts without leaking input', async () => {
  for (const fetchImpl of [
    async () => { throw new Error('sensitive-marker'); },
    async () => new Response('sensitive-marker', { status: 403 })
  ]) {
    await assert.rejects(createServerSyncBoundary({ getConfig: goodConfig, fetchImpl })(), { code: 'SERVER_SYNC_FAILED' });
  }
  for (const result of [null, '1', {}, [], -1, 0.5]) {
    await assert.rejects(createServerSyncBoundary({ getConfig: goodConfig, fetchImpl: async () => new Response(JSON.stringify(result)) })(),
      { code: 'SERVER_SYNC_CONTRACT_DRIFT' });
  }
});
test('public status handler is read-only and never sends service credentials', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options }); return new Response('[]');
  });
  const res = response(); await statusHandler({ method: 'GET', query: { token: 'fixture' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.endsWith('/review_public_sync_status'), true);
  assert.equal(calls[0].options.headers.apikey.startsWith('sb_publishable_'), true);
  const mutation = response(); await statusHandler({ method: 'POST' }, mutation);
  assert.equal(mutation.statusCode, 405); assert.equal(calls.length, 1);
});
test('no hourly Vercel scheduler; browser entries have no privileged import or service key', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(Object.hasOwn(config, 'crons'), false);
  for (const file of ['index.html', 'admin.html']) {
    const html = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(html, /SUPABASE_SERVICE_ROLE_KEY|sb_secret_|service_role|lib\/server|review_public_request_due_syncs|review_enqueue_due_syncs/);
  }
});
