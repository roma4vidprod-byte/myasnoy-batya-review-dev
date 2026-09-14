import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'node:crypto';
import test from 'node:test';
import {
  ACCOUNT, decryptSession, decryptSessionClassified, encryptSession
} from '../lib/server/yandex-session/crypto.js';
import {
  ASBEST_HEALTH_SCOPE, LIVE_READ_APPROVAL, runYandexHealthPreflight
} from '../lib/server/yandex-session/preflight.js';
import { createReviewSyncWorkerHandler } from '../lib/server/review-sync-worker.js';

const scope = { ...ASBEST_HEALTH_SCOPE };
const keyring = { currentKid: 'fixture-k1', keys: { 'fixture-k1': Buffer.alloc(32, 7) } };
const session = {
  account: ACCOUNT,
  cookies: [{ name: 'fixture', value: 'synthetic-value', domain: 'yandex.ru', path: '/sprav/api', secure: true,
    httpOnly: false, expires: null }]
};
const version = '11111111-1111-4111-8111-111111111111';

function expectCode(fn, code) {
  assert.throws(fn, error => error?.code === code && error?.message === code);
}

function rawEncrypted(plaintext, rawScope = scope, credentialVersion = version, key = keyring.keys['fixture-k1']) {
  const iv = randomBytes(12);
  const aad = Buffer.from(JSON.stringify([
    'ykiubttldgyjpajmsuas', 'yandex', ...Object.values(rawScope), ACCOUNT, credentialVersion
  ]));
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  return {
    credential_version: credentialVersion,
    envelope: {
      v: 1,
      kid: 'fixture-k1',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64')
    }
  };
}

function storedFixture() {
  return { ...encryptSession(scope, session, keyring), company_id: scope.companyId,
    location_id: scope.locationId, external_org_id: scope.organizationId, state: 'NOT_CONFIGURED', revision: 11 };
}

test('valid encrypted fixture decrypts with a classified PASS path', () => {
  const stored = storedFixture();
  assert.deepEqual(decryptSessionClassified(scope, stored, keyring), session);
});

test('wrong key and wrong AAD are classified as AES-GCM authentication failures', () => {
  const stored = storedFixture();
  expectCode(() => decryptSessionClassified(scope, stored, {
    currentKid: 'fixture-k1', keys: { 'fixture-k1': Buffer.alloc(32, 9) }
  }), 'SESSION_AES_GCM_AUTH_FAILED');
  expectCode(() => decryptSessionClassified({ ...scope, companyId: '00000000-0000-4000-8000-000000000000' }, stored, keyring),
    'SESSION_AES_GCM_AUTH_FAILED');
});

test('corrupted authentication tag and ciphertext fail closed at AES-GCM auth', () => {
  const stored = storedFixture();
  const badTag = { ...stored, envelope: {
    ...stored.envelope, tag: `${stored.envelope.tag[0] === 'A' ? 'B' : 'A'}${stored.envelope.tag.slice(1)}`
  } };
  const badCiphertext = { ...stored, envelope: {
    ...stored.envelope, ciphertext: `${stored.envelope.ciphertext[0] === 'A' ? 'B' : 'A'}${stored.envelope.ciphertext.slice(1)}`
  } };
  expectCode(() => decryptSessionClassified(scope, badTag, keyring), 'SESSION_AES_GCM_AUTH_FAILED');
  expectCode(() => decryptSessionClassified(scope, badCiphertext, keyring), 'SESSION_AES_GCM_AUTH_FAILED');
});

test('malformed envelope and key material produce safe pre-AES classifications', () => {
  const stored = storedFixture();
  expectCode(() => decryptSessionClassified(scope, { ...stored, envelope: { ...stored.envelope, iv: 'bad' } }, keyring),
    'SESSION_IV_INVALID');
  const { tag: _tag, ...withoutTag } = stored.envelope;
  expectCode(() => decryptSessionClassified(scope, { ...stored, envelope: withoutTag }, keyring),
    'SESSION_ENVELOPE_SCHEMA_INVALID');
  expectCode(() => decryptSessionClassified(scope, stored, {
    currentKid: 'fixture-k1', keys: { 'fixture-k1': Buffer.alloc(31, 7) }
  }), 'SESSION_KEY_INVALID_LENGTH');
  expectCode(() => decryptSessionClassified(scope, stored, { currentKid: 'other', keys: {} }), 'SESSION_KEY_NOT_FOUND');
});

