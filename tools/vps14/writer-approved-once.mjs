import {createInterface} from 'node:readline';
import {userInfo} from 'node:os';
import {runYandexReplyOnce} from '../../lib/server/yandex-reply-worker.js';
import {createVpsReplyWriterContext,VPS_SESSION_SCOPE}
  from '../../lib/server/yandex-session/profile-context.js';
import {createYandexReplyTransport}
  from '../../lib/server/yandex-session/reply-transport.js';
import {createCsrfHandoffChallenge,acceptCsrfHandoff,assertCsrfSessionBinding}
  from '../../lib/server/yandex-session/csrf-handoff.js';
import {createReplyWorkerStore} from './reply-worker-store.mjs';
import {createWriterSessionAdapter} from './writer-session-adapter.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64=/^[0-9a-f]{64}$/;
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
const fail=code=>{throw Object.assign(new Error(code),{code});};
const action=String(process.env.RA_STAGE9_ACTION_ID||'').toLowerCase();
const review=String(process.env.RA_STAGE9_REVIEW_ID||'');
const fingerprint=String(process.env.RA_STAGE9_FINGERPRINT||'');
const idempotency=String(process.env.RA_STAGE9_IDEMPOTENCY_KEY||'').toLowerCase();

const contextValid=process.argv.length===2&&userInfo().username==='review-yandex-writer'&&
  UUID.test(action)&&UUID.test(idempotency)&&HEX64.test(fingerprint)&&
  Boolean(review)&&review.length<=256;

const rl=createInterface({input:process.stdin,crlfDelay:Infinity});
const iterator=rl[Symbol.asyncIterator]();
async function readJsonLine(deadline){
  const left=deadline-Date.now();
  if(left<1)fail('STAGE9_HANDOFF_EXPIRED');
  let timer;
  const timeout=new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(Object.assign(new Error('STAGE9_HANDOFF_EXPIRED'),
      {code:'STAGE9_HANDOFF_EXPIRED'})),left);
  });
  const next=await Promise.race([iterator.next(),timeout]).finally(()=>clearTimeout(timer));
  if(next.done||typeof next.value!=='string'||Buffer.byteLength(next.value,'utf8')>4096)
    fail('STAGE9_MESSAGE_INVALID');
  try{
    const value=JSON.parse(next.value);
    if(!value||typeof value!=='object'||Array.isArray(value))fail('STAGE9_MESSAGE_INVALID');
    return value;
  }catch(error){
    if(error?.code==='STAGE9_MESSAGE_INVALID')throw error;
    fail('STAGE9_MESSAGE_INVALID');
  }
}

let token='',session;
try{
  if(!contextValid)fail('STAGE9_CONTEXT_INVALID');
  if(process.env.RA_RUNTIME_PROFILE!=='vps-lab'||
     process.env.RA_YANDEX_MODE!=='reply-write-one-shot'||
     process.env.RA_YANDEX_REPLY_WRITE_ENABLED!=='true')
    fail('STAGE9_RUNTIME_GATE_DENIED');

  const context=createVpsReplyWriterContext();
  const baseStore=createReplyWorkerStore();
  const sessionAdapter=createWriterSessionAdapter({store:baseStore,context});
  let opened=await sessionAdapter();
  session=opened.session;
  const stored=opened.stored;
  const revision=Number(stored.revision);
  if(!Number.isSafeInteger(revision)||revision<1)fail('SESSION_NOT_READY');

  const challenge=createCsrfHandoffChallenge({
    credentialVersion:stored.credential_version,sessionRevision:revision,
    actionId:action,ttlMs:120000
  });
  emit(challenge.public);
  const handoff=await readJsonLine(challenge.private.expiresAt);
  const accepted=acceptCsrfHandoff(challenge.private,handoff);
  token=accepted.token;
  const current=await baseStore.readSession();
  assertCsrfSessionBinding(challenge.private,current);
  emit({ok:true,operation:'csrf_ready',state:'CSRF_READY',
    action_id:action,session_match:true,action_binding:true,
    provider_requests:0,provider_writes:0,queue_claims:0});

  const execute=await readJsonLine(challenge.private.expiresAt);
  if(Object.keys(execute).sort().join()!=='actionId,fingerprint,idempotencyKey,op,version'||
     execute.version!==1||execute.op!=='execute'||execute.actionId!==action||
     execute.fingerprint!==fingerprint||execute.idempotencyKey!==idempotency)
    fail('STAGE9_EXECUTE_DENIED');

  const exactStore=Object.freeze({
    ...baseStore,
    async claim(){
      const claim=await baseStore.claim();
      if(claim===null)return null;
      if(claim.actionId!==action||claim.externalReviewId!==review||
         claim.idempotencyKey!==idempotency||claim.approvalFingerprint!==fingerprint){
        try{await baseStore.fail({actionId:claim.actionId,
          idempotencyKey:claim.idempotencyKey,errorCode:'YANDEX_REPLY_APPROVAL_INVALID'});}
        catch{}
        fail('STAGE9_CLAIM_MISMATCH');
      }
      return claim;
    }
  });

  const result=await runYandexReplyOnce({
    allowWrite:true,store:exactStore,
    getSession:async claim=>{
      if(claim.actionId!==action||claim.idempotencyKey!==idempotency)
        fail('STAGE9_CLAIM_MISMATCH');
      opened=await sessionAdapter();
      if(session?.cookies)for(const c of session.cookies)if(c)c.value='';
      session=opened.session;
      assertCsrfSessionBinding(challenge.private,opened.stored);
      return session;
    },
    createTransport:({session:active})=>createYandexReplyTransport({
      context,scope:VPS_SESSION_SCOPE,session:active,allowWrite:true,
      resolveCsrf:async({reviewId,reviewsCsrfToken,answerCsrfToken})=>{
        if(reviewId!==review||!token)fail('STAGE9_CSRF_BINDING_INVALID');
        return {ok:true,reviewId,reviewsCsrfToken,answerCsrfToken,token};
      }
    })
  });
  emit({operation:'approved_write',...result});
  if(!result.ok)process.exitCode=1;
}catch(error){
  emit({ok:false,operation:'approved_write',status:'BLOCKED',
    error:[
      'STAGE9_CONTEXT_INVALID','STAGE9_RUNTIME_GATE_DENIED','STAGE9_HANDOFF_EXPIRED',
      'STAGE9_MESSAGE_INVALID','STAGE9_EXECUTE_DENIED','STAGE9_CLAIM_MISMATCH',
      'STAGE9_CSRF_BINDING_INVALID','SESSION_NOT_READY','SESSION_KEY_NOT_CONFIGURED',
      'SESSION_DECRYPT_FAILED','CSRF_HANDOFF_DENIED','CSRF_HANDOFF_SESSION_CHANGED'
    ].includes(error?.code)?error.code:'STAGE9_EXECUTION_FAILED'});
  process.exitCode=1;
}finally{
  token='';
  if(session?.cookies)for(const cookie of session.cookies)if(cookie)cookie.value='';
  rl.close();
}
