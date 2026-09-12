import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkYandexDevEnv, ENV_NAMES } from '../scripts/check-yandex-dev-env.mjs';

// Deliberately synthetic material, never usable credentials. No live network.
const keyMap = JSON.stringify({ fixture: Buffer.alloc(32, 7).toString('base64') });
const valid = {
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_unit_test_not_a_credential',
  YANDEX_SESSION_KEYS_JSON: keyMap, YANDEX_SESSION_ACTIVE_KID: 'fixture'
};
const withEnv = async (env, run) => {
  const before = Object.fromEntries(ENV_NAMES.map(name => [name, process.env[name]]));
  try {
    for (const name of ENV_NAMES) {
      if (env[name] === undefined) delete process.env[name]; else process.env[name] = env[name];
    }
    return await run();
  } finally {
    for (const name of ENV_NAMES) {
      if (before[name] === undefined) delete process.env[name]; else process.env[name] = before[name];
    }
  }
};
const jwt = (role, ref = 'ykiubttldgyjpajmsuas') =>
  'fixture.' + Buffer.from(JSON.stringify({ role, ref })).toString('base64url') + '.unsigned';

test('DEV env preflight fails without configuration; zero RPC', async () => {
  let calls = 0;
  const result = await withEnv({}, () => checkYandexDevEnv({ fetchImpl: async () => { calls++; } }));
  assert.equal(calls, 0); assert.equal(result.ready, false);
  assert.deepEqual(Object.values(result.report.env_present), [false, false, false]);
  assert.equal(result.report.service_role_connection, 'FAIL');
});

test('DEV env preflight rejects invalid keyring/material and absent active KID without RPC', async t => {
  for (const malformed of ['null', '[]', '{}', '{', JSON.stringify({ fixture: 'invalid' }),
    JSON.stringify({ 'bad.kid': Buffer.alloc(32).toString('base64') }),
    JSON.stringify({ fixture: Buffer.alloc(31).toString('base64') }),
    JSON.stringify({ __proto__: null, constructor: Buffer.alloc(32).toString('base64') })]) {
    await t.test('malformed keyring is fail-closed', async () => {
      let calls = 0;
      const result = await withEnv({ ...valid, YANDEX_SESSION_KEYS_JSON: malformed },
        () => checkYandexDevEnv({ fetchImpl: async () => { calls++; } }));
      assert.equal(calls, 0); assert.equal(result.ready, false);
      assert.equal(result.report.keyring_parse, 'FAIL');
    });
  }
  for (const active of [undefined, 'absent']) {
    const result = await withEnv({ ...valid, YANDEX_SESSION_ACTIVE_KID: active }, () => checkYandexDevEnv());
    assert.equal(result.report.keyring_parse, 'PASS'); assert.equal(result.report.active_kid_exists, 'FAIL');
    assert.equal(result.ready, false);
  }
});

test('DEV env preflight uses existing scoped READ RPC only; accepts both server credential formats', async () => {
  for (const credential of [valid.SUPABASE_SERVICE_ROLE_KEY, jwt('service_role')]) {
    let calls = 0;
    const result = await withEnv({ ...valid, SUPABASE_SERVICE_ROLE_KEY: credential }, () => checkYandexDevEnv({
      fetchImpl: async (url, options) => {
        calls++;
        assert.equal(url, 'https://ykiubttldgyjpajmsuas.supabase.co/rest/v1/rpc/review_yandex_session_store');
        assert.equal(options.method, 'POST'); assert.equal(options.redirect, 'error');
        assert.equal(options.signal instanceof AbortSignal, true);
        assert.equal(Boolean(options.headers.Authorization), !credential.startsWith('sb_secret_'));
        assert.deepEqual(JSON.parse(options.body), {
          p_company_id: '13f3cb80-487a-4a19-96a1-fb3103200230',
          p_location_id: '9a95f63b-18e6-447b-a449-8530b67ddbae', p_org_id: '54309413522',
          p_action: 'read', p_expected_revision: null, p_data: {}
        });
        return Response.json(null);
      }
    }));
    assert.equal(calls, 1); assert.equal(result.ready, true);
    assert.deepEqual(Object.values(result.report.env_present), [true, true, true]);
    assert.equal(result.report.keyring_parse, 'PASS'); assert.equal(result.report.active_kid_exists, 'PASS');
    assert.equal(result.report.service_role_connection, 'PASS');
    assert.equal(JSON.stringify(result).includes(credential), false);
    assert.equal(JSON.stringify(result).includes(keyMap), false);
  }
});

