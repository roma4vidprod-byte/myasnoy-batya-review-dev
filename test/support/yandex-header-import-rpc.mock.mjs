// Synthetic roundtrip only: reuse the original import mock (fixed DEV RPC, one call).
import './yandex-import-rpc.mock.mjs';
import assert from 'node:assert/strict';
import { decryptSession } from '../../lib/server/yandex-session/crypto.js';
const mockRpc = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const body = JSON.parse(options.body);
  const session = decryptSession({companyId:body.p_company_id,locationId:body.p_location_id,organizationId:body.p_org_id},body.p_data,{currentKid:'fixture',keys:{fixture:Buffer.alloc(32)}});
  assert.equal(session.cookies.length,2);
  assert.deepEqual(session.cookies.map(c => c.name),['fixture','fixture_two']);
  assert.deepEqual(session.cookies.map(c => c.value),['synthetic-cookie-one==','synthetic-cookie-%2F+two']);
  for (const c of session.cookies) {
    assert.equal(c.domain,'.yandex.ru'); assert.equal(c.path,'/sprav/api/');
    assert.equal(c.secure,true); assert.equal(c.httpOnly,false);
    assert.equal(c.expires === -1 || c.expires === 4070934000,true);
  }
  return mockRpc(url, options);
};
