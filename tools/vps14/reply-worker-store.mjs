import {spawn} from 'node:child_process';
import {userInfo} from 'node:os';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
  'YANDEX_REPLY_RESULT_UNKNOWN',
  'YANDEX_REPLY_OPERATION_FAILED'
]);
const SAFE_DB_ERRORS=new Set([
  'REPLY_WRITER_ROLE_DENIED',
  'REPLY_WRITER_INPUT_INVALID',
  'REPLY_WRITER_ACTION_NOT_FOUND',
  'REPLY_WRITER_STATE_CONFLICT',
  'SESSION_NOT_READY'
]);

function fail(code){
  throw Object.assign(new Error(code),{code});
}
function uuid(value){
  if(typeof value!=='string'||!UUID.test(value))
    fail('REPLY_WORKER_STORAGE_INPUT_INVALID');
  return value.toLowerCase();
}
function json(value){
  if(value===null)return null;
  if(!value||typeof value!=='object'||Array.isArray(value))
    fail('REPLY_WORKER_STORAGE_FAILED');
  return value;
}

function runPsql(sql,{maxBytes=140000}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(
      '/usr/lib/postgresql/17/bin/psql',
      ['-XqAtw','-v','ON_ERROR_STOP=1','-h','/var/run/postgresql',
       '-U','review-yandex-writer','-d','review_activator_lab'],
      {
        env:{
          PATH:'/usr/bin:/bin',
          LANG:'C.UTF-8',
          PGCLIENTENCODING:'UTF8',
          PGAPPNAME:'vps14-reply-worker',
          PGCONNECT_TIMEOUT:'3',
          PGOPTIONS:'-c statement_timeout=10000 -c lock_timeout=3000 -c standard_conforming_strings=on'
        },
        stdio:['pipe','pipe','pipe']
      }
    );
    let output='',errors='',oversize=false;
    const timer=setTimeout(()=>{
      oversize=true;
      child.kill('SIGKILL');
    },15000);
    const stop=code=>{
      clearTimeout(timer);
      output='';errors='';
      reject(Object.assign(new Error(code),{code}));
    };
    child.on('error',()=>stop('REPLY_WORKER_STORAGE_FAILED'));
    child.stdin.on('error',()=>{});
    child.stdout.on('data',buffer=>{
      output+=buffer.toString('utf8');
      if(Buffer.byteLength(output,'utf8')>maxBytes){
        oversize=true;
        child.kill('SIGKILL');
      }
    });
    child.stderr.on('data',buffer=>{
      if(errors.length<4096)errors+=buffer.toString('utf8');
    });
    child.on('close',code=>{
      clearTimeout(timer);
      if(code!==0||oversize){
        const safe=[...SAFE_DB_ERRORS].find(value=>
          errors.includes('ERROR:  '+value)
        );
        output='';errors='';
        reject(Object.assign(
          new Error(safe||'REPLY_WORKER_STORAGE_FAILED'),
          {code:safe||'REPLY_WORKER_STORAGE_FAILED'}
        ));
        return;
      }
      try{
        const text=output.trim();
        output='';errors='';
        resolve(text?JSON.parse(text):null);
      }catch{
        stop('REPLY_WORKER_STORAGE_FAILED');
      }
    });
    child.stdin.end(sql);
  });
}

export function createReplyWorkerStore(){
  if(process.platform!=='linux'||userInfo().username!=='review-yandex-writer')
    fail('REPLY_WRITER_ROLE_DENIED');

  return Object.freeze({
    async claim(){
      const value=json(await runPsql(
        'select vps_yandex_private.reply_worker_claim_next();\n',
        {maxBytes:16000}
      ));
      if(value===null)return null;
      if(value.status!=='SENDING'||
         typeof value.action_id!=='string'||!UUID.test(value.action_id)||
         typeof value.external_review_id!=='string'||!value.external_review_id||
         value.external_review_id.length>256||
         typeof value.reply_text!=='string'||!value.reply_text.trim()||
         value.reply_text.length>2500||
         typeof value.idempotency_key!=='string'||!UUID.test(value.idempotency_key)||
         typeof value.approval_fingerprint!=='string'||
         !/^[a-f0-9]{64}$/.test(value.approval_fingerprint)||
         !Number.isSafeInteger(value.approved_at_ms)||
         !Number.isSafeInteger(value.approval_expires_at_ms)||
         !Number.isSafeInteger(value.attempt_count)||value.attempt_count!==1)
        fail('REPLY_WORKER_CLAIM_INVALID');

      return Object.freeze({
        status:'SENDING',
        actionId:value.action_id.toLowerCase(),
        externalReviewId:value.external_review_id,
        replyText:value.reply_text,
        idempotencyKey:value.idempotency_key.toLowerCase(),
        approvalFingerprint:value.approval_fingerprint,
        approvedAt:value.approved_at_ms,
        expiresAt:value.approval_expires_at_ms
      });
    },

    async complete({actionId,idempotencyKey,resultCode}={}){
      const action=uuid(actionId),key=uuid(idempotencyKey);
      if(resultCode!=='YANDEX_REPLY_ACCEPTED')
        fail('REPLY_WORKER_STORAGE_INPUT_INVALID');
      return json(await runPsql(
        "select vps_yandex_private.reply_worker_finish('complete','"+
        action+"'::uuid,'"+key+"'::uuid,null);\n",
        {maxBytes:4096}
      ));
    },

    async fail({actionId,idempotencyKey,errorCode}={}){
      const action=uuid(actionId),key=uuid(idempotencyKey);
      if(!SAFE_FAILURES.has(errorCode))
        fail('REPLY_WORKER_STORAGE_INPUT_INVALID');
      return json(await runPsql(
        "select vps_yandex_private.reply_worker_finish('fail','"+
        action+"'::uuid,'"+key+"'::uuid,'"+errorCode+"');\n",
        {maxBytes:4096}
      ));
    },

    async readSession(){
      const value=json(await runPsql(
        'select vps_yandex_private.reply_session_read();\n'
      ));
      if(value===null||value.state!=='READY'||
         typeof value.credential_version!=='string'||
         !UUID.test(value.credential_version)||
         !value.envelope||typeof value.envelope!=='object'||
         Array.isArray(value.envelope))
        fail('SESSION_NOT_READY');
      return value;
    }
  });
}
