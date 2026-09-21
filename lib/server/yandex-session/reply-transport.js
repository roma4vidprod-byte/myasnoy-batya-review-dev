import {serverOnly,fail,validateSessionClassified} from './crypto.js';
import {assertReplyWriterContext} from './profile-context.js';
import {replyApprovalFingerprint} from '../review-reply-approval.js';
import {parseYandexReviewsPayload} from '../../providers/yandex.js';
import {createYandexReadTransport} from './transport.js';
import {
  buildYandexReplyCandidate,classifyYandexReplyResponse,validateReplyPublishScope
} from './reply-contract.js';
import {
  YANDEX_CSRF_ENDPOINT
} from './csrf-contract.js';

export const YANDEX_CSRF_BOOTSTRAP_ENDPOINT=YANDEX_CSRF_ENDPOINT;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64=/^[0-9a-f]{64}$/;

function replyFail(code,providerWriteAttempted=false){
  throw Object.assign(new Error(code),{code,providerWriteAttempted});
}

function authz(value,now){
  if(!value||typeof value!=='object'||Array.isArray(value)||
     typeof value.actionId!=='string'||!UUID.test(value.actionId)||
     typeof value.idempotencyKey!=='string'||!UUID.test(value.idempotencyKey)||
     typeof value.approvalFingerprint!=='string'||!HEX64.test(value.approvalFingerprint)||
     !Number.isSafeInteger(value.approvedAt)||!Number.isSafeInteger(value.expiresAt)||
     value.approvedAt<0||value.approvedAt>now||value.expiresAt<=value.approvedAt||now>=value.expiresAt)
    replyFail('YANDEX_REPLY_APPROVAL_INVALID');
  return value;
}

function cookieHeader(session){
  return session.cookies.map(c=>`${c.name}=${c.value}`).join('; ');
}

