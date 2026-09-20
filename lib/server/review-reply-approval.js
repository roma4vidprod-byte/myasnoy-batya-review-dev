import {createHash} from 'node:crypto';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const REPLY_APPROVAL_TTL_MS=10*60*1000;

function fail(code){
  throw Object.assign(new Error(code),{code});
}

function text(value,max,code){
  if(typeof value!=='string')fail(code);
  const out=value.trim();
  if(!out||out.length>max)fail(code);
  return out;
}

function uuid(value,code){
  if(typeof value!=='string'||!UUID.test(value))fail(code);
  return value.toLowerCase();
}

export function replyApprovalFingerprint({
  actionId,reviewId,replyText,companyId,locationId,provider='yandex'
}={}){
  const payload=JSON.stringify({
    actionId:uuid(actionId,'REPLY_APPROVAL_ACTION_INVALID'),
    reviewId:text(reviewId,256,'REPLY_APPROVAL_REVIEW_INVALID'),
    replyText:text(replyText,2500,'REPLY_APPROVAL_TEXT_INVALID'),
    companyId:uuid(companyId,'REPLY_APPROVAL_SCOPE_INVALID'),
    locationId:uuid(locationId,'REPLY_APPROVAL_SCOPE_INVALID'),
    provider:text(provider,32,'REPLY_APPROVAL_PROVIDER_INVALID')
  });
  if(provider!=='yandex')fail('REPLY_APPROVAL_PROVIDER_INVALID');
  return createHash('sha256').update(payload,'utf8').digest('hex');
}

export function createReplyApprovalProposal({
  proposalId,actionId,reviewId,replyText,companyId,locationId,
  provider='yandex',now=Date.now(),ttlMs=REPLY_APPROVAL_TTL_MS
}={}){
  if(!Number.isSafeInteger(now)||now<0||
     !Number.isSafeInteger(ttlMs)||ttlMs<60_000||ttlMs>30*60_000)
    fail('REPLY_APPROVAL_TIME_INVALID');

  const fingerprint=replyApprovalFingerprint({
    actionId,reviewId,replyText,companyId,locationId,provider
  });

  return Object.freeze({
    proposalId:uuid(proposalId,'REPLY_APPROVAL_ID_INVALID'),
    actionId:actionId.toLowerCase(),
    reviewId:String(reviewId).trim(),
    fingerprint,
    state:'PENDING',
    createdAt:now,
    expiresAt:now+ttlMs
  });
}
export function approveReplyProposal({
  proposal,expectedFingerprint,approvedBy,now=Date.now()
}={}){
  if(!proposal||typeof proposal!=='object'||Array.isArray(proposal)||
     proposal.state!=='PENDING')fail('REPLY_APPROVAL_STATE_INVALID');
  if(!Number.isSafeInteger(now)||now<0||now>proposal.expiresAt)
    fail('REPLY_APPROVAL_EXPIRED');
  if(typeof expectedFingerprint!=='string'||
     !/^[a-f0-9]{64}$/.test(expectedFingerprint)||
     proposal.fingerprint!==expectedFingerprint)
    fail('REPLY_APPROVAL_FINGERPRINT_MISMATCH');
  const actor=uuid(approvedBy,'REPLY_APPROVAL_ACTOR_INVALID');

  return Object.freeze({
    ...proposal,
    state:'APPROVED',
    approvedBy:actor,
    approvedAt:now
  });
}

export function assertReplyApprovalForExecution({
  approval,currentFingerprint,now=Date.now()
}={}){
  if(!approval||approval.state!=='APPROVED')
    fail('REPLY_APPROVAL_REQUIRED');
  if(!Number.isSafeInteger(now)||now<0||now>approval.expiresAt)
    fail('REPLY_APPROVAL_EXPIRED');
  if(currentFingerprint!==approval.fingerprint)
    fail('REPLY_APPROVAL_FINGERPRINT_MISMATCH');
  return true;
}
