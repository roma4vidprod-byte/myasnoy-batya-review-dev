import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const access=readFileSync(new URL('../tools/vps14/reply-worker-access.sql',import.meta.url),'utf8');
const store=readFileSync(new URL('../tools/vps14/reply-worker-store.mjs',import.meta.url),'utf8');

test('VPS14 writer access is exact-scope, peer-role only and read-only for session material',()=>{
  for(const value of [
    "current_database() <> 'review_activator_lab'",
    "session_user <> 'review-yandex-writer'",
    "'13f3cb80-487a-4a19-96a1-fb3103200230'::uuid",
    "'9a95f63b-18e6-447b-a449-8530b67ddbae'::uuid",
    "'54309413522'",
    "'read'",
    "review_yandex_session_store",
    "reply_session_read"
  ])assert.ok(access.includes(value),value);
  assert.doesNotMatch(access,/\b(insert|update|delete)\s+(?:into\s+|from\s+)?review_private\.yandex_sessions/i);
  assert.doesNotMatch(access,/https?:\/\//i);
});

test('VPS14 writer session function is granted only to writer and revoked from browser/read roles',()=>{
  assert.match(access,/revoke all on function vps_yandex_private\.reply_session_read\(\)[\s\S]*from public,anon,authenticated,service_role,[\s\S]*"review-yandex-reader","review-yandex-import"/i);
  assert.match(access,/grant execute on function vps_yandex_private\.reply_session_read\(\)[\s\S]*to "review-yandex-writer"/i);
  assert.match(access,/owner to vps_yandex_owner/i);
});

test('VPS14 worker store uses fixed peer PostgreSQL boundary with no password or dynamic destination',()=>{
  for(const value of [
    "'/usr/lib/postgresql/17/bin/psql'",
    "'/var/run/postgresql'",
    "'review-yandex-writer'",
    "'review_activator_lab'",
    "PGCONNECT_TIMEOUT:'3'",
    "statement_timeout=10000",
    "lock_timeout=3000"
  ])assert.ok(store.includes(value),value);
  assert.doesNotMatch(store,/PGPASSWORD|password\s*:/i);
  assert.doesNotMatch(store,/process\.env\.(?:PGHOST|PGDATABASE|PGUSER|DATABASE_URL|SUPABASE)/);
  assert.doesNotMatch(store,/https?:\/\//i);
});

test('VPS14 worker store exposes only fixed claim finish and session read calls',()=>{
  assert.match(store,/select vps_yandex_private\.reply_worker_claim_next\(\)/);
  assert.match(store,/select vps_yandex_private\.reply_worker_finish\('complete'/);
  assert.match(store,/select vps_yandex_private\.reply_worker_finish\('fail'/);
  assert.match(store,/select vps_yandex_private\.reply_session_read\(\)/);
  assert.doesNotMatch(store,/\beval\s*\(|new Function|exec\s*\(/);
});

test('VPS14 worker store validates bounded claim and safe errors before SQL',()=>{
  assert.match(store,/value\.reply_text\.length>2500/);
  assert.match(store,/value\.attempt_count!==1/);
  assert.match(store,/SAFE_FAILURES\.has\(errorCode\)/);
  assert.match(store,/REPLY_WORKER_STORAGE_INPUT_INVALID/);
  assert.match(store,/REPLY_WORKER_CLAIM_INVALID/);
  assert.match(store,/REPLY_WORKER_STORAGE_FAILED/);
});