test('AES success with invalid plaintext JSON or session schema is not reported as decrypt failure', () => {
  expectCode(() => decryptSessionClassified(scope, rawEncrypted('{not-json}'), keyring), 'SESSION_PLAINTEXT_INVALID_JSON');
  expectCode(() => decryptSessionClassified(scope, rawEncrypted(JSON.stringify({ account: ACCOUNT, cookies: [] })), keyring),
    'SESSION_PLAINTEXT_SCHEMA_INVALID');
});

test('preflight reports AES-success plaintext failures as decrypt PASS and validation FAIL', async () => {
  const row = { ...rawEncrypted('{not-json}'), company_id: scope.companyId,
    location_id: scope.locationId, external_org_id: scope.organizationId, state: 'ERROR', revision: 11 };
  const result = await runYandexHealthPreflight({
    env: {
      SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-role',
      YANDEX_SESSION_KEYS_JSON: JSON.stringify({ 'fixture-k1': Buffer.alloc(32, 7).toString('base64') }),
      YANDEX_SESSION_ACTIVE_KID: 'fixture-k1', YANDEX_LIVE_READ_APPROVAL: LIVE_READ_APPROVAL
    },
    read: async () => row,
    getKeyring: () => ({ currentKid: keyring.currentKid, keys: { 'fixture-k1': Buffer.from(keyring.keys['fixture-k1']) } })
  });
  assert.equal(result.error, 'SESSION_PLAINTEXT_INVALID_JSON');
  assert.equal(result.session_decrypt, 'PASS');
  assert.equal(result.session_validation, 'FAIL');
  assert.equal(result.decrypt_stage, 'PLAINTEXT_JSON');
  assert.equal(result.provenance.decrypt, 'PASS');
  assert.equal(result.yandex_requests, 0);
});

test('legacy decrypt API remains generic while preflight exposes only safe classified status', async () => {
  const stored = storedFixture();
  expectCode(() => decryptSession(scope, stored, { currentKid: 'fixture-k1', keys: { 'fixture-k1': Buffer.alloc(32, 9) } }),
    'SESSION_DECRYPT_FAILED');

  const marker = 'synthetic-value-must-not-escape';
  const result = await runYandexHealthPreflight({
    env: {
      SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-role',
      YANDEX_SESSION_KEYS_JSON: JSON.stringify({ 'fixture-k1': Buffer.alloc(32, 7).toString('base64') }),
      YANDEX_SESSION_ACTIVE_KID: 'fixture-k1', YANDEX_LIVE_READ_APPROVAL: LIVE_READ_APPROVAL
    },
    read: async () => stored,
    getKeyring: () => ({ currentKid: keyring.currentKid, keys: { 'fixture-k1': Buffer.from(keyring.keys['fixture-k1']) } }),
    decrypt: () => { throw Object.assign(new Error(marker), { code: 'SESSION_AES_GCM_AUTH_FAILED' }); }
  });
  assert.equal(result.error, 'SESSION_AES_GCM_AUTH_FAILED');
  assert.equal(result.session_decrypt, 'FAIL');
  assert.equal(result.session_validation, 'NOT_RUN');
  assert.equal(result.decrypt_stage, 'AES_GCM_AUTH');
  assert.equal(result.yandex_requests, 0);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(marker));
  assert.doesNotMatch(JSON.stringify(result), /synthetic-value/);
});

test('authenticated preflight response exposes safe classification without raw diagnostics', async () => {
  const response = {
    statusCode: 200, headers: {}, body: null,
    setHeader() {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
  const handler = createReviewSyncWorkerHandler({
    getSecret: () => 'fixture-worker-secret',
    preflight: async () => ({
      pretransport: 'FAIL', session_decrypt: 'FAIL', session_validation: 'NOT_RUN',
      decrypt_stage: 'AES_GCM_AUTH', error: 'SESSION_AES_GCM_AUTH_FAILED',
      scope: 'PASS', mode: 'PASS', page_base: 'PASS', endpoint: 'PASS',
      keyring_parse: 'PASS', active_kid: 'PASS', env_present: {}, runtime_location: 'vercel-server',
      session_state: 'ERROR', revision: 11, provenance: { decrypt: 'FAIL' }, yandex_requests: 0
    })
  });
  await handler({ method: 'POST', headers: { authorization: 'Bearer fixture-worker-secret' }, body: { operation: 'preflight' } }, response);
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.error, 'SESSION_AES_GCM_AUTH_FAILED');
  assert.equal(response.body.decrypt, 'FAIL');
  assert.equal(response.body.validation, 'NOT_RUN');
  assert.equal(response.body.decrypt_stage, 'AES_GCM_AUTH');
  assert.equal(response.body.yandex_requests, 0);
  assert.equal(JSON.stringify(response.body).includes('fixture-worker-secret'), false);
});
