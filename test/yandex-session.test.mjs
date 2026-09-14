import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { PGlite } from '@electric-sql/pglite';
import { ACCOUNT, ORG_ID, encryptSession, decryptSession, validateSession, keyringFromEnv } from '../lib/server/yandex-session/crypto.js';
import { createSessionStore } from '../lib/server/yandex-session/store.js';
import { createYandexSessionService } from '../lib/server/yandex-session/service.js';
import { createYandexReadTransport } from '../lib/server/yandex-session/transport.js';
import { sendSessionAlert } from '../lib/server/yandex-session/alerts.js';
import { sendTelegramMessage } from '../api/_telegram.js';
import { requestDevServiceRpc } from '../lib/server/review-sync.js';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const fixture = name => JSON.parse(read(`./fixtures/yandex/${name}.json`));
const migrationName = readdirSync(new URL('../supabase/migrations/', import.meta.url)).find(n => n.endsWith('_yandex_session_transport_v1.sql'));
const migration = read(`../supabase/migrations/${migrationName}`);
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const LA = '33333333-3333-4333-8333-333333333333', LB = '44444444-4444-4444-8444-444444444444';
const LA2 = '55555555-5555-4555-8555-555555555555';
const scope = { companyId: A, locationId: LA, organizationId: ORG_ID };
const ring = { currentKid: 'fixture-k1', keys: { 'fixture-k1': Buffer.alloc(32, 7), 'fixture-k2': Buffer.alloc(32, 9) } };
const secretMarker = 'SYNTHETIC-COOKIE-NOT-A-REAL-SESSION';
const material = { account: ACCOUNT, cookies: [{ name: 'Session_id', value: secretMarker, domain: '.yandex.ru', path: '/', secure: true, httpOnly: true, expires: -1 }] };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const req = page => ({ method: 'GET', permanentId: ORG_ID, page, url: `https://yandex.ru/sprav/api/${ORG_ID}/reviews?ranking=by_time&source=pagination&page=${page}` });
const err = code => error => error.code === code && error.message === code;

test('session cryptography, AAD, validation and secret-safe failures', async t => {
  const encrypted = encryptSession(scope, material, ring);
  await t.test('AES-GCM roundtrip, random ciphertext/IV/version; plaintext absent', () => {
    assert.deepEqual(decryptSession(scope, encrypted, ring), material);
    const second = encryptSession(scope, material, ring);
    assert.notEqual(second.envelope.iv, encrypted.envelope.iv);
    assert.notEqual(second.envelope.ciphertext, encrypted.envelope.ciphertext);
    assert.notEqual(second.credential_version, encrypted.credential_version);
    assert.equal(JSON.stringify(encrypted).includes(secretMarker), false);
  });
  await t.test('tampered ciphertext/tag/key/version/company/location fail authentication', () => {
    for (const field of ['ciphertext','tag']) {
      const bad = structuredClone(encrypted);
      bad.envelope[field] = (bad.envelope[field][0] === 'A' ? 'B' : 'A') + bad.envelope[field].slice(1);
      assert.throws(() => decryptSession(scope, bad, ring), err('SESSION_DECRYPT_FAILED'));
    }
    assert.throws(() => decryptSession(scope, encrypted, { keys: {} }), err('SESSION_DECRYPT_FAILED'));
    assert.throws(() => decryptSession(scope, { ...encrypted, credential_version: B }, ring), err('SESSION_DECRYPT_FAILED'));
    for (const other of [{ ...scope, companyId: B }, { ...scope, locationId: LA2 }])
      assert.throws(() => decryptSession(other, encrypted, ring), err('SESSION_DECRYPT_FAILED'));
  });
  await t.test('reject password, CSRF, non-target cookies, header injection, expired cookies and wrong account', () => {
    const bad = [
      { ...material, password: secretMarker }, { ...material, csrf: secretMarker }, { ...material, account: 'wrong' },
      ...[{ name: 'csrf_token' }, { name: 'SMS' }, { value: 'a\r\nAuthorization: b' }, { value: 'a;b' },
        { domain: '.example.com' }, { path: '/other' }, { secure: false }, { expires: 1 }]
        .map(change => ({ ...material, cookies: [{ ...material.cookies[0], ...change }] })),
      { ...material, cookies: [material.cookies[0], material.cookies[0]] }
    ];
    for (const input of bad) assert.throws(() => validateSession(input), err('SESSION_COOKIE_INVALID'));
  });
  await t.test('server-only guard', () => {
    globalThis.window = {};
    try { assert.throws(() => encryptSession(scope, material, ring), err('SERVER_ONLY')); }
    finally { delete globalThis.window; }
  });
});

