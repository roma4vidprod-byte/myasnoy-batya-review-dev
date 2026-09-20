import test from 'node:test';
import assert from 'node:assert/strict';
import {
  YANDEX_REPLY_ENDPOINT,YANDEX_REPLY_MAX_LENGTH,
  buildYandexReplyCandidate,classifyYandexReplyResponse
} from '../lib/server/yandex-session/reply-contract.js';

const scope={
  companyId:'13f3cb80-487a-4a19-96a1-fb3103200230',
  locationId:'9a95f63b-18e6-447b-a449-8530b67ddbae',
  organizationId:'54309413522'
};

test('VPS14 candidate request is fixed-scope and pure',()=>{
  const request=buildYandexReplyCandidate({
    scope,reviewId:'review-1',replyText:'Спасибо за отзыв',
    csrfToken:'global-csrf-token',
    reviewsCsrfToken:'reviews-csrf-token',
    answerCsrfToken:'answer-csrf-token'
  });
  assert.equal(request.method,'POST');
  assert.equal(request.url,YANDEX_REPLY_ENDPOINT);
  assert.deepEqual(request.body,{
    reviewId:'review-1',
    text:'Спасибо за отзыв',
    reviewsCsrfToken:'reviews-csrf-token',
    answerCsrfToken:'answer-csrf-token'
  });
  assert.equal(request.headers['X-CSRF-Token'],'global-csrf-token');
});

test('VPS14 publish boundary enforces provider text limit',()=>{
  assert.equal(YANDEX_REPLY_MAX_LENGTH,2500);
  assert.throws(()=>buildYandexReplyCandidate({
    scope,reviewId:'r',replyText:'x'.repeat(2501),
    csrfToken:'global-token',reviewsCsrfToken:'reviews-token'
  }),/YANDEX_REPLY_TEXT_INVALID/);
});

test('VPS14 candidate rejects foreign scope',()=>{
  assert.throws(()=>buildYandexReplyCandidate({
    scope:{...scope,organizationId:'other'},
    reviewId:'r',replyText:'ok',
    csrfToken:'global-token',reviewsCsrfToken:'reviews-token'
  }),/YANDEX_REPLY_SCOPE_INVALID/);
});

test('VPS14 response is successful only on exact 200 OK',()=>{
  assert.deepEqual(classifyYandexReplyResponse({
    status:200,contentType:'text/plain',text:'OK'
  }),{ok:true,code:'YANDEX_REPLY_ACCEPTED'});
  for(const value of [
    {status:200,text:'{"ok":true}'},
    {status:200,text:'<html>login</html>'},
    {status:302,text:''},
    {status:401,text:''},
    {status:403,text:''},
    {status:488,text:''},
    {status:429,text:''},
    {status:500,text:''}
  ])assert.equal(classifyYandexReplyResponse(value).ok,false);
});

test('VPS14 contract module has no network execution',async()=>{
  const src=await import('node:fs').then(({readFileSync})=>
    readFileSync(new URL('../lib/server/yandex-session/reply-contract.js',import.meta.url),'utf8'));
  assert.doesNotMatch(src,/\bfetch\s*\(/);
  assert.doesNotMatch(src,/globalThis\.fetch/);
});