async function boundedText(response,max=65536){
  if(!response.body?.getReader)replyFail('YANDEX_REPLY_RESPONSE_DRIFT');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try {
    for(;;){const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;if(size>max)replyFail('YANDEX_REPLY_RESPONSE_TOO_LARGE');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}
function requestFor(scope,page){
  return {
    method:'GET',permanentId:scope.organizationId,page,
    url:`https://yandex.ru/sprav/api/${scope.organizationId}/reviews?ranking=by_time&source=pagination&page=${page}`
  };
}

export function createYandexReplyTransport({
  scope,session,allowWrite=false,fetchImpl=(...args)=>globalThis.fetch(...args),
  context,now=()=>Date.now(),maxPages=10,resolveCsrf
}={}){
  serverOnly(context);
  assertReplyWriterContext(context);
  const fixed=validateReplyPublishScope(scope);
  if(!session||!Array.isArray(session.cookies)||!session.cookies.length)
    fail('SESSION_COOKIE_INVALID');
  if(!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>10)
    replyFail('YANDEX_REPLY_DISCOVERY_INVALID');

  let consumed=false;
  return async function send({externalReviewId,replyText,authorization}={}){
    serverOnly(context);
    assertReplyWriterContext(context);
    if(allowWrite!==true)replyFail('LIVE_WRITE_NOT_APPROVED');
    if(consumed)replyFail('YANDEX_REPLY_ALREADY_ATTEMPTED');
    consumed=true;
    authz(authorization,now());
    if(typeof externalReviewId!=='string'||!externalReviewId.trim()||externalReviewId.length>256)
      replyFail('YANDEX_REPLY_ID_INVALID');

    const checkApproval=()=>{
      authz(authorization,now());
      let fingerprint;
      try {fingerprint=replyApprovalFingerprint({actionId:authorization.actionId,
        reviewId:externalReviewId,replyText,companyId:fixed.companyId,
        locationId:fixed.locationId,provider:'yandex'});}
      catch {replyFail('YANDEX_REPLY_APPROVAL_INVALID');}
      if(fingerprint!==authorization.approvalFingerprint)replyFail('YANDEX_REPLY_APPROVAL_INVALID');
    };
    checkApproval();
    // No accepted GET bootstrap exists yet. Never fall back to candidate POST,
    // HTML scraping, invented cookies, or list CSRF as the global token.
    if(typeof resolveCsrf!=='function')replyFail('YANDEX_REPLY_CSRF_BOOTSTRAP_UNPROVEN');
    const active=validateSessionClassified(session,now());
    const read=createYandexReadTransport({scope:fixed,session:active,allowRead:true,fetchImpl,context});

    let target=null,reviewsCsrfToken=null,providerRequests=0;
    for(let page=1;page<=maxPages&&!target;page++){
      const payload=await read(requestFor(fixed,page));providerRequests++;
      try {parseYandexReviewsPayload(payload,fixed.organizationId,{paginationMode:'MUTABLE_OFFSET',expectedOffset:(page-1)*20,expectedLimit:20});}
      catch {replyFail('YANDEX_REPLY_DISCOVERY_DRIFT');}
      const list=payload?.list;
      if(!list||typeof list!=='object'||!Array.isArray(list.items))
        replyFail('YANDEX_REPLY_DISCOVERY_DRIFT');
      reviewsCsrfToken=typeof list.csrf_token==='string'?list.csrf_token:null;
      target=list.items.find(item=>
        String(item?.id??item?.cmnt_entity_id??'')===externalReviewId
      )??null;
      if(!target&&list.items.length<20)break;
    }
    if(!target)replyFail('YANDEX_REPLY_REVIEW_NOT_FOUND');
    if(target.owner_comment!==null&&target.owner_comment!==undefined)
      replyFail('YANDEX_REPLY_ALREADY_ANSWERED');
    if(typeof reviewsCsrfToken!=='string'||!reviewsCsrfToken)
      replyFail('YANDEX_REPLY_REVIEWS_CSRF_MISSING');
    const answerCsrfToken=typeof target.business_answer_csrf_token==='string'&&target.business_answer_csrf_token?
      target.business_answer_csrf_token:null;

    const cookies=cookieHeader(validateSessionClassified(active,now()));
    let csrfResult;
    try{
      // Trusted server composition only. No runtime resolver is wired until
      // GET/browser evidence proves the global-token source. Tests inject fixtures.
      csrfResult=await resolveCsrf({reviewId:externalReviewId,reviewsCsrfToken,answerCsrfToken});
    }catch{replyFail('YANDEX_REPLY_CSRF_BOOTSTRAP_DRIFT');}
    if(!csrfResult?.ok||csrfResult.reviewId!==externalReviewId||
       csrfResult.reviewsCsrfToken!==reviewsCsrfToken||
       csrfResult.answerCsrfToken!==answerCsrfToken||
       typeof csrfResult.token!=='string'||!csrfResult.token.trim()||csrfResult.token.length>1024)
      replyFail('YANDEX_REPLY_CSRF_BOOTSTRAP_DRIFT');
    const csrfToken=csrfResult.token;

    const candidate=buildYandexReplyCandidate({
      scope:fixed,reviewId:externalReviewId,replyText,
      csrfToken,reviewsCsrfToken,answerCsrfToken
    });
    let response;
    checkApproval();
    assertReplyWriterContext(context);
    validateSessionClassified(active,now());
    try{
      response=await fetchImpl(candidate.url,{
        method:candidate.method,
        headers:{...candidate.headers,Cookie:cookies},
        body:JSON.stringify(candidate.body),
        redirect:'manual',signal:AbortSignal.timeout(10000)
      });
      providerRequests++;
    }catch{replyFail('YANDEX_REPLY_RESULT_UNKNOWN',true);}
    let responseText;
    try {responseText=await boundedText(response);}
    catch {replyFail('YANDEX_REPLY_RESULT_UNKNOWN',true);}
    const result=classifyYandexReplyResponse({
      status:response.status,
      contentType:response.headers.get('content-type')||'',
      text:responseText,
      location:response.headers.get('location')
    });
    if(!result.ok)replyFail(result.code,true);
    return Object.freeze({
      ok:true,code:result.code,
      actionId:authorization.actionId,
      idempotencyKey:authorization.idempotencyKey,
      providerRequests,providerWrites:1
    });
  };
}