test('exact read-only transport: approval, URL/method, response bounds and no redirect', async t => {
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls++;
    assert.equal(url, req(1).url); assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.Cookie, `Session_id=${secretMarker}`);
    assert.equal(options.headers.Authorization, undefined);
    return json(fixture('single-review'));
  };
  const blocked = createYandexReadTransport({ scope, session: material, fetchImpl });
  await assert.rejects(blocked(req(1)), err('LIVE_READ_NOT_APPROVED')); assert.equal(calls, 0);
  const transport = createYandexReadTransport({ scope, session: material, fetchImpl, allowRead: true });
  for (const bad of [{ ...req(1), method: 'POST' }, { ...req(1), url: 'https://example.com' }, req(-1), req(101)])
    await assert.rejects(transport(bad), err('SESSION_REQUEST_INVALID'));
  assert.equal(calls, 0); assert.deepEqual(await transport(req(1)), fixture('single-review'));
  await t.test('oversized response fails, network exception is sanitized', async () => {
    const large = createYandexReadTransport({ scope, session: material, allowRead: true, fetchImpl: async () => new Response('x'.repeat(2_000_001)) });
    await assert.rejects(large(req(1)), err('YANDEX_RESPONSE_TOO_LARGE'));
    const broken = createYandexReadTransport({ scope, session: material, allowRead: true, fetchImpl: async () => { throw new Error(secretMarker); } });
    await assert.rejects(broken(req(1)), err('YANDEX_NETWORK_ERROR'));
  });
});

