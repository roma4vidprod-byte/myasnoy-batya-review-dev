import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = join(root, 'supabase/migrations/20260912090000_review_activator_canonical_baseline.sql');
const recovery09aPath = join(root, 'supabase/migrations/20260914230000_recovery09_scheduler_acl_09a.sql');

const read = path => readFile(path, 'utf8');

test('VPS03 baseline is the pre-chain application schema, not a data fixture', async () => {
  const sql = await read(baselinePath);
  assert.match(sql, /canonical fresh-schema baseline/i);
  assert.match(sql, /predates the retained/i);
  assert.doesNotMatch(sql, /create\s+extension\s+pg_cron/i);
  assert.doesNotMatch(sql, /create\s+table\s+review_private\.yandex_sessions/i);
  assert.match(sql, /create table public\.review_external_reviews/i);
  assert.match(sql, /alter table public\.%I enable row level security/i);
  assert.doesNotMatch(sql, /force row level security/i);
  assert.match(sql, /create unique index review_admins_email_lower_uq/i);
  assert.match(sql, /grant usage on schema public to postgres, anon, authenticated, service_role/i);
});

test('VPS03 baseline keeps server-only scheduler and auth compatibility explicit', async () => {
  const sql = await read(baselinePath);
  assert.match(sql, /Migration-only scheduler catalog boundary/i);
  assert.match(sql, /create schema if not exists auth/i);
  assert.match(sql, /create or replace function auth\.uid/i);
  assert.match(sql, /create or replace function auth\.jwt/i);
  assert.doesNotMatch(sql, /insert\s+into\s+cron\.job/i);
  assert.doesNotMatch(sql, /review-provider-due-check-hourly/i);
});

test('Recovery09A remains an owner-gated candidate and is not folded into the baseline', async () => {
  const baseline = await read(baselinePath);
  const candidate = await read(recovery09aPath);
  assert.doesNotMatch(baseline, /lock_recovery_scheduler_09a/);
  assert.match(candidate, /Candidate Recovery09A/i);
  assert.match(candidate, /Apply only after an explicitly approved/i);
  assert.match(candidate, /RECOVERY_SCHEDULER_CAPABILITY_REQUIRED/);
  assert.match(candidate, /cron\.job/);
});
