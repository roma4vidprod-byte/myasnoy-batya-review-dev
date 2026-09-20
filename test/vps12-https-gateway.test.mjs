import test from 'node:test';
import assert from 'node:assert/strict';
import {isAllowedRequest,rewriteAdmin} from '../tools/vps12/https-gateway.mjs';

test('VPS12 gateway allows only admin read/auth/scoped review paths',()=>{
  for(const [method,url] of [
    ['GET','/admin.html'],
    ['GET','/healthz'],
    ['GET','/readyz'],
    ['POST','/auth/v1/token?grant_type=password'],
    ['POST','/auth/v1/token?grant_type=refresh_token'],
    ['GET','/auth/v1/user'],
    ['PUT','/auth/v1/user'],
    ['POST','/auth/v1/logout'],
    ['POST','/rest/v1/rpc/review_admin_profile'],
    ['POST','/rest/v1/rpc/review_admin_reviews_scoped']
  ])assert.equal(isAllowedRequest(method,url),true,method+' '+url);
});

test('VPS12 gateway denies mutation and arbitrary paths',()=>{
  for(const [method,url] of [
    ['POST','/rest/v1/rpc/review_admin_save_reply_draft'],
    ['POST','/api/admin-review-reply-draft'],
    ['POST','/rest/v1/rpc/review_claim_initial_owner'],
    ['GET','/rest/v1/review_external_reviews'],
    ['POST','/auth/v1/token?grant_type=signup'],
    ['GET','/']
  ])assert.equal(isAllowedRequest(method,url),false,method+' '+url);
});

test('VPS12 rewrites only lab origin and operator identity',()=>{
  const src='http://127.0.0.1:13000 owner@vps04.invalid Myasnoibatya@yandex.ru';
  const out=rewriteAdmin(src,'https://review-83-217-214-29.sslip.io');
  assert.equal(out.includes('http://127.0.0.1:13000'),false);
  assert.equal(out.includes('owner@vps04.invalid'),false);
  assert.match(out,/https:\/\/review-83-217-214-29\.sslip\.io/);
  assert.equal((out.match(/tas\.food@yandex\.ru/g)||[]).length,2);
});
