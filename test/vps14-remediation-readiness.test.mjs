import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createVpsSessionContext,VPS_SESSION_SCOPE} from '../lib/server/yandex-session/profile-context.js';
import {encryptSession} from '../lib/server/yandex-session/crypto.js';
import {createWriterSessionAdapter} from '../tools/vps14/writer-session-adapter.mjs';
import {createCsrfHandoffChallenge,acceptCsrfHandoff,assertCsrfSessionBinding}
  from '../lib/server/yandex-session/csrf-handoff.js';
import {connectCsrfReadiness} from '../tools/yandex-cookie-metadata/connect.js';

const now=1900000000000;
async function vpsEnv(fn){
  const keys=['RA_RUNTIME_PROFILE','RA_YANDEX_MODE','RA_YANDEX_REPLY_WRITE_ENABLED',
    'VERCEL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SECRET_KEY',
    'SUPABASE_ANON_KEY','YANDEX_SESSION_KEYS_JSON','YANDEX_SESSION_ACTIVE_KID','REVIEW_WORKER_SECRET'];
  const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  for(const k of keys)delete process.env[k];
  process.env.RA_RUNTIME_PROFILE='vps-lab';process.env.RA_YANDEX_MODE='read-only-admin';
  try{return await fn();}finally{
    for(const k of keys)if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];
  }
}
test('writer session adapter decrypts READY VPS session and drops expired request cookies',()=>vpsEnv(async()=>{
  const context=createVpsSessionContext(),key=Buffer.alloc(32,7);
  const ring={currentKid:'fixture',keys:{fixture:Buffer.from(key)}};
  const material={account:'myasnoibatya-zakaz',cookies:[
    {name:'active',value:'ACTIVE_COOKIE',domain:'.yandex.ru',path:'/',secure:true,httpOnly:true,expires:now/1000+3600},
    {name:'expired',value:'EXPIRED_COOKIE',domain:'.yandex.ru',path:'/',secure:true,httpOnly:true,expires:now/1000-10}
  ]};
  const encrypted=encryptSession(VPS_SESSION_SCOPE,material,ring,now-20000,context);
  const stored={state:'READY',revision:6,...encrypted};
  let reads=0;
  const adapter=createWriterSessionAdapter({
    store:{async readSession(){reads++;return stored;}},context,now:()=>now,
    loadKeyring:()=>({currentKid:'fixture',keys:{fixture:Buffer.from(key)}})
  });
  const opened=await adapter();
  assert.equal(reads,1);assert.equal(opened.stored.revision,6);
  assert.deepEqual(opened.session.cookies.map(c=>c.name),['active']);
  assert.equal(opened.session.cookies[0].value,'ACTIVE_COOKIE');
  key.fill(0);ring.keys.fixture.fill(0);
}));
test('CSRF handoff is TTL, nonce, org, session and one-shot bound',()=>{
  const credentialVersion='11111111-2222-4333-8444-555555555555';
  const actionId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const created=createCsrfHandoffChallenge({
    credentialVersion,sessionRevision:6,actionId,now,ttlMs:60000,
    random:()=>Buffer.alloc(32,9)
  });
  assert.deepEqual(Object.keys(created.public).sort(),['expiresAt','nonce','version']);
  const msg={version:1,op:'csrf_handoff',nonce:created.public.nonce,
    organizationId:'54309413522',token:'SYNTHETIC_CSRF_TOKEN'};
  const accepted=acceptCsrfHandoff(created.private,msg,{now:now+1000});
  assert.equal(accepted.actionId,actionId);assert.equal(accepted.sessionRevision,6);
  assert.equal(accepted.token,'SYNTHETIC_CSRF_TOKEN');
  assert.throws(()=>acceptCsrfHandoff(created.private,msg,{now:now+2000}),/CSRF_HANDOFF_REPLAY/);
  assert.equal(assertCsrfSessionBinding(created.private,{
    state:'READY',revision:6,credential_version:credentialVersion
  }),true);
  assert.throws(()=>assertCsrfSessionBinding(created.private,{
    state:'READY',revision:7,credential_version:credentialVersion
  }),/CSRF_HANDOFF_SESSION_CHANGED/);
});
test('CSRF handoff rejects wrong org, nonce and expiry before token acceptance',()=>{
  const make=()=>createCsrfHandoffChallenge({
    credentialVersion:'11111111-2222-4333-8444-555555555555',sessionRevision:6,
    actionId:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',now,ttlMs:60000,
    random:()=>Buffer.alloc(32,8)
  });
  for(const mutation of [
    m=>m.organizationId='999',
    m=>m.nonce=Buffer.alloc(32,3).toString('base64'),
    m=>m.token='bad token'
  ]){
    const c=make(),m={version:1,op:'csrf_handoff',nonce:c.public.nonce,
      organizationId:'54309413522',token:'SYNTHETIC_CSRF_TOKEN'};
    mutation(m);assert.throws(()=>acceptCsrfHandoff(c.private,m,{now:now+1000}),/CSRF_HANDOFF_DENIED/);
  }
  const c=make(),m={version:1,op:'csrf_handoff',nonce:c.public.nonce,
    organizationId:'54309413522',token:'SYNTHETIC_CSRF_TOKEN'};
  assert.throws(()=>acceptCsrfHandoff(c.private,m,{now:now+60000}),/CSRF_HANDOFF_DENIED/);
});
test('extension CSRF readiness performs one hello + one challenge-bound handoff and clears token',async()=>{
  const extracted={version:1,ok:true,code:'CSRF_VALUE_READY',token:'SYNTHETIC_CSRF_TOKEN'};
  const calls=[];
  const nonce=Buffer.alloc(32,5).toString('base64'),expiresAt=now+30000;
  const api={
    queryTabs:async()=>[{id:7,url:'https://yandex.ru/sprav/54309413522/edit/reviews',incognito:false}],
    sendTabMessage:async(id,message)=>{
      assert.equal(id,7);
      assert.deepEqual(message,{version:1,op:'csrf_handoff_read',nonce,expiresAt});
      return extracted;
    }
  };
  const channel={async exchange(message){
    calls.push(structuredClone(message));
    if(message.op==='hello')return {version:1,nonce,expiresAt};
    assert.deepEqual(Object.keys(message).sort(),['nonce','op','organizationId','token','version']);
    assert.equal(message.nonce,nonce);assert.equal(message.organizationId,'54309413522');
    assert.equal(message.token,'SYNTHETIC_CSRF_TOKEN');
    return {ok:true,state:'CSRF_READY'};
  },close(){}};
  assert.deepEqual(await connectCsrfReadiness(api,channel,{now:()=>now}),{ok:true,state:'CSRF_READY'});
  assert.equal(calls.length,2);assert.equal(extracted.token,null);
});
test('readiness sources are network-off, no-claim and systemd-credential bounded',()=>{
  const read=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
  const readiness=read('tools/vps14/writer-readiness.mjs');
  const bridge=read('tools/vps14/vdsina-reply-readiness-bridge.cjs');
  const adapter=read('tools/vps14/writer-session-adapter.mjs');
  const ps=read('scripts/start-yandex-csrf-readiness.ps1');
  const native=read('scripts/yandex-native-host.ps1');
  const content=read('tools/yandex-cookie-metadata/csrf-handoff-content.js');
  const page=read('tools/yandex-cookie-metadata/csrf-handoff-page.js');
  assert.doesNotMatch(readiness,/\bfetch\s*\(|business-answer|\.claim\s*\(/);
  assert.match(readiness,/provider_requests:0,provider_writes:0,queue_claims:0/);
  assert.match(bridge,/PrivateNetwork=yes/);assert.match(bridge,/RestrictAddressFamilies=AF_UNIX/);
  assert.match(bridge,/LoadCredential=yandex-session-key:\/etc\/review-activator-yandex\/session-key\.json/);
  assert.match(bridge,/RA_YANDEX_MODE=read-only-admin/);
  assert.doesNotMatch(bridge,/RA_YANDEX_REPLY_WRITE_ENABLED=true/);
  assert.match(adapter,/CREDENTIALS_DIRECTORY/);assert.match(adapter,/\/run\/credentials\//);
  assert.doesNotMatch(adapter,/YANDEX_SESSION_KEYS_JSON|YANDEX_SESSION_ACTIVE_KID/);
  assert.doesNotMatch(ps,/Invoke-WebRequest|Invoke-RestMethod|HttpListener|TcpListener|Write-Output.*token/i);
  assert.match(native,/CSRF_READY/);
  for(const src of [content,page])assert.doesNotMatch(src,/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|cookies\.(set|remove)/);
});
