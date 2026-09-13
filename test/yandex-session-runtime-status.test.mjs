import assert from 'node:assert/strict';
import test from 'node:test';
import { createYandexSessionRuntimeStatusHandler } from '../api/internal/yandex-session-runtime-status.js';

const row = {
  state: 'ERROR', revision: 7, credential_version: '0dec1e06-678b-43fd-be4c-e02c3bbc99d0',
  envelope: { v: 1, kid: 'stored', iv: '1234567890123456', tag: '1234567890123456789012==', ciphertext: 'ciphertext' }
};
const keyring = { currentKid: 'active', keys: { active: Buffer.alloc(32, 1), stored: Buffer.alloc(32, 2) } };
const response = () => ({ statusCode: 200, headers: {}, body: null,
  setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
  status(code) { this.statusCode = code; return this; },
  json(value) { this.body = value; return this; } });

test('runtime status is secret-protected, decrypts through existing primitives and returns no session material', async () => {
  let reads = 0;
  const handler = createYandexSessionRuntimeStatusHandler({
    getSecret: () => 'worker-secret', read: async () => { reads += 1; return row; },
    getKeyring: () => ({ currentKid: keyring.currentKid, keys: { active: Buffer.from(keyring.keys.active), stored: Buffer.from(keyring.keys.stored) } }),
    decrypt: () => ({ account: 'myasnoibatya-zakaz', cookies: [{ name: 'secret', value: 'never-return' }] })
  });
  const res = response();
  await handler({ method: 'POST', headers: { authorization: 'Bearer worker-secret' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.decrypt, 'PASS');
  assert.equal(res.body.keyring.active_key.length, 32);
  assert.equal(res.body.keyring.stored_key.length, 32);
  assert.equal(res.body.keyring.active_stored_key_match, false);
  assert.equal(reads, 1);
  assert.equal(JSON.stringify(res.body).includes('never-return'), false);
  assert.equal(res.body.stored.ciphertext, undefined);
  assert.equal(res.body.stored.envelope, undefined);
  assert.equal(JSON.stringify(res.body).includes('1234567890123456'), false);
});

test('runtime status denies wrong secret before storage read', async () => {
  let reads = 0;
  const handler = createYandexSessionRuntimeStatusHandler({ getSecret: () => 'worker-secret', read: async () => { reads += 1; return row; } });
  const res = response();
  await handler({ method: 'POST', headers: { authorization: 'Bearer wrong' } }, res);
  assert.equal(res.statusCode, 401);
  assert.equal(reads, 0);
});

test('runtime status reports safe decrypt failure without raw error', async () => {
  const handler = createYandexSessionRuntimeStatusHandler({
    getSecret: () => 'worker-secret', read: async () => row,
    getKeyring: () => ({ currentKid: 'active', keys: { active: Buffer.alloc(32), stored: Buffer.alloc(32) } }),
    decrypt: () => { throw Object.assign(new Error('raw-cookie-error'), { code: 'SESSION_DECRYPT_FAILED' }); }
  });
  const res = response();
  await handler({ method: 'POST', headers: { authorization: 'Bearer worker-secret' } }, res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual({ ok: res.body.ok, decrypt: res.body.decrypt, error: res.body.error, yandex_requests: res.body.yandex_requests },
    { ok: false, decrypt: 'FAIL', error: 'SESSION_DECRYPT_FAILED', yandex_requests: 0 });
  assert.equal(JSON.stringify(res.body).includes('raw-cookie-error'), false);
});
