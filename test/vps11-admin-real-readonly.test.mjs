import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql=readFileSync(new URL('../tools/vps11/asbest-readonly.sql',import.meta.url),'utf8');
const config=readFileSync(new URL('../lib/server/vps/lab-config.js',import.meta.url),'utf8');
const start=readFileSync(new URL('../scripts/start-vps-lab.mjs',import.meta.url),'utf8');

test('VPS11 exposes only the fixed Asbest read-only scope',()=>{
  for(const value of [
    '13f3cb80-487a-4a19-96a1-fb3103200230',
    '9a95f63b-18e6-447b-a449-8530b67ddbae',
    '54309413522',
    'owner@vps04.invalid',
    'vps_lab_private.has_company(p_company_id)',
    'COMPANY_ACCESS_DENIED',
    'REVIEW_SCOPE_INVALID'
  ]) assert.ok(sql.includes(value),value);
  assert.match(sql,/p_company_id not in \([\s\S]*10000000-0000-4000-8000-000000000001[\s\S]*10000000-0000-4000-8000-000000000002[\s\S]*13f3cb80-487a-4a19-96a1-fb3103200230/);
});

test('VPS11 remains read-only for reviews and browser role',()=>{
  assert.doesNotMatch(sql,/insert\s+into\s+(?:public\.)?review_external_reviews/i);
  assert.doesNotMatch(sql,/update\s+(?:public\.)?review_external_reviews/i);
  assert.doesNotMatch(sql,/delete\s+from\s+(?:public\.)?review_external_reviews/i);
  assert.match(sql,/revoke all on function[\s\S]*from public,anon,service_role/i);
  assert.match(sql,/grant execute on function[\s\S]*to authenticated/i);
});

test('VPS11 runtime scope is explicit and fail-closed',()=>{
  assert.match(config,/RA_LAB_ADMIN_SCOPE/);
  assert.match(config,/asbest-readonly/);
  assert.match(config,/VPS_LAB_ADMIN_SCOPE_INVALID/);
  assert.match(start,/scope:config\.adminScope/);
  assert.doesNotMatch(start,/externalLocationId:'lab-org-a'/);
});
