import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPLY_APPROVAL_TTL_MS,
  replyApprovalFingerprint,
  createReplyApprovalProposal,
  approveReplyProposal,
  assertReplyApprovalForExecution
} from '../lib/server/review-reply-approval.js';

const input={
  proposalId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  actionId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  reviewId:'review-42',
  replyText:'Спасибо за обратную связь',
  companyId:'13f3cb80-487a-4a19-96a1-fb3103200230',
  locationId:'9a95f63b-18e6-447b-a449-8530b67ddbae',
  provider:'yandex'
};

test('VPS14 approval binds exact action, review, text and scope',()=>{
  const a=replyApprovalFingerprint(input);
  const b=replyApprovalFingerprint({...input,replyText:'Другой текст'});
  const c=replyApprovalFingerprint({...input,reviewId:'review-43'});
  assert.match(a,/^[a-f0-9]{64}$/);
  assert.notEqual(a,b);
  assert.notEqual(a,c);
});
test('VPS14 proposal has bounded TTL and requires explicit approve',()=>{
  const proposal=createReplyApprovalProposal({...input,now:1000});
  assert.equal(proposal.state,'PENDING');
  assert.equal(proposal.expiresAt,1000+REPLY_APPROVAL_TTL_MS);
  assert.throws(()=>assertReplyApprovalForExecution({
    approval:proposal,currentFingerprint:proposal.fingerprint,now:2000
  }),/REPLY_APPROVAL_REQUIRED/);

  const approved=approveReplyProposal({
    proposal,
    expectedFingerprint:proposal.fingerprint,
    approvedBy:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    now:2000
  });
  assert.equal(approved.state,'APPROVED');
  assert.equal(assertReplyApprovalForExecution({
    approval:approved,currentFingerprint:approved.fingerprint,now:3000
  }),true);
});
test('VPS14 approval expires and edited draft invalidates execution',()=>{
  const proposal=createReplyApprovalProposal({...input,now:10_000,ttlMs:60_000});
  const approved=approveReplyProposal({
    proposal,
    expectedFingerprint:proposal.fingerprint,
    approvedBy:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    now:20_000
  });

  assert.throws(()=>assertReplyApprovalForExecution({
    approval:approved,currentFingerprint:'0'.repeat(64),now:30_000
  }),/REPLY_APPROVAL_FINGERPRINT_MISMATCH/);

  assert.throws(()=>assertReplyApprovalForExecution({
    approval:approved,currentFingerprint:approved.fingerprint,now:70_001
  }),/REPLY_APPROVAL_EXPIRED/);
});

test('VPS14 approval is yandex-only',()=>{
  assert.throws(()=>replyApprovalFingerprint({...input,provider:'2gis'}),
    /REPLY_APPROVAL_PROVIDER_INVALID/);
});
