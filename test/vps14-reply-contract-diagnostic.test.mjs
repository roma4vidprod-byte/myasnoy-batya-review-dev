import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src=readFileSync(
  new URL('../tools/vps14/reply-contract-diagnostic.mjs',import.meta.url),
  'utf8'
);

test('VPS14 diagnostic is read-only and one-request bounded',()=>{
  assert.match(src,/createYandexReadTransport/);
  assert.match(src,/method:'GET'/);
  assert.match(src,/page:1/);
  assert.match(src,/provider_writes:0/);
  assert.match(src,/answer_endpoint_called:false/);
  assert.doesNotMatch(src,/method:\s*['"]POST['"]/);
  assert.doesNotMatch(src,/business-answer/);
});
test('VPS14 diagnostic reports only aggregate contract evidence',()=>{
  for(const literal of [
    'list_csrf_type',
    'list_csrf_present',
    'business_answer_token_present',
    'business_answer_token_types',
    'author_privacy_present',
    'author_privacy_types',
    'review_ids_present',
    'unanswered'
  ]) assert.ok(src.includes(literal),literal);

  for(const forbidden of [
    'reply_text',
    'review_text',
    'cookie:',
    'cookies:',
    'csrf_token:',
    'business_answer_csrf_token:'
  ]) assert.equal(src.includes(forbidden),false,forbidden);
});
