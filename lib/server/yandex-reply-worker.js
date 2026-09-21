const SAFE_FAILURES=new Set([
  'YANDEX_REPLY_APPROVAL_INVALID',
  'YANDEX_REPLY_REVIEW_NOT_FOUND',
  'YANDEX_REPLY_ALREADY_ANSWERED',
  'YANDEX_REPLY_REVIEWS_CSRF_MISSING',
  'YANDEX_REPLY_DISCOVERY_DRIFT',
  'YANDEX_REPLY_CSRF_BOOTSTRAP_NETWORK',
  'YANDEX_REPLY_CSRF_BOOTSTRAP_DRIFT',
  'YANDEX_REPLY_CSRF_BOOTSTRAP_UNPROVEN',
  'YANDEX_REPLY_CSRF_REJECTED',
  'YANDEX_REPLY_HTTP_ERROR',
  'YANDEX_REPLY_ALREADY_ATTEMPTED',
  'YANDEX_REPLY_HTTP_401',
  'YANDEX_REPLY_HTTP_403',
  'YANDEX_REPLY_REDIRECT',
  'YANDEX_REPLY_RATE_LIMITED',
  'YANDEX_REPLY_CHALLENGE',
  'YANDEX_REPLY_HTML',
  'YANDEX_REPLY_RESPONSE_DRIFT',
  'YANDEX_REPLY_RESPONSE_TOO_LARGE',
  'YANDEX_REPLY_RESULT_UNKNOWN'
]);

function fail(code){
  throw Object.assign(new Error(code),{code});
}

function storeContract(store){
  if(!store||typeof store.claim!=='function'||typeof store.complete!=='function'||
     typeof store.fail!=='function')fail('REPLY_WORKER_STORE_INVALID');
  return store;
}

function safeError(error){
  return SAFE_FAILURES.has(error?.code)?error.code:'YANDEX_REPLY_OPERATION_FAILED';
}

export async function runYandexReplyOnce({
  allowWrite=false,store,createTransport,getSession
}={}){
  if(allowWrite!==true)return Object.freeze({
    ok:true,status:'DISABLED',claimed:false,providerWrites:0
  });
  const db=storeContract(store);
  if(typeof createTransport!=='function'||typeof getSession!=='function')
    fail('REPLY_WORKER_CONFIG_INVALID');

  const claim=await db.claim();
  if(claim===null)return Object.freeze({
    ok:true,status:'EMPTY',claimed:false,providerWrites:0
  });
  if(!claim||typeof claim!=='object'||claim.status!=='SENDING'||
     typeof claim.actionId!=='string'||typeof claim.externalReviewId!=='string'||
     typeof claim.replyText!=='string'||typeof claim.idempotencyKey!=='string'||
     typeof claim.approvalFingerprint!=='string'||
     !Number.isSafeInteger(claim.approvedAt)||!Number.isSafeInteger(claim.expiresAt))
    fail('REPLY_WORKER_CLAIM_INVALID');

  let providerWrites=0;
  try{
    const session=await getSession(claim);
    const send=createTransport({session,claim,allowWrite:true});
    if(typeof send!=='function')fail('REPLY_WORKER_CONFIG_INVALID');
    const result=await send({
      externalReviewId:claim.externalReviewId,
      replyText:claim.replyText,
      authorization:{
        actionId:claim.actionId,
        idempotencyKey:claim.idempotencyKey,
        approvalFingerprint:claim.approvalFingerprint,
        approvedAt:claim.approvedAt,
        expiresAt:claim.expiresAt
      }
    });
    providerWrites=Number(result?.providerWrites??0);
    if(!result?.ok||result.code!=='YANDEX_REPLY_ACCEPTED'||providerWrites!==1)
      fail('YANDEX_REPLY_OPERATION_FAILED');
    try {
      await db.complete({actionId:claim.actionId,idempotencyKey:claim.idempotencyKey,resultCode:result.code});
    } catch {
      // Completion may have committed before its response was lost. Never issue
      // a contradictory fail mutation or repeat the provider operation.
      return Object.freeze({ok:false,status:'RECONCILIATION_REQUIRED',claimed:true,
        actionId:claim.actionId,errorCode:'REPLY_WORKER_COMPLETION_UNKNOWN',providerWrites:1});
    }
    return Object.freeze({
      ok:true,status:'SENT',claimed:true,
      actionId:claim.actionId,providerWrites:1
    });
  }catch(error){
    const code=safeError(error);
    if(error?.providerWriteAttempted===true)providerWrites=1;
    try {await db.fail({actionId:claim.actionId,idempotencyKey:claim.idempotencyKey,errorCode:code});}
    catch {return Object.freeze({ok:false,status:'RECONCILIATION_REQUIRED',claimed:true,
      actionId:claim.actionId,errorCode:'REPLY_WORKER_FAILURE_RECORD_UNKNOWN',providerWrites});}
    return Object.freeze({
      ok:false,status:'FAILED',claimed:true,
      actionId:claim.actionId,errorCode:code,providerWrites
    });
  }
}
