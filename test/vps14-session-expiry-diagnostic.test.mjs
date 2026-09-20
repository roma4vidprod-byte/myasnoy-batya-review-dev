import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const src=readFileSync(
  new URL('../tools/vps14/session-expiry-diagnostic.mjs',import.meta.url),
  'utf8'
);

test('VPS14 expiry diagnostic has zero provider IO',()=>{
  assert.match(src,/provider_requests:0/);
  assert.match(src,/provider_writes:0/);
  assert.doesNotMatch(src,/\bfetch\s*\(/);
  assert.doesNotMatch(src,/https?:\/\//i);
});

test('VPS14 expiry diagnostic emits only aggregate TTL evidence',()=>{
  for(const value of [
    'cookie_count','session_cookie_count','persistent_cookie_count',
    'expired_now','expiring_5m','expiring_30m','expiring_1h',
    'expiring_6h','expiring_24h','min_ttl_seconds','max_ttl_seconds'
  ])assert.ok(src.includes(value),value);
  assert.equal(src.includes('cookie.name'),false);
  assert.equal(src.includes('cookies:'),false);
  assert.equal(src.includes('cookie_value'),false);
});

test('VPS14 expiry diagnostic is reader-only and fixed-scope',()=>{
  assert.match(src,/review-yandex-reader/);
  assert.match(src,/VPS_SESSION_SCOPE as scope/);
  assert.match(src,/decryptSessionClassified\(scope,row,ring,0,context\)/);
});
