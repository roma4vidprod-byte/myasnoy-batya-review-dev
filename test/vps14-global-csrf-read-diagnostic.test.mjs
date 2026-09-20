import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src=readFileSync(
  new URL('../tools/vps14/global-csrf-read-diagnostic.mjs',import.meta.url),
  'utf8'
);

test('VPS14 global CSRF diagnostic is GET-only',()=>{
  assert.match(src,/method:'GET'/);
  assert.match(src,/provider_writes:0/);
  assert.match(src,/answer_endpoint_called:false/);
  assert.doesNotMatch(src,/method:\s*['"]POST['"]/);
  assert.doesNotMatch(src,/business-answer/i);
});

test('VPS14 global CSRF diagnostic emits aggregates, never token values',()=>{
  for(const value of [
    'csrf_key_occurrences',
    'csrf_value_candidate_count',
    'csrf_candidate_lengths',
    'preload_marker',
    'content_type'
  ])assert.ok(src.includes(value),value);
  for(const forbidden of [
    'csrf_value:',
    'csrfToken:',
    'cookie_value',
    'session.cookies.map(c=>c.value)'
  ])assert.equal(src.includes(forbidden),false,forbidden);
});

test('VPS14 global CSRF diagnostic requires READY fixed session scope',()=>{
  assert.match(src,/row\.state!=='READY'/);
  assert.match(src,/VPS_SESSION_SCOPE as scope/);
  assert.match(src,/review-yandex-reader/);
});
