import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { encryptSession } from '../lib/server/yandex-session/crypto.js';
import {
  ASBEST_HEALTH_SCOPE, LIVE_READ_APPROVAL, runYandexHealthPreflight
} from '../lib/server/yandex-session/preflight.js';

const keyring = { currentKid: 'fixture', keys: { fixture: Buffer.alloc(32, 7) } };
const session = { account: 'myasnoibatya-zakaz', cookies: [{
  name: 'fixture', value: 'safe-value', domain: 'yandex.ru', path: '/sprav/api', secure: true
}] };
const row = () => ({
  company_id: ASBEST_HEALTH_SCOPE.companyId,
  location_id: ASBEST_HEALTH_SCOPE.locationId,
  external_org_id: ASBEST_HEALTH_SCOPE.organizationId,
  state: 'NOT_CONFIGURED', revision: 8,
  credential_version: '11111111-1111-4111-8111-111111111111',
  ...encryptSession(ASBEST_HEALTH_SCOPE, session, keyring, Date.now())
});
const env = approval => ({
  SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-role',
  YANDEX_SESSION_KEYS_JSON: JSON.stringify({ fixture: Buffer.alloc(32, 7).toString('base64') }),
  YANDEX_SESSION_ACTIVE_KID: 'fixture',
  YANDEX_LIVE_READ_APPROVAL: approval
});

test('pretransport PASS decrypts session and performs zero Yandex requests', async () => {
  let reads = 0;
  const result = await runYandexHealthPreflight({
    env: env(LIVE_READ_APPROVAL), read: async () => { reads += 1; return row(); },
    getKeyring: () => ({ currentKid: keyring.currentKid, keys: { fixture: Buffer.from(keyring.keys.fixture) } })
  });
  assert.equal(result.pretransport, 'PASS');
  assert.equal(result.error, null);
  assert.equal(result.session_decrypt, 'PASS');
  assert.equal(result.envelope_shape, 'PASS');
  assert.equal(result.stored_key_available, 'PASS');
  assert.equal(result.active_stored_kid_match, 'PASS');
  assert.equal(result.yandex_requests, 0);
  assert.equal(reads, 1);
});

test('missing or wrong read approval fails before session read or network', async () => {
  for (const approval of [undefined, 'wrong']) {
    let reads = 0;
    const result = await runYandexHealthPreflight({
      env: env(approval), read: async () => { reads += 1; throw new Error('must not read'); }
    });
    assert.equal(result.pretransport, 'FAIL');
    assert.equal(result.error, 'LIVE_READ_NOT_APPROVED');
    assert.equal(result.allow_read, false);
    assert.equal(reads, 0);
    assert.equal(result.yandex_requests, 0);
  }
});

test('pretransport classifies keyring, scope, mode and page-base failures safely', async t => {
  await t.test('keyring', async () => {
    const result = await runYandexHealthPreflight({
      env: env(LIVE_READ_APPROVAL), getKeyring: () => { throw Object.assign(new Error('raw-key'), { code: 'SESSION_KEY_NOT_CONFIGURED' }); }
    });
    assert.equal(result.error, 'SESSION_KEY_NOT_CONFIGURED');
  });
  await t.test('scope', async () => {
    const result = await runYandexHealthPreflight({ env: env(LIVE_READ_APPROVAL), scope: { ...ASBEST_HEALTH_SCOPE, companyId: '00000000-0000-4000-8000-000000000000' } });
    assert.equal(result.error, 'SESSION_SCOPE_INVALID');
  });
  await t.test('mode and page base', async () => {
    const mode = await runYandexHealthPreflight({ env: env(LIVE_READ_APPROVAL), mode: 'probe' });
    const page = await runYandexHealthPreflight({ env: env(LIVE_READ_APPROVAL), pageBase: 0 });
    assert.equal(mode.error, 'SESSION_MODE_INVALID');
    assert.equal(page.error, 'YANDEX_PAGE_BASE_INVALID');
  });
});

test('decrypt failure returns only a safe code and no material', async () => {
  const marker = 'COOKIE_VALUE_MUST_NOT_ESCAPE';
  const result = await runYandexHealthPreflight({
    env: env(LIVE_READ_APPROVAL), read: async () => row(),
    getKeyring: () => ({ currentKid: keyring.currentKid, keys: { fixture: Buffer.from(keyring.keys.fixture) } }),
    decrypt: () => { throw Object.assign(new Error(marker), { code: 'SESSION_DECRYPT_FAILED' }); }
  });
  assert.equal(result.pretransport, 'FAIL');
  assert.equal(result.error, 'SESSION_DECRYPT_FAILED');
  assert.equal(result.envelope_shape, 'PASS');
  assert.equal(result.stored_key_available, 'PASS');
  assert.equal(JSON.stringify(result).includes(marker), false);
  assert.equal(JSON.stringify(result).includes('safe-value'), false);
  assert.equal(result.yandex_requests, 0);
});

test('CLI preflight reports a safe code instead of HEALTH_FAILED and never calls Yandex', () => {
  const env = { ...process.env };
  for (const name of [
    'SUPABASE_SERVICE_ROLE_KEY', 'YANDEX_SESSION_KEYS_JSON',
    'YANDEX_SESSION_ACTIVE_KID', 'YANDEX_LIVE_READ_APPROVAL',
    'NODE_OPTIONS', 'NODE_DEBUG', 'SSLKEYLOGFILE'
  ]) delete env[name];
  const child = spawnSync(process.execPath, [
    '--import', './test/support/no-network.mjs', 'scripts/yandex-session.mjs', 'preflight'
  ], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    env,
    input: JSON.stringify({ scope: ASBEST_HEALTH_SCOPE, pageBase: 1 }),
    encoding: 'utf8', timeout: 10000
  });
  assert.equal(child.status, 1);
  assert.equal(child.stderr, '');
  const output = JSON.parse(child.stdout);
  assert.equal(output.pretransport, 'FAIL');
  assert.equal(output.error, 'SESSION_STORAGE_FAILED');
  assert.equal(output.yandex_requests, 0);
  assert.doesNotMatch(child.stdout, /HEALTH_FAILED|stack|at /i);
});
