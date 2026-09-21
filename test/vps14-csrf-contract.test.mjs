import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  YANDEX_CSRF_ENDPOINT,buildYandexCsrfCandidate,classifyYandexCsrfResponse
} from '../lib/server/yandex-session/csrf-contract.js';

test('VPS14 CSRF token contract is pure and fixed-endpoint',()=>{
  const request=buildYandexCsrfCandidate();
  assert.equal(request.method,'POST');
  assert.equal(request.url,'https://yandex.ru/sprav/api/view/chain/0/list/');
  assert.equal(request.url,YANDEX_CSRF_ENDPOINT);
  assert.equal(request.ensureCookieI,true);
  assert.equal(request.body,null);
  const src=readFileSync(new URL('../lib/server/yandex-session/csrf-contract.js',import.meta.url),'utf8');
  assert.doesNotMatch(src,/\bfetch\s*\(/);
  assert.doesNotMatch(src,/business-answer/);
});

test('VPS14 CSRF token classifier accepts only exact 488 JSON contract',()=>{
  const ok=classifyYandexCsrfResponse({
    status:488,contentType:'application/json',
    text:JSON.stringify({csrf:'SYNTHETIC_CSRF_TOKEN_123'})
  });
  assert.deepEqual(ok,{
    ok:true,code:'YANDEX_CSRF_AVAILABLE',token:'SYNTHETIC_CSRF_TOKEN_123'
  });
  for(const input of [
    {status:200,contentType:'application/json',text:'{}'},
    {status:488,contentType:'text/html',text:'<html></html>'},
    {status:488,contentType:'application/json',text:'not-json'},
    {status:488,contentType:'application/json',text:'{}'},
    {status:488,contentType:'application/json',text:JSON.stringify({csrf:'short'})},
    {status:488,contentType:'application/json',text:JSON.stringify({csrf:'SYNTHETIC_CSRF_TOKEN_123',extra:true})}
  ])assert.equal(classifyYandexCsrfResponse(input).ok,false);
});

test('VPS14 CSRF classifier fails closed on auth redirect and rate limit',()=>{
  assert.equal(classifyYandexCsrfResponse({status:401,contentType:'application/json',text:''}).code,'YANDEX_CSRF_HTTP_401');
  assert.equal(classifyYandexCsrfResponse({status:403,contentType:'application/json',text:''}).code,'YANDEX_CSRF_HTTP_403');
  assert.equal(classifyYandexCsrfResponse({status:302,contentType:'text/html',text:'',location:'https://passport.yandex.ru/'}).code,'YANDEX_CSRF_REDIRECT');
  assert.equal(classifyYandexCsrfResponse({status:429,contentType:'application/json',text:'{}'}).code,'YANDEX_CSRF_RATE_LIMITED');
});