test('private storage exact migration + session service against isolated PostgreSQL', async t => {
  const db = await PGlite.create(); t.after(() => db.close());
  await db.exec(read('./fixtures/db/review-sync-baseline.sql'));
  await db.exec(read('../supabase/migrations/20260912095126_review_sync_server_boundary.sql'));
  await db.exec(`insert into review_companies values ('${A}'),('${B}');
    insert into review_locations values ('${LA}','${A}'),('${LA2}','${A}'),('${LB}','${B}');`);
  await db.exec(migration);
  const rpc = async (name, p) => {
    assert.equal(name, 'review_yandex_session_store');
    assert.equal(JSON.stringify(p).includes(secretMarker), false, 'RPC never receives plaintext');
    try {
      return (await db.query('select public.review_yandex_session_store($1::uuid,$2::uuid,$3::text,$4::text,$5::bigint,$6::jsonb) as value',
        [p.p_company_id,p.p_location_id,p.p_org_id,p.p_action,p.p_expected_revision,JSON.stringify(p.p_data)])).rows[0].value;
    } catch (error) {
      if (['SESSION_CHANGED','SESSION_SCOPE_INVALID'].includes(error.message)) error.code = error.message;
      throw error;
    }
  };
  const store = createSessionStore({ rpc });
  let calls, alerts, pages, http;
  const service = options => createYandexSessionService({ store, keyring: ring, allowRead: true,
    fetchImpl: async (url, options) => { calls++; pages.push(Number(new URL(url).searchParams.get('page'))); return http(url, options); },
    notify: async value => { alerts.push(value); return 'MOCK_SENT'; }, ...options });
  async function cleanTest(name, run) {
    await t.test(name, async () => {
      await db.exec('reset role; truncate review_private.yandex_sessions,public.review_external_reviews; set role service_role');
      calls = 0; alerts = []; pages = []; http = async () => json(fixture('single-review'));
      await run();
    });
  }
  for (const role of ['anon','authenticated']) await t.test(`${role} cannot read/write/delete private table or invoke RPC`, async () => {
    for (const query of [
      'select * from review_private.yandex_sessions',
      'insert into review_private.yandex_sessions default values',
      "update review_private.yandex_sessions set state='READY'", 'delete from review_private.yandex_sessions',
      `select public.review_yandex_session_store('${A}','${LA}','${ORG_ID}','read')`
    ]) {
      await db.exec(`set role ${role}`);
      try { await assert.rejects(db.exec(query), { code: '42501' }); }
      finally { await db.exec('reset role'); }
    }
  });
  await t.test('RLS forced, no policies, SECURITY INVOKER, no PUBLIC execute or service DELETE', async () => {
    const row = (await db.query(`select c.relrowsecurity,c.relforcerowsecurity,
      (select count(*)::int from pg_policies where schemaname='review_private') policies,
      (select prosecdef from pg_proc where proname='review_yandex_session_store') definer,
      has_table_privilege('service_role','review_private.yandex_sessions','DELETE') service_delete
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='review_private' and c.relname='yandex_sessions'`)).rows[0];
    assert.deepEqual(row, { relrowsecurity: true, relforcerowsecurity: true, policies: 0, definer: false, service_delete: false });
  });
  await cleanTest('service role encrypted save/read, NOT_CONFIGURED then READY, no session leaks', async () => {
    const s = service();
    assert.equal((await s.status(scope)).state, 'NOT_CONFIGURED');
    assert.equal((await s.run(scope, { pageBase: 1 })).state, 'NOT_CONFIGURED'); assert.equal(calls, 0);
    const imported = await s.importSession(scope, material, 0);
    assert.equal(imported.state, 'NOT_CONFIGURED'); assert.equal(imported.lastSessionCheckAt, null);
    const stored = await store.read(scope); assert.equal(stored.envelope.v, 1);
    assert.deepEqual(decryptSession(scope, stored, ring), material);
    const result = await s.run(scope, { pageBase: 1 });
    assert.equal(result.state, 'READY'); assert.equal(result.ok, true); assert.equal(result.seen, 1);
    assert.ok(result.lastSessionCheckAt); assert.equal(result.lastSuccessfulSyncAt, null);
    assert.equal(result.evidence.time_created.string, 1); assert.equal(result.evidence.public_rating.number, 1);
    assert.equal(result.evidence.idConsistency.equal, 1);
    for (const value of [imported,result,await s.status(scope),alerts,stored]) assert.equal(JSON.stringify(value).includes(secretMarker), false);
    assert.equal(JSON.stringify(result).includes('envelope'), false); assert.equal(alerts.length, 0);
  });
  await cleanTest('READY to ERROR transition preserves credential material byte-for-byte', async () => {
    const s = service(); await s.importSession(scope, material, 0);
    const ready = await s.run(scope, { pageBase: 1 });
    const before = await store.read(scope);
    const transitioned = await store.transition(scope, ready.revision, {
      state: 'ERROR', error_code: 'YANDEX_NETWORK_ERROR'
    });
    const after = await store.read(scope);
    assert.equal(transitioned.state, 'ERROR');
    assert.equal(after.revision, before.revision + 1);
    assert.equal(after.credential_version, before.credential_version);
    assert.deepEqual(after.envelope, before.envelope);
    assert.equal(JSON.stringify(after.envelope), JSON.stringify(before.envelope));
    assert.equal(after.envelope.v, before.envelope.v);
    assert.equal(after.envelope.kid, before.envelope.kid);
    assert.equal(after.envelope.iv, before.envelope.iv);
    assert.equal(after.envelope.tag, before.envelope.tag);
    assert.equal(after.envelope.ciphertext, before.envelope.ciphertext);
  });
  await cleanTest('read approval gate and DISABLED prevent HTTP; disable erases credential', async () => {
    const s = service(); await s.importSession(scope, material, 0);
    await assert.rejects(service({ allowRead: false }).run(scope, { pageBase: 1 }), err('LIVE_READ_NOT_APPROVED'));
    assert.equal(calls, 0);
    await s.disable(scope, 1);
    assert.equal((await store.read(scope)).envelope, null);
    assert.equal((await s.run(scope, { pageBase: 1 })).state, 'DISABLED'); assert.equal(calls, 0);
    await s.importSession(scope, material, 2);
    assert.equal((await s.status(scope)).state, 'NOT_CONFIGURED');
  });
  const cases = [
    ['401', () => json({ error: secretMarker }, 401), 'REAUTH_REQUIRED','YANDEX_HTTP_401'],
    ['403', () => json({ error: secretMarker }, 403), 'REAUTH_REQUIRED','YANDEX_HTTP_403'],
    ['redirect', () => new Response('', { status: 302, headers: { location: `https://example.com/${secretMarker}` } }), 'REAUTH_REQUIRED','YANDEX_LOGIN_REDIRECT'],
    ['login HTML', () => new Response('<html><form>login</form></html>'), 'REAUTH_REQUIRED','YANDEX_LOGIN_HTML'],
    ['HTML captcha', () => new Response('<html>smartcaptcha</html>'), 'REAUTH_REQUIRED','YANDEX_CHALLENGE'],
    ['JSON challenge', () => json({ challenge: { token: secretMarker } }), 'REAUTH_REQUIRED','YANDEX_CHALLENGE'],
    ['malformed JSON', () => new Response('{broken', { headers: { 'content-type': 'application/json' } }), 'ERROR','YANDEX_MALFORMED_JSON'],
    ['contract drift', () => json(fixture('broken-schema')), 'ERROR','YANDEX_CONTRACT_DRIFT'],
    ['HTTP error', () => json({ message: secretMarker }, 500), 'ERROR','YANDEX_HTTP_ERROR']
  ];
  for (const [name,response,state,code] of cases) await cleanTest(`${name}: fail closed, no partial success, safe alert`, async () => {
    const s = service(); await s.importSession(scope, material, 0); http = response;
    const result = await s.run(scope, { pageBase: 1, mode: 'dry_run' });
    assert.equal(result.ok, false); assert.equal(result.state, state); assert.equal(result.errorCode, code);
    assert.equal(result.lastSuccessfulSyncAt, null); assert.equal(result.seen, undefined);
    assert.equal(alerts.length, 1); assert.equal(alerts[0].category, code);
    assert.equal(JSON.stringify([result,alerts,await store.read(scope)]).includes(secretMarker), false);
  });
  await cleanTest('decrypt failure: ERROR, 0 HTTP and one alert', async () => {
    await service().importSession(scope, material, 0);
    const result = await service({ keyring: { keys: {} } }).run(scope, { pageBase: 1 });
    assert.equal(result.errorCode, 'SESSION_DECRYPT_FAILED'); assert.equal(calls, 0); assert.equal(alerts.length, 1);
  });
  await cleanTest('partial page 2 failure does not stamp successful sync or touch reviews', async () => {
    const s = service(); await s.importSession(scope, material, 0);
    http = async () => pages.at(-1) === 1 ? json(fixture('page-1')) : json({}, 403);
    const result = await s.run(scope, { mode: 'dry_run', pageBase: 1 });
    assert.deepEqual(pages, [1,2]); assert.equal(result.ok, false); assert.equal(result.seen, undefined);
    assert.equal(result.lastSuccessfulSyncAt, null);
    assert.equal((await db.query('select count(*)::int n from review_external_reviews')).rows[0].n, 0);
  });
  await cleanTest('pagination + dedup dry-run uses existing provider; no review/matching/queue writes', async () => {
    const s = service(); await s.importSession(scope, material, 0);
    http = async () => {
      const payload = fixture(pages.at(-1) === 1 ? 'page-1' : 'duplicate-page-2');
      payload.list.pager.total = 4; // Stable server total includes the overlapping observation.
      return json(payload);
    };
    const result = await s.run(scope, { mode: 'dry_run', pageBase: 1 });
    assert.equal(result.ok, true); assert.equal(result.seen, 3); assert.equal(result.newCount, 3);
    assert.equal(result.reviewPersistence, 'OFF'); assert.ok(result.lastSuccessfulSyncAt);
    assert.deepEqual(pages, [1,2]);
    for (const table of ['review_external_reviews','review_sync_runs'])
      assert.equal((await db.query(`select count(*)::int n from ${table}`)).rows[0].n, 0);
  });
  for (const [label,company,location] of [['other company',B,LB],['other location',A,LA2],['same scope',A,LA]])
    await cleanTest(`dry-run identity snapshot: ${label} collision verdict`, async () => {
      await db.query(`insert into review_external_reviews(company_id,location_id,provider,external_review_id,external_location_id,review_text)
        values ($1,$2,'yandex','fixture-review-001',$3,'immutable-fixture')`, [company,location,ORG_ID]);
      const before = (await db.query('select * from review_external_reviews')).rows;
      const s = service(); await s.importSession(scope, material, 0);
      const result = await s.run(scope, { mode: 'dry_run', pageBase: 1 });
      assert.equal(result.ok, label === 'same scope');
      if (label === 'same scope') assert.equal(result.newCount, 0);
      else assert.equal(result.errorCode, 'REVIEW_SCOPE_COLLISION');
      assert.deepEqual((await db.query('select * from review_external_reviews')).rows, before);
    });
  await cleanTest('alert dedup per state incident, recovery resets; claim is atomic', async () => {
    const s = service(); await s.importSession(scope, material, 0); http = async () => json({}, 401);
    await s.run(scope, { pageBase: 1 }); await s.run(scope, { pageBase: 1 }); assert.equal(alerts.length, 1);
    http = async () => json({}, 403); await s.run(scope, { pageBase: 1 }); assert.equal(alerts.length, 1);
    http = async () => json(fixture('single-review')); await s.run(scope, { pageBase: 1 });
    http = async () => json({}, 403); await s.run(scope, { pageBase: 1 }); assert.equal(alerts.length, 2);
    assert.notEqual(alerts[0].incidentId, alerts[1].incidentId);
    const row = await store.read(scope);
    const claims = await Promise.all([store.claimAlert(scope,row.revision),store.claimAlert(scope,row.revision)]);
    assert.equal(claims.filter(c => c.claimed).length, 0);
  });
  await cleanTest('CAS replacement: one wins, old ciphertext replaced; stale result cannot mark READY', async () => {
    const s = service(); await s.importSession(scope, material, 0);
    const old = await store.read(scope);
    const results = await Promise.allSettled([s.importSession(scope,material,1),s.importSession(scope,material,1)]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(results.find(r => r.status === 'rejected').reason.code, 'SESSION_CHANGED');
    assert.notEqual((await store.read(scope)).envelope.ciphertext, old.envelope.ciphertext);
    http = async () => { await s.importSession(scope, material, 2); return json(fixture('single-review')); };
    await assert.rejects(s.run(scope, { pageBase: 1 }), err('SESSION_CHANGED'));
    assert.equal((await s.status(scope)).state, 'NOT_CONFIGURED'); assert.equal(alerts.length, 0);
  });
  await cleanTest('replacement during page 1 stops page 2 before HTTP; no failure overwrites replacement', async () => {
    const s = service(); await s.importSession(scope, material, 0);
    http = async () => { await s.importSession(scope, material, 1); return json(fixture('page-1')); };
    await assert.rejects(s.run(scope, { mode: 'dry_run', pageBase: 1 }), err('SESSION_CHANGED'));
    assert.equal(calls, 1); assert.equal((await s.status(scope)).state, 'NOT_CONFIGURED');
  });
  await cleanTest('first concurrent alert claim wins once; failure preserves last successful read timestamps', async () => {
    const s = service(); await s.importSession(scope, material, 0);
    const success = await s.run(scope, { mode: 'dry_run', pageBase: 1 });
    const next = await store.transition(scope, success.revision, { state:'ERROR',error_code:'YANDEX_NETWORK_ERROR' });
    const claims = await Promise.all([store.claimAlert(scope,next.revision),store.claimAlert(scope,next.revision)]);
    assert.equal(claims.filter(c => c.claimed).length, 1);
    http = async () => { throw new Error(secretMarker); };
    const logs = []; const original = { log: console.log, error: console.error, warn: console.warn };
    for (const key of Object.keys(original)) console[key] = (...args) => logs.push(args);
    let failure;
    try { failure = await s.run(scope, { mode: 'dry_run', pageBase: 1 }); }
    finally { Object.assign(console, original); }
    assert.equal(failure.lastSuccessfulSyncAt, success.lastSuccessfulSyncAt);
    assert.equal(failure.lastSessionCheckAt, success.lastSessionCheckAt);
    assert.deepEqual(logs, []); assert.equal(alerts.length, 0);
  });
  await cleanTest('key rotation uses retained old key, resets READY until health; old key removable', async () => {
    const s = service(); await s.importSession(scope, material, 0);
    const rotated = service({ keyring: { ...ring, currentKid: 'fixture-k2' } });
    assert.equal((await rotated.rotateKey(scope, 1)).state, 'NOT_CONFIGURED');
    const row = await store.read(scope); assert.equal(row.envelope.kid, 'fixture-k2');
    assert.deepEqual(decryptSession(scope, row, { keys: { 'fixture-k2': ring.keys['fixture-k2'] } }), material);
  });
  await cleanTest('scope checks prevent another company location; SQL rejects plaintext/null envelope fields', async () => {
    await assert.rejects(service().importSession({ ...scope, locationId: LB }, material, 0), err('SESSION_SCOPE_INVALID'));
    const encrypted = encryptSession(scope, material, ring);
    for (const envelope of [{ cookies: [] }, { ...encrypted.envelope, kid: null }, { ...encrypted.envelope, v: '1' }, { ...encrypted.envelope, csrf: 'x' }])
      await assert.rejects(store.replace(scope,0,{ ...encrypted,envelope }), err('SESSION_STORAGE_FAILED'));
    await assert.rejects(db.query(`insert into review_private.yandex_sessions(company_id,location_id,external_org_id) values ($1,$2,$3)`, [A,LB,ORG_ID]), { code: '23503' });
    assert.equal((await db.query('select count(*)::int n from review_private.yandex_sessions')).rows[0].n, 0);
  });
  await cleanTest('page base probe: zero-based confirmed by offsets, mismatch hard fails', async () => {
    const s = service(); await s.importSession(scope, material, 0);
    http = async () => json(fixture(pages.at(-1) === 0 ? 'page-1' : 'page-2'));
    const result = await s.run(scope, { mode: 'probe', pageBase: 0 });
    assert.equal(result.ok, true); assert.match(result.pageBaseStatus, /PENDING/); assert.deepEqual(pages,[0,1]);
    const mismatch = await s.run(scope, { mode: 'probe', pageBase: 1 });
    assert.equal(mismatch.errorCode, 'PAGE_BASE_MISMATCH');
  });
  await cleanTest('page base probe: explicit page 0 rejection supports base 1; aliases ambiguous', async () => {
    const s = service(); await s.importSession(scope, material, 0);
    http = async () => pages.at(-1) === 0 ? json({ message: 'unsupported page' }, 400) : json(fixture('single-review'));
    assert.equal((await s.run(scope, { mode: 'probe', pageBase: 1 })).ok, true);
    http = async () => json(fixture('single-review'));
    assert.equal((await s.run(scope, { mode: 'probe', pageBase: 1 })).errorCode, 'PAGE_BASE_AMBIGUOUS');
  });
  await cleanTest('empty valid list succeeds; malformed pagination never succeeds', async () => {
    const s = service(); await s.importSession(scope, material, 0); http = async () => json(fixture('empty'));
    const result = await s.run(scope, { mode: 'dry_run', pageBase: 1 });
    assert.equal(result.ok, true); assert.equal(result.seen, 0);
    const broken = fixture('single-review'); broken.list.pager.offset = 20; http = async () => json(broken);
    assert.equal((await s.run(scope, { pageBase: 1 })).ok, false);
  });
  await db.exec('reset role');
  await t.test('legacy index retained, scheduler paused, no public mutations added', async () => {
    assert.ok((await db.query("select to_regclass('public.review_external_reviews_provider_external_id_uq') as name")).rows[0].name);
    assert.equal((await db.query('select active from cron.job')).rows[0].active, false);
    assert.doesNotMatch(migration, /cron\.(?:alter_job|schedule)|create policy|grant execute[^;]+to anon/i);
  });
  await t.test('deferred index plan reuses session supporting constraint; rollback preserves global index', async () => {
    await db.exec('begin');
    try { await db.exec(read('./fixtures/db/scoped-index-plan.sql')); }
    finally { await db.exec('rollback'); }
    assert.ok((await db.query("select to_regclass('public.review_external_reviews_provider_external_id_uq') as name")).rows[0].name);
  });
  await t.test('exact read-only DEV verification script denies planned writes and leaves storage empty', async () => {
    await db.exec('truncate review_private.yandex_sessions'); // LOCAL fixture cleanup, never part of DEV script.
    const results = await db.exec(read('./yandex-session-dev-verification.sql'));
    assert.match(results.at(-1).rows[0].verification, /^PASS:/);
  });
});

test('alerts reuse Telegram/Resend with fixed safe metadata and sanitized channel errors', async t => {
  const keys = ['TELEGRAM_BOT_TOKEN','TELEGRAM_CHAT_ID','RESEND_API_KEY','REVIEW_EMAIL_FROM','NEGATIVE_REVIEW_EMAIL_TO'];
  const previous = Object.fromEntries(keys.map(k => [k,process.env[k]]));
  const originalFetch = globalThis.fetch; const sent = [];
  t.after(() => { globalThis.fetch = originalFetch; for (const k of keys) previous[k] === undefined ? delete process.env[k] : process.env[k] = previous[k]; });
  for (const k of keys) process.env[k] = `fixture-${k}`;
  globalThis.fetch = async (url, options) => { sent.push({ url, options }); return json(url.includes('telegram') ? { ok:true,result:{ message_id: 42 } } : { id: 'fixture-id' }); };
  const value = { scope, state:'REAUTH_REQUIRED',category:'YANDEX_HTTP_401',timestamp:'2026-09-12T10:00:00.000Z',incidentId:A };
  const result = await sendSessionAlert(value);
  assert.equal(sent.length, 2); assert.equal(JSON.stringify(sent).includes(secretMarker), false);
  assert.equal(JSON.stringify(result).includes('fixture-TELEGRAM'), false);
  assert.match(sent[0].options.body, /provider=yandex/); assert.match(sent[0].options.body, /action=Manually reauthenticate/);
  assert.equal(sent[1].options.headers['Idempotency-Key'], `yandex-session/${A}`);
  assert.equal((await sendTelegramMessage({ text: '<b>existing feedback</b>', parseMode: 'HTML' })).messageId, 42);
  assert.equal(JSON.parse(sent.at(-1).options.body).parse_mode, 'HTML');
  globalThis.fetch = async () => { throw new Error(secretMarker); };
  const failure = await sendSessionAlert(value); assert.equal(JSON.stringify(failure).includes(secretMarker), false);
  await assert.rejects(sendTelegramMessage({ text: 'fixture' }), err('TELEGRAM_SEND_FAILED'));
});

test('server RPC and operator CLI reject invalid input without logging sensitive values', async () => {
  let calls = 0;
  await assert.rejects(requestDevServiceRpc('arbitrary', {}, { key: 'sb_secret_fixture',fetchImpl: async () => { calls++; } }), err('SERVER_RPC_NOT_ALLOWED'));
  assert.equal(calls, 0);
  const result = spawnSync(process.execPath, ['--import','./test/support/no-network.mjs','scripts/yandex-session.mjs','import'], {
    cwd: new URL('../', import.meta.url), input: JSON.stringify({ password: secretMarker }), encoding: 'utf8',
    env: { ...process.env, SUPABASE_SERVICE_ROLE_KEY: '', YANDEX_SESSION_KEYS_JSON: '', YANDEX_SESSION_ACTIVE_KID: '' }
  });
  assert.notEqual(result.status, 0); assert.equal((result.stdout + result.stderr).includes(secretMarker), false);
  assert.doesNotMatch(result.stderr, /\bat .*\.m?js:/);
  for (const file of ['../index.html','../admin.html']) {
    assert.doesNotMatch(read(file), /SUPABASE_SERVICE_ROLE_KEY|YANDEX_SESSION_KEYS_JSON|yandex-session\//);
  }
});