test('anon, authenticated, wrong-project and publishable credentials never reach RPC', async () => {
  for (const credential of [jwt('anon'), jwt('authenticated'), jwt('service_role', 'different-project'), 'sb_publishable_fixture', '']) {
    let calls = 0;
    const result = await withEnv({ ...valid, SUPABASE_SERVICE_ROLE_KEY: credential },
      () => checkYandexDevEnv({ fetchImpl: async () => { calls++; } }));
    assert.equal(calls, 0); assert.equal(result.ready, false);
    assert.equal(result.report.service_role_connection, 'FAIL');
  }
});

test('RPC failures, upstream secrets and contract drift become safe FAIL without retry', async () => {
  const marker = 'PRIVATE_TEST_MARKER_NEVER_OUTPUT';
  for (const reply of [
    () => Response.json({ message: marker }, { status: 401 }),
    () => Response.json({ message: marker }, { status: 403 }),
    () => { throw new Error(marker); },
    () => new Response(marker),
    () => Response.json({ unexpected: marker }),
    () => Response.json([])
  ]) {
    let calls = 0;
    const result = await withEnv(valid, () => checkYandexDevEnv({ fetchImpl: async () => { calls++; return reply(); } }));
    assert.equal(calls, 1); assert.equal(result.ready, false);
    assert.equal(result.report.service_role_connection, 'FAIL');
    assert.equal(JSON.stringify(result).includes(marker), false);
  }
});

test('a session imported since preflight blocks fresh setup and never returns stored data', async () => {
  const result = await withEnv(valid, () => checkYandexDevEnv({ fetchImpl: async () => Response.json({
    company_id: '13f3cb80-487a-4a19-96a1-fb3103200230',
    location_id: '9a95f63b-18e6-447b-a449-8530b67ddbae', external_org_id: '54309413522',
    revision: 1, state: 'NOT_CONFIGURED', envelope: { ciphertext: 'PRIVATE_TEST_MARKER' }
  }) }));
  assert.equal(result.report.service_role_connection, 'PASS'); assert.equal(result.ready, false);
  assert.equal(JSON.stringify(result).includes('PRIVATE_TEST_MARKER'), false);
  assert.equal(JSON.stringify(result).includes('envelope'), false);
});

test('checker executable with no config emits only safe flags; no secrets or stack trace', () => {
  const env = { ...process.env };
  for (const name of [...ENV_NAMES, 'NODE_OPTIONS', 'NODE_DEBUG', 'SSLKEYLOGFILE']) delete env[name];
  const child = spawnSync(process.execPath, ['--import', './test/support/no-network.mjs', 'scripts/check-yandex-dev-env.mjs'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), env, encoding: 'utf8', timeout: 10000
  });
  assert.equal(child.status, 1); assert.equal(child.stderr, '');
  const report = JSON.parse(child.stdout);
  assert.deepEqual(Object.keys(report).sort(), ['active_kid_exists', 'env_present', 'keyring_parse', 'service_role_connection']);
  assert.deepEqual(Object.values(report.env_present), [false, false, false]);
});

test('PowerShell hidden-input setup: CSPRNG, process-only publication, rollback and safe output (mock RPC)', t => {
  const child = spawnSync('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', 'test/support/yandex-dev-keys.test.ps1'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', timeout: 20000
  });
  if (child.error?.code === 'ENOENT') { t.skip('PowerShell 7 not installed'); return; }
  // Do not include raw child output in assertion diagnostics, even on a regression.
  assert.equal(child.status === 0 && child.stderr === '' && child.stdout.trim() === 'PASS: private DEV key setup offline checks', true);
});
