import {userInfo} from 'node:os';
import {randomUUID} from 'node:crypto';
import {createVpsSessionContext} from '../../lib/server/yandex-session/profile-context.js';
import {createCsrfHandoffChallenge,acceptCsrfHandoff,assertCsrfSessionBinding}
  from '../../lib/server/yandex-session/csrf-handoff.js';
import {createReplyWorkerStore} from './reply-worker-store.mjs';
import {createWriterSessionAdapter} from './writer-session-adapter.mjs';

const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
function fail(code){throw Object.assign(new Error(code),{code});}
async function readMessage(deadline){
  const chunks=[];let size=0;
  const timer=setTimeout(()=>process.stdin.destroy(Error('EXPIRED')),
    Math.max(1,deadline-Date.now()));
  try{
    for await(const chunk of process.stdin){
      size+=chunk.length;
      if(size>4096){chunk.fill(0);fail('CSRF_HANDOFF_DENIED');}
      chunks.push(chunk);
    }
    const bytes=Buffer.concat(chunks);
    try{return JSON.parse(bytes.toString('utf8'));}
    catch{fail('CSRF_HANDOFF_DENIED');}
    finally{bytes.fill(0);}
  }finally{
    clearTimeout(timer);
    for(const chunk of chunks)chunk.fill(0);
  }
}
let session,token;
try{
  if(process.argv.length!==2||userInfo().username!=='review-yandex-writer')
    fail('REPLY_WRITER_ROLE_DENIED');
  if(process.env.RA_RUNTIME_PROFILE!=='vps-lab'||
     process.env.RA_YANDEX_MODE!=='read-only-admin'||
     process.env.RA_YANDEX_REPLY_WRITE_ENABLED!==undefined)
    fail('SESSION_PROFILE_INVALID');

  const context=createVpsSessionContext();
  const store=createReplyWorkerStore();
  const getSession=createWriterSessionAdapter({store,context});
  const opened=await getSession();
  session=opened.session;
  const stored=opened.stored;
  if(!Number.isSafeInteger(Number(stored.revision))||Number(stored.revision)<1)
    fail('SESSION_NOT_READY');

  const created=createCsrfHandoffChallenge({
    credentialVersion:stored.credential_version,
    sessionRevision:Number(stored.revision),
    actionId:randomUUID(),ttlMs:60000
  });
  emit(created.public);
  const message=await readMessage(created.private.expiresAt);
  const accepted=acceptCsrfHandoff(created.private,message);
  token=accepted.token;
  const current=await store.readSession();
  assertCsrfSessionBinding(created.private,current);
  emit({
    ok:true,operation:'csrf_ready',state:'CSRF_READY',
    organization_id:accepted.organizationId,
    session_match:true,action_binding:true,
    csrf_present:true,csrf_length:token.length,
    provider_requests:0,provider_writes:0,queue_claims:0
  });
}catch(error){
  emit({
    ok:false,operation:'csrf_ready',
    error:[
      'REPLY_WRITER_ROLE_DENIED','SESSION_PROFILE_INVALID','SESSION_NOT_READY',
      'SESSION_KEY_NOT_CONFIGURED','SESSION_DECRYPT_FAILED',
      'CSRF_HANDOFF_CONTEXT_INVALID','CSRF_HANDOFF_REPLAY',
      'CSRF_HANDOFF_DENIED','CSRF_HANDOFF_SESSION_CHANGED'
    ].includes(error?.code)?error.code:'CSRF_READINESS_FAILED',
    provider_requests:0,provider_writes:0,queue_claims:0
  });
  process.exitCode=1;
}finally{
  token='';
  if(session?.cookies)for(const cookie of session.cookies)if(cookie)cookie.value='';
}
