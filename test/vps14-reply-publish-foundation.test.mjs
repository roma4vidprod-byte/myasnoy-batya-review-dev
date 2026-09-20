import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {replyApprovalFingerprint} from '../lib/server/review-reply-approval.js';

const sql=readFileSync(
  new URL('../tools/vps14/reply-publish-foundation.sql',import.meta.url),
  'utf8'
);

test('VPS14 approval queue is exact-scope and admin gated',()=>{
  for(const value of [
    'review_admin_prepare_reply_approval_scoped',
    'review_admin_approve_reply_scoped',
    'review_admin_cancel_queued_reply_scoped',
    'vps_lab_private.has_company(p_company_id)',
    '13f3cb80-487a-4a19-96a1-fb3103200230',
    '9a95f63b-18e6-447b-a449-8530b67ddbae',
    '54309413522',
    "p_provider is distinct from 'yandex'",
    'COMPANY_ACCESS_DENIED'
  ]) assert.ok(sql.includes(value),value);
});

test('VPS14 publish text is capped at 2500 before local queueing',()=>{
  assert.match(sql,/length\(trim\(v_action\.reply_text\)\) > 2500/);
  assert.match(sql,/REPLY_TEXT_TOO_LONG_FOR_PUBLISH/);
});

test('VPS14 approval fingerprint is SHA-256 and edit invalidates proposal',()=>{
  assert.match(sql,/sha256\(convert_to\(v_material,'UTF8'\)\)/);
  assert.match(sql,/approval_fingerprint=null/);
  assert.match(sql,/old\.status='DRAFT'.*new\.status='DRAFT'/s);
  assert.match(sql,/new\.reply_text is distinct from old\.reply_text/);
});

test('VPS14 approval, not preparation, is the only admin path to QUEUED',()=>{
  const prepare=sql.slice(
    sql.indexOf('create or replace function public.review_admin_prepare_reply_approval_scoped'),
    sql.indexOf('create or replace function public.review_admin_approve_reply_scoped')
  );
  assert.doesNotMatch(prepare,/status='QUEUED'/);
  const approve=sql.slice(
    sql.indexOf('create or replace function public.review_admin_approve_reply_scoped'),
    sql.indexOf('create or replace function public.review_admin_cancel_queued_reply_scoped')
  );
  assert.match(approve,/status='QUEUED'/);
  assert.match(approve,/reply_state='QUEUED'/);
  assert.match(approve,/REPLY_APPROVAL_FINGERPRINT_MISMATCH/);
  assert.match(approve,/REPLY_APPROVAL_EXPIRED/);
});

test('VPS14 queue foundation contains no provider transport or send completion',()=>{
  assert.doesNotMatch(sql,/https?:\/\//i);
  assert.doesNotMatch(sql,/fetch\s*\(/i);
  assert.doesNotMatch(sql,/business-answer/i);
  assert.doesNotMatch(sql,/status='SENDING'/i);
  assert.doesNotMatch(sql,/status='SENT'/i);
});

test('VPS14 queue can be cancelled back to DRAFT before send',()=>{
  const cancel=sql.slice(
    sql.indexOf('create or replace function public.review_admin_cancel_queued_reply_scoped')
  );
  assert.match(cancel,/status='DRAFT'/);
  assert.match(cancel,/status='QUEUED'/);
  assert.match(cancel,/reply_state='DRAFT'/);
});

test('VPS14 browser-facing RPC grants exclude service role and anonymous access',()=>{
  for(const name of [
    'review_admin_prepare_reply_approval_scoped',
    'review_admin_approve_reply_scoped',
    'review_admin_cancel_queued_reply_scoped'
  ]){
    const at=sql.indexOf('revoke all on function public.'+name);
    assert.ok(at>=0,name);
    const tail=sql.slice(at,at+700);
    assert.match(tail,/from public,anon,service_role/);
    assert.match(tail,/to authenticated/);
  }
});

test('JS fingerprint changes with exact text, review and action identity',()=>{
  const base={
    actionId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    reviewId:'review-42',
    replyText:'Спасибо за обратную связь',
    companyId:'13f3cb80-487a-4a19-96a1-fb3103200230',
    locationId:'9a95f63b-18e6-447b-a449-8530b67ddbae',
    provider:'yandex'
  };
  const first=replyApprovalFingerprint(base);
  assert.match(first,/^[a-f0-9]{64}$/);
  assert.notEqual(first,replyApprovalFingerprint({...base,replyText:'Другой текст'}));
  assert.notEqual(first,replyApprovalFingerprint({...base,reviewId:'review-43'}));
  assert.notEqual(first,replyApprovalFingerprint({...base,actionId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}));
});
