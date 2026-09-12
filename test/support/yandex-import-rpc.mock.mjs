// Loaded only by offline import tests; never by the production CLI.
import assert from 'node:assert/strict';
let calls = 0;
globalThis.fetch = async (url, options) => {
  calls++;
  assert.equal(calls, 1);
  assert.equal(url, 'https://ykiubttldgyjpajmsuas.supabase.co/rest/v1/rpc/review_yandex_session_store');
  assert.equal(options.method, 'POST');
  assert.equal(process.env.YANDEX_LIVE_READ_APPROVAL, undefined);
  assert.equal(process.env.TELEGRAM_BOT_TOKEN, undefined);
  assert.equal(process.env.RESEND_API_KEY, undefined);
  const body = JSON.parse(options.body);
  assert.equal(body.p_action, 'replace'); assert.equal(body.p_expected_revision, 0);
  assert.equal(body.p_company_id, '13f3cb80-487a-4a19-96a1-fb3103200230');
  assert.equal(body.p_location_id, '9a95f63b-18e6-447b-a449-8530b67ddbae');
  assert.equal(body.p_org_id, '54309413522');
  assert.deepEqual(Object.keys(body.p_data).sort(), ['credential_version', 'envelope']);
  assert.equal(body.p_data.envelope.v, 1);
  assert.equal(body.p_data.envelope.kid, 'fixture');
  assert.equal(typeof body.p_data.envelope.ciphertext, 'string');
  assert.equal(options.body.includes('synthetic-cookie-'), false);
  assert.equal(options.body.includes('cookies'), false);
  if (process.env.IMPORT_TEST_MODE === 'error') return Response.json({ message: 'SESSION_CHANGED' }, { status: 400 });
  if (process.env.IMPORT_TEST_MODE === 'bad_result') return Response.json({ state: ['NOT_CONFIGURED'], revision: 1 });
  return Response.json({ state: 'NOT_CONFIGURED', revision: 1 });
};
process.on('beforeExit', () => { if (calls !== 1) process.exitCode = 1; });
