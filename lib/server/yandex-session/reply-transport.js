import {serverOnly,fail} from './crypto.js';
import {createYandexReadTransport} from './transport.js';
import {
  buildYandexReplyCandidate,classifyYandexReplyResponse,validateReplyPublishScope
} from './reply-contract.js';

export const YANDEX_CSRF_BOOTSTRAP_ENDPOINT='https://yandex.ru/sprav/api/view/chain/0/list/';
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
     value.approvedAt<0||value.expiresAt<=value.approvedAt||now>value.expiresAt)
    replyFail('YANDEX_REPLY_APPROVAL_INVALID');
  return value;
}

function cookieHeader(session){
  const base=session.cookies.map(c=>`${c.name}=${c.value}`).join('; ');
  return session.cookies.some(c=>c.name==='i')?base:base+(base?'; ':'')+'i=';
}

async function boundedText(response,max=65536){
  const text=await response.text();
  if(Buffer.byteLength(text,'utf8')>max)replyFail('YANDEX_REPLY_RESPONSE_TOO_LARGE');
  return text;
}
function requestFor(scope,page){
  return {
    method:'GET',permanentId:scope.organizationId,page,
    url:`https://yandex.ru/sprav/api/${scope.organizationId}/reviews?ranking=by_time&source=pagination&page=${page}`
  };
}

export function createYandexReplyTransport({
  scope,session,allowWrite=false,fetchImpl=(...args)=>globalThis.fetch(...args),
  context,now=()=>Date.now(),maxPages=10
}={}){
  serverOnly(context);
  const fixed=validateReplyPublishScope(scope);
  if(!session||!Array.isArray(session.cookies)||!session.cookies.length)
    fail('SESSION_COOKIE_INVALID');
  if(!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>10)
    replyFail('YANDEX_REPLY_DISCOVERY_INVALID');

  const read=createYandexReadTransport({
    scope:fixed,session,allowRead:true,fetchImpl,context
  });

  return async function send({externalReviewId,replyText,authorization}={}){
    serverOnly(context);
    if(allowWrite!==true)replyFail('LIVE_WRITE_NOT_APPROVED');
    authz(authorization,now());
    if(typeof externalReviewId!=='string'||!externalReviewId.trim()||externalReviewId.length>256)
      replyFail('YANDEX_REPLY_ID_INVALID');

    let target=null,reviewsCsrfToken=null,providerRequests=0;
    for(let page=1;page<=maxPages&&!target;page++){
      const payload=await read(requestFor(fixed,page));providerRequests++;
      const list=payload?.list;
      if(!list||typeof list!=='object'||!Array.isArray(list.items))
        replyFail('YANDEX_REPLY_DISCOVERY_DRIFT');
      if(typeof list.csrf_token==='string'&&list.csrf_token)
        reviewsCsrfToken=list.csrf_token;
      target=list.items.find(item=>
        String(item?.id??item?.cmnt_entity_id??'')===externalReviewId
      )??null;
      const total=Number(list?.pager?.total),offset=Number(list?.pager?.offset),limit=Number(list?.pager?.limit);
      if(!target&&Number.isFinite(total)&&Number.isFinite(offset)&&Number.isFinite(limit)&&
         offset+list.items.length>=total)break;
    }
    if(!target)replyFail('YANDEX_REPLY_REVIEW_NOT_FOUND');
    if(target.owner_comment!==null&&target.owner_comment!==undefined)
      replyFail('YANDEX_REPLY_ALREADY_ANSWERED');
    if(typeof reviewsCsrfToken!=='string'||!reviewsCsrfToken)
      replyFail('YANDEX_REPLY_REVIEWS_CSRF_MISSING');
    const answerCsrfToken=typeof target.business_answer_csrf_token==='string'&&target.business_answer_csrf_token?
      target.business_answer_csrf_token:null;

    const cookies=cookieHeader(session);
    let bootstrap;
    try{
      bootstrap=await fetchImpl(YANDEX_CSRF_BOOTSTRAP_ENDPOINT,{
        method:'POST',headers:{Accept:'application/json',Cookie:cookies},
        redirect:'manual',signal:AbortSignal.timeout(10000)
      });
      providerRequests++;
    }catch{replyFail('YANDEX_REPLY_CSRF_BOOTSTRAP_NETWORK');}
    if(bootstrap.status===401)replyFail('YANDEX_REPLY_HTTP_401');
    if(bootstrap.status===403)replyFail('YANDEX_REPLY_HTTP_403');
    if(bootstrap.status>=300&&bootstrap.status<400)replyFail('YANDEX_REPLY_REDIRECT');
    const bootstrapText=await boundedText(bootstrap);
    let bootstrapData;
    try{bootstrapData=JSON.parse(bootstrapText);}catch{replyFail('YANDEX_REPLY_CSRF_BOOTSTRAP_DRIFT');}
    const csrfToken=bootstrapData&&typeof bootstrapData==='object'&&!Array.isArray(bootstrapData)&&
      typeof bootstrapData.csrf==='string'&&bootstrapData.csrf?bootstrapData.csrf:null;
    if(bootstrap.status!==488||!csrfToken)
      replyFail('YANDEX_REPLY_CSRF_BOOTSTRAP_DRIFT');

    const candidate=buildYandexReplyCandidate({
      scope:fixed,reviewId:externalReviewId,replyText,
      csrfToken,reviewsCsrfToken,answerCsrfToken
    });
    let response;
    try{
      response=await fetchImpl(candidate.url,{
        method:candidate.method,
        headers:{...candidate.headers,Cookie:cookies},
        body:JSON.stringify(candidate.body),
        redirect:'manual',signal:AbortSignal.timeout(10000)
      });
      providerRequests++;
    }catch{replyFail('YANDEX_REPLY_RESULT_UNKNOWN',true);}
    const responseText=await boundedText(response);
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
