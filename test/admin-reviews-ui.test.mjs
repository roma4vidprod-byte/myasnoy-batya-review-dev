import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const admin = readFileSync(new URL('../admin.html', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260913110000_yandex_admin_reviews_scoped_read_06.sql', import.meta.url), 'utf8');
const fixMigration = readFileSync(new URL('../supabase/migrations/20260913112000_yandex_admin_reviews_scope_ambiguity_fix_06a.sql', import.meta.url), 'utf8');

test('admin reviews UI uses the Asbest DEV scoped read path', () => {
  for (const literal of [
    "review_admin_reviews_scoped",
    "13f3cb80-487a-4a19-96a1-fb3103200230",
    "9a95f63b-18e6-447b-a449-8530b67ddbae",
    "54309413522",
    "provider:'yandex'",
    'p_limit:REVIEW_PAGE_SIZE',
    'p_offset:reviewOffset',
    'reviewsPager',
    'owner_reply_text',
    'published_at',
    'observed_at',
    'disabled readonly'
  ]) assert.ok(admin.includes(literal), `missing UI contract: ${literal}`);
  assert.equal(admin.includes("review_admin_reviews'"), false);
  assert.equal(admin.includes('raw_payload'), false);
  assert.equal(admin.includes('service_role'), false);
  assert.equal(admin.includes('cookie'), false);
  assert.equal(admin.includes('csrf'), false);
  assert.equal(admin.includes('sessionMaterial'), false);
  assert.equal(admin.includes("client.rpc('review_admin_save_reply_draft',"), false);
  assert.equal(admin.includes('/api/admin-review-reply-draft'), true);
  assert.equal(admin.includes('function aiDraft'), false);
  assert.equal(admin.includes('OPENAI_API_KEY'), false);
  assert.equal(admin.includes('api.openai.com'), false);
  assert.equal(admin.includes('business-answer'), false);
});

test('scoped admin RPC is admin-gated, read-only, paginated and projection-safe', () => {
  for (const literal of [
    'security definer',
    'stable',
    'public.review_is_admin()',
    'REVIEW_SCOPE_INVALID',
    "r.company_id=p_company_id",
    "r.location_id=p_location_id",
    "r.provider=p_provider",
    "r.external_location_id=p_external_location_id",
    'order by coalesce(r.published_at,r.observed_at) desc',
    'limit p_limit offset p_offset',
    'total_count bigint',
    'unanswered_count bigint',
    'grant execute',
    'to authenticated',
    'revoke all on function public.review_admin_reviews'
  ]) assert.ok(migration.toLowerCase().includes(literal.toLowerCase()), `missing RPC contract: ${literal}`);
  assert.equal(migration.includes('raw_payload'), false);
  assert.equal(migration.includes('cookie'), false);
  assert.equal(migration.includes('csrf'), false);
});

test('legacy unscoped browser RPC is revoked by the migration', () => {
  assert.match(migration, /revoke all on function public\.review_admin_reviews\(text,integer,integer,boolean,integer\) from public,anon,authenticated,service_role/i);
});

test('scoped RPC location validation is alias-qualified against PL/pgSQL output names', () => {
  assert.match(fixMigration, /from public\.review_locations as l_check\s+where l_check\.id=p_location_id and l_check\.company_id=p_company_id/i);
  assert.doesNotMatch(fixMigration, /where id=p_location_id/);
});
