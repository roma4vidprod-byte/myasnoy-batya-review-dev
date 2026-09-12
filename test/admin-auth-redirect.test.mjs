import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const admin = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');

test('DEV auth callbacks use an exact origin allowlist', () => {
  for (const literal of [
    "local:'http://127.0.0.1:4173'",
    "production:'https://myasnoy-batya-review-dev.vercel.app'",
    "throw Error('AUTH_ORIGIN_NOT_ALLOWED')",
    "origin===AUTH_ORIGINS.local?'/admin.html':'/admin'",
    "emailRedirectTo:redirect",
    "redirectTo:redirect"
  ]) assert.ok(admin.includes(literal), `missing redirect contract: ${literal}`);
  assert.equal(admin.includes("emailRedirectTo:location.origin"), false);
  assert.equal(admin.includes("redirectTo:location.origin"), false);
  assert.equal(admin.includes('javascript:'), false);
  assert.equal(admin.includes('window.open'), false);
});

test('auth callback cleans token-bearing URL state only after session establishment', () => {
  for (const literal of [
    'detectSessionInUrl:true',
    'history.replaceState',
    'access_token',
    'refresh_token',
    "clearAuthUrl(recovery)",
    "clearAuthUrl(false)",
    "e==='PASSWORD_RECOVERY'",
    "e==='SIGNED_IN'"
  ]) assert.ok(admin.includes(literal), `missing callback handling: ${literal}`);
  assert.equal((admin.match(/client\.auth\.onAuthStateChange/g) || []).length, 1);
  assert.equal((admin.match(/\(async\(\)=>\{/g) || []).length, 1);
  assert.equal(admin.includes('console.log'), false);
  assert.equal(admin.includes('console.error'), false);
});

test('admin page keeps unauthenticated and non-admin guards', () => {
  assert.ok(admin.includes("if(!session)return showAuth()"));
  assert.ok(admin.includes("client.rpc('review_admin_profile')"));
  assert.ok(admin.includes("client.rpc('review_admin_reviews_scoped'"));
});
