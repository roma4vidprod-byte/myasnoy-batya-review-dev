import assert from 'node:assert/strict';
import test from 'node:test';
import { createYandexSessionRuntimeStatus } from '../lib/server/yandex-session/runtime-status.js';

const row = {
  state: 'ERROR', revision: 7, credential_version: '0dec1e06-678b-43fd-be4c-e02c3bbc99d0',
  envelope: { v: 1, kid: 'stored', iv: '1234567890123456', tag: '1234567890123456789012==', ciphertext: 'ciphertext' }
};
const keyring = { currentKid: 'active', keys: { active: Buffer.alloc(32, 1), stored: Buffer.alloc(32, 2) } };
test('runtime status decrypts through existing primitives and returns no session material', async () => {
  let reads = 0;
  const diagnose = createYandexSessionRuntimeStatus({
    read: async () => { reads += 1; return row; },
    getKeyring: () => ({ currentKid: keyring.currentKid, keys: { active: Buffer.from(keyring.keys.active), stored: Buffer.from(keyring.keys.stored) } }),
    decrypt: () => ({ account: 'myasnoibatya-zakaz', cookies: [{ name: 'secret', value: 'never-return' }] })
  });
  const result = await diagnose();
  assert.equal(result.ok, true);
  assert.equal(result.decrypt, 'PASS');
  assert.equal(result.keyring.active_key.length, 32);
  assert.equal(result.keyring.stored_key.length, 32);
  assert.equal(result.keyring.active_stored_key_match, false);
  assert.equal(reads, 1);
  assert.equal(JSON.stringify(result).includes('never-return'), false);
  assert.equal(result.stored.ciphertext, undefined);
  assert.equal(result.stored.envelope, undefined);
  assert.equal(JSON.stringify(result).includes('1234567890123456'), false);
});

test('runtime status reports safe decrypt failure without raw error', async () => {
  const diagnose = createYandexSessionRuntimeStatus({
    read: async () => row,
    getKeyring: () => ({ currentKid: 'active', keys: { active: Buffer.alloc(32), stored: Buffer.alloc(32) } }),
    decrypt: () => { throw Object.assign(new Error('raw-cookie-error'), { code: 'SESSION_DECRYPT_FAILED' }); }
  });
  const result = await diagnose();
  assert.deepEqual({ ok: result.ok, decrypt: result.decrypt, error: result.error, yandex_requests: result.yandex_requests },
    { ok: false, decrypt: 'FAIL', error: 'SESSION_DECRYPT_FAILED', yandex_requests: 0 });
  assert.equal(JSON.stringify(result).includes('raw-cookie-error'), false);
});
