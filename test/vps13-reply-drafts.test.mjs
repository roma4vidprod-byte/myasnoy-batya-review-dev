import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql=readFileSync(new URL('../tools/vps13/reply-drafts.sql',import.meta.url),'utf8');
const admin=readFileSync(new URL('../admin.html',import.meta.url),'utf8');

test('VPS13 draft RPCs are exact-scope and membership gated',()=>{
  for(const value of [
    'review_admin_reviews_with_drafts_scoped',
    'review_admin_save_reply_draft_scoped',
    'review_admin_discard_reply_draft_scoped',
    'vps_lab_private.has_company(p_company_id)',
    '13f3cb80-487a-4a19-96a1-fb3103200230',
    '9a95f63b-18e6-447b-a449-8530b67ddbae',
    '54309413522',
    "p_provider is distinct from 'yandex'",
    'COMPANY_ACCESS_DENIED'
  ]) assert.ok(sql.includes(value),value);
});
test('VPS13 only mutates local draft state and blocks queued/sending regression',()=>{
  assert.match(sql,/status in \('QUEUED','SENDING'\)/);
  assert.match(sql,/where public\.review_reply_actions\.status='DRAFT'/);
  assert.match(sql,/status='CANCELLED'/);
  assert.match(sql,/set reply_state='DRAFT'/);
  assert.match(sql,/set reply_state='NONE'/);
  assert.doesNotMatch(sql,/https?:\/\//i);
  assert.doesNotMatch(sql,/fetch\s*\(/i);
  assert.doesNotMatch(sql,/status='SENT'/i);
  assert.doesNotMatch(sql,/status='QUEUED'/i);
  assert.doesNotMatch(sql,/status='SENDING'/i);
});

test('VPS13 browser UI exposes draft save/discard but no publish control',()=>{
  for(const value of [
    'review_admin_reviews_with_drafts_scoped',
    'review_admin_save_reply_draft_scoped',
    'review_admin_discard_reply_draft_scoped',
    'Сохранить черновик',
    'Удалить черновик',
    'Публикация в Яндекс отключена до следующего этапа.'
  ]) assert.ok(admin.includes(value),value);
  assert.equal(admin.includes('review_admin_publish_reply'),false);
  assert.equal(admin.includes('review_admin_queue_reply'),false);
});
