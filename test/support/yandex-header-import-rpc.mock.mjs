// Synthetic roundtrip only: reuse the original import mock (fixed DEV RPC, one call).
import './yandex-import-rpc.mock.mjs';
import assert from 'node:assert/strict';
import { decryptSession } from '../../lib/server/yandex-session/crypto.js';
const mockRpc = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const body = JSON.parse(options.body);
  if (body.p_action === 'read') return mockRpc(url, options);
  const session = decryptSession({companyId:body.p_company_id,locationId:body.p_location_id,organizationId:body.p_org_id},body.p_data,{currentKid:'fixture',keys:{fixture:Buffer.alloc(32)}});
  assert.equal(session.cookies.length,2);
  assert.deepEqual(session.cookies.map(c => c.name),['fixture','fixture_two']);
  assert.deepEqual(session.cookies.map(c => c.value),['synthetic-cookie-one==','synthetic-cookie-%2F+two']);
  assert.equal(session.cookies[0].domain,'.yandex.ru'); assert.equal(session.cookies[0].path,'/sprav/api/');
  assert.equal(session.cookies[0].httpOnly,false);
  assert.equal(session.cookies[0].expires === -1 || session.cookies[0].expires === 4070934000,true);
  assert.equal(session.cookies[1].domain,'yandex.ru'); assert.equal(session.cookies[1].path,'/');
  assert.equal(session.cookies[1].httpOnly,true); assert.equal(session.cookies[1].expires,4070934000);
  assert.equal(session.cookies.every(c => c.secure),true);
  return mockRpc(url, options);
};
