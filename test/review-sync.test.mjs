import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import test from 'node:test';
import defaultHandler, { createReviewSyncHandler } from '../api/cron/review-sync.js';

const fakeSecret = 'local-fixture-secret';
function response() {
  return {
    headers: {}, statusCode: 200, body: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('missing/empty/whitespace CRON_SECRET always denies even a matching-looking header', async () => {
  let calls = 0;
  for (const secret of [undefined, '', ' ', '\t', ' padded ']) {
    const handler = createReviewSyncHandler({ getSecret: () => secret, requestRpc: async () => { calls++; } });
    const res = response();
    await handler({ method: 'GET', headers: { authorization: `Bearer ${secret}` } }, res);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, { ok: false, error: 'UNAUTHORIZED' });
    assert.equal(res.headers['cache-control'], 'no-store');
  }
  assert.equal(calls, 0);
});

test('missing, wrong, array, query or cookie credential cannot authorize sync', async () => {
  let calls = 0;
  const handler = createReviewSyncHandler({ getSecret: () => fakeSecret, requestRpc: async () => { calls++; } });
  for (const authorization of [undefined, '', 'Bearer wrong', `bearer ${fakeSecret}`, `Bearer ${fakeSecret} `, [`Bearer ${fakeSecret}`], true]) {
    const res = response();
    await handler({ method: 'GET', headers: { authorization }, query: { token: fakeSecret }, cookies: { token: fakeSecret } }, res);
    assert.equal(res.statusCode, 401);
  }
  assert.equal(calls, 0);
});

test('correct auth calls only existing due/status RPCs using injected offline transport', async () => {
  const calls = [];
  const handler = createReviewSyncHandler({ getSecret: () => fakeSecret, requestRpc: async (name, args) => {
    calls.push({ name, args });
    return name === 'review_public_request_due_syncs' ? 2 : [{ provider: 'yandex', connection_status: 'WAITING_ACCESS' }];
  } });
  const res = response();
  await handler({ method: 'GET', headers: { authorization: `Bearer ${fakeSecret}` } }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.map(c => c.name), ['review_public_request_due_syncs', 'review_public_sync_status']);
  assert.deepEqual(calls[0].args, calls[1].args);
  assert.equal(res.body.requested, 2);
  assert.equal(res.body.providers[0].connection_status, 'WAITING_ACCESS');
});

test('secret is resolved each request, not cached in a module/request object', async () => {
  let secret = fakeSecret;
  let calls = 0;
  const handler = createReviewSyncHandler({ getSecret: () => secret, requestRpc: async () => { calls++; return 0; } });
  const req = { method: 'GET', headers: { authorization: `Bearer ${fakeSecret}` } };
  const first = response(); await handler(req, first); assert.equal(first.statusCode, 200);
  secret = undefined;
  const second = response(); await handler(req, second); assert.equal(second.statusCode, 401);
  assert.equal(calls, 2);
});

test('non-GET methods refuse before any RPC, including when correctly authenticated', async () => {
  let calls = 0;
  const handler = createReviewSyncHandler({ getSecret: () => fakeSecret, requestRpc: async () => { calls++; } });
  for (const method of ['POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS']) {
    const res = response();
    await handler({ method, headers: { authorization: `Bearer ${fakeSecret}` } }, res);
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, 'GET');
  }
  assert.equal(calls, 0);
});

test('RPC errors return only a stable code and never log error.details or credentials', async t => {
  const logs = [];
  t.mock.method(console, 'error', (...args) => logs.push(args));
  const handler = createReviewSyncHandler({ getSecret: () => fakeSecret, requestRpc: async () => {
    throw Object.assign(new Error('synthetic-sensitive-marker'), { details: 'synthetic-sensitive-marker' });
  } });
  const res = response();
  await handler({ method: 'GET', headers: { authorization: `Bearer ${fakeSecret}` } }, res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.body, { ok: false, error: 'REVIEW_SYNC_FAILED' });
  assert.deepEqual(logs, []);
});

test('default deployed handler denies missing env without ever reaching Supabase Fetch', async t => {
  const original = process.env.CRON_SECRET;
  t.after(() => { if (original === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = original; });
  delete process.env.CRON_SECRET;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('must not reach network'); });
  const res = response();
  await defaultHandler({ method: 'GET', headers: { authorization: `Bearer ${fakeSecret}` } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(calls, 0);
});

test('actual localhost HTTP endpoint: missing/wrong -> 401; correct -> 200, zero external requests', async t => {
  let calls = 0;
  const handler = createReviewSyncHandler({ getSecret: () => fakeSecret, requestRpc: async name => {
    calls++; return name === 'review_public_request_due_syncs' ? 0 : [];
  } });
  const server = createServer((req, res) => {
    res.status = code => { res.statusCode = code; return res; };
    res.json = body => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); };
    handler(req, res).catch(() => { res.statusCode = 500; res.end(); });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
  const send = authorization => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: server.address().port, path: '/api/cron/review-sync', headers: authorization ? { authorization } : {} }, res => {
      let body = ''; res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject); req.end();
  });
  assert.equal((await send()).status, 401);
  assert.equal((await send('Bearer incorrect')).status, 401);
  assert.equal(calls, 0);
  assert.equal((await send(`Bearer ${fakeSecret}`)).status, 200);
  assert.equal(calls, 2);
});

test('no Vercel scheduler added; no hourly Hobby workaround', () => {
  const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(Object.hasOwn(config, 'crons'), false);
});

test('default route uses existing RPC client only after correct auth (Fetch fully mocked)', async t => {
  const original = process.env.CRON_SECRET;
  t.after(() => { if (original === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = original; });
  process.env.CRON_SECRET = fakeSecret;
  const methods = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const name = new URL(url).pathname.split('/').at(-1);
    methods.push({ name, method: options.method });
    return new Response(JSON.stringify(name === 'review_public_request_due_syncs' ? 1 : []), { status: 200 });
  });
  const res = response();
  await defaultHandler({ method: 'GET', headers: { authorization: `Bearer ${fakeSecret}` } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.requested, 1);
  assert.deepEqual(methods, [
    { name: 'review_public_request_due_syncs', method: 'POST' },
    { name: 'review_public_sync_status', method: 'POST' }
  ]);
});
