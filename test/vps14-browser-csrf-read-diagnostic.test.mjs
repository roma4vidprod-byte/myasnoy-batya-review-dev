import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root=new URL('../tools/yandex-csrf-read-diagnostic/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',root),'utf8'));
const content=readFileSync(new URL('content.js',root),'utf8');
const popup=readFileSync(new URL('popup.js',root),'utf8');

test('VPS14 CSRF browser diagnostic is a separate minimal extension',()=>{
  assert.deepEqual(manifest.permissions,[]);
  assert.deepEqual(manifest.host_permissions,['https://yandex.ru/*']);
  assert.equal(manifest.incognito,'not_allowed');
  assert.equal(manifest.content_scripts.length,1);
  assert.deepEqual(manifest.content_scripts[0].matches,['https://yandex.ru/sprav/*']);
  assert.deepEqual(manifest.content_scripts[0].js,['content.js']);
  assert.match(manifest.content_security_policy.extension_pages,/connect-src 'none'/);
});

test('VPS14 CSRF browser content script performs one GET-only fixed-endpoint diagnostic',()=>{
  assert.match(content,/https:\/\/yandex\.ru\/sprav\/api\/view\/chain\/0\/list\//);
  assert.match(content,/method:'GET'/);
  assert.match(content,/credentials:'include'/);
  assert.match(content,/redirect:'manual'/);
  assert.match(content,/let consumed=false/);
  assert.match(content,/consumed=true/);
  assert.doesNotMatch(content,/method:\s*['"]POST['"]/);
  assert.doesNotMatch(content,/business-answer/i);
  assert.doesNotMatch(content,/chrome\.cookies|nativeMessaging|connectNative/);
});

test('VPS14 CSRF browser diagnostic returns aggregates only',()=>{
  for(const value of [
    'csrf_present','csrf_length','provider_requests:1','provider_writes:0',
    'answer_endpoint_called:false','PASS_CSRF_PRESENT',
    'CSRF_GET_CONTRACT_NOT_PROVEN'
  ])assert.ok(content.includes(value),value);
  assert.doesNotMatch(content,/sendResponse\([^)]*csrf\s*:/s);
  assert.doesNotMatch(content,/token\s*:/i);
  assert.doesNotMatch(popup,/\bfetch\s*\(|chrome\.cookies|connectNative|nativeMessaging/);
});

test('VPS14 CSRF browser diagnostic is exact-org and exact-message gated',()=>{
  assert.match(content,/54309413522/);
  assert.match(content,/message\.op!=='csrf_get_diagnostic'/);
  assert.match(content,/sender\.id!==chrome\.runtime\.id/);
  assert.match(popup,/csrf_get_diagnostic/);
  assert.match(popup,/54309413522/);
});
