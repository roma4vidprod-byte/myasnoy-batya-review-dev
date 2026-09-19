import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {encryptSession,decryptSessionClassified,ACCOUNT} from '../lib/server/yandex-session/crypto.js';
import {createVpsSessionContext,VPS_SESSION_SCOPE as scope} from '../lib/server/yandex-session/profile-context.js';
import {createSessionStore} from '../lib/server/yandex-session/store.js';
import {createYandexSessionService} from '../lib/server/yandex-session/service.js';
import {createYandexReadTransport} from '../lib/server/yandex-session/transport.js';
import {prepareVpsImport} from '../lib/server/yandex-session/vps-import.js';
import {runVpsDiagnostic} from '../lib/server/yandex-session/vps-diagnostic.js';
const now=1900000000000;
const ring={currentKid:'synthetic',keys:{synthetic:Buffer.alloc(32,73)}};
const material=()=>({account:ACCOUNT,cookies:[{name:'synthetic',value:'NO_REAL_COOKIE_VPS08A',domain:'.yandex.ru',path:'/',secure:true,httpOnly:true,expires:now/1000+500}]});
const envNames=['RA_RUNTIME_PROFILE','RA_YANDEX_MODE','VERCEL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SECRET_KEY','SUPABASE_ANON_KEY','YANDEX_SESSION_KEYS_JSON','YANDEX_SESSION_ACTIVE_KID','REVIEW_WORKER_SECRET'];
async function profile(name,fn){const saved=Object.fromEntries(envNames.map(n=>[n,process.env[n]]));for(const n of envNames)delete process.env[n];process.env.RA_RUNTIME_PROFILE=name;if(name==='vps-lab')process.env.RA_YANDEX_MODE='read-only-admin';try{return await fn(name==='vps-lab'?createVpsSessionContext():undefined);}finally{for(const n of envNames)if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];}}
const code=c=>e=>e.code===c&&e.message===c;
const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
for(const name of ['cloud-dev','vps-lab'])test(name+' roundtrip preserves exact material',()=>profile(name,ctx=>{
  const input=material(),row=encryptSession(scope,input,ring,now,ctx);
  assert.deepEqual(decryptSessionClassified(scope,row,ring,now,ctx),input);
}));
test('cross-profile rejects even identical key bytes and KID',async()=>{
  let cloud,vps;
  await profile('cloud-dev',ctx=>{cloud=encryptSession(scope,material(),ring,now,ctx);});
  await profile('vps-lab',ctx=>{vps=encryptSession(scope,material(),ring,now,ctx);assert.throws(()=>decryptSessionClassified(scope,cloud,ring,now,ctx),code('SESSION_AES_GCM_AUTH_FAILED'));});
  await profile('cloud-dev',ctx=>assert.throws(()=>decryptSessionClassified(scope,vps,ring,now,ctx),code('SESSION_AES_GCM_AUTH_FAILED')));
});
test('no forged capability or profile fallback',()=>profile('vps-lab',ctx=>{
  assert.throws(()=>encryptSession(scope,material(),ring,now,{...ctx}),code('SESSION_PROFILE_INVALID'));
  delete process.env.RA_YANDEX_MODE;
  assert.throws(()=>encryptSession(scope,material(),ring,now,ctx),code('SESSION_PROFILE_INVALID'));
}));
test('Cloud credential presence rejects private VPS context',()=>profile('vps-lab',()=>{
  process.env.SUPABASE_SERVICE_ROLE_KEY='SYNTHETIC_ONLY';assert.throws(()=>createVpsSessionContext(),code('SESSION_PROFILE_INVALID'));
}));
for(const field of ['companyId','locationId','organizationId'])test('wrong '+field+' rejects encryption',()=>profile('vps-lab',ctx=>{
  assert.throws(()=>encryptSession({...scope,[field]:field==='organizationId'?'123':'11111111-1111-4111-8111-111111111111'},material(),ring,now,ctx),code('SESSION_SCOPE_INVALID'));
}));
test('wrong key and altered AAD credential version reject without retry',()=>profile('vps-lab',ctx=>{
  const row=encryptSession(scope,material(),ring,now,ctx);
  assert.throws(()=>decryptSessionClassified(scope,row,{...ring,keys:{synthetic:Buffer.alloc(32,74)}},now,ctx),code('SESSION_AES_GCM_AUTH_FAILED'));
  assert.throws(()=>decryptSessionClassified(scope,{...row,credential_version:'11111111-1111-4111-8111-111111111111'},ring,now,ctx),code('SESSION_AES_GCM_AUTH_FAILED'));
}));
test('VPS store cannot default to Cloud and denies snapshot/alerts',()=>profile('vps-lab',async ctx=>{
  assert.throws(()=>createSessionStore({context:ctx}),code('SESSION_STORAGE_FAILED'));
  let calls=0;const store=createSessionStore({context:ctx,rpc:()=>{calls++;}});
  await assert.rejects(store.snapshot(scope,[]),code('SESSION_ACTION_INVALID'));
  await assert.rejects(store.claimAlert(scope,1),code('SESSION_ACTION_INVALID'));assert.equal(calls,0);
}));
test('secure native candidate validates, encrypts then calls existing CAS once; no plaintext response',()=>profile('vps-lab',async ctx=>{
  let writes=0;
  const importer=prepareVpsImport({context:ctx,keyring:ring,expectedRevision:0,now:()=>now,store:{replace:async(s,revision,encrypted)=>{
    assert.deepEqual(s,scope);assert.equal(revision,0);writes++;
    assert.doesNotMatch(JSON.stringify(encrypted),/NO_REAL_COOKIE/);
    assert.equal(decryptSessionClassified(s,encrypted,ring,now,ctx).cookies.length,1);
    return {state:'NOT_CONFIGURED',revision:1};
  }}});
  const message={nonce:importer.challenge.nonce,session:material()};
  const result=await importer.submit(message);
  assert.deepEqual(result,{ok:true,state:'NOT_CONFIGURED',revision:1});assert.equal(message.session.cookies[0].value,'');
  await assert.rejects(importer.submit(message),code('SESSION_IMPORT_REPLAY'));assert.equal(writes,1);
}));
for(const variant of ['expired','nonce','cookie','stale-cas'])test('import '+variant+' fails closed and consumes attempt',()=>profile('vps-lab',async ctx=>{
  let clock=now,writes=0;
  const importer=prepareVpsImport({context:ctx,keyring:ring,expectedRevision:0,now:()=>clock,store:{replace:async()=>{writes++;throw Object.assign(Error('SESSION_CHANGED'),{code:'SESSION_CHANGED'});}}});
  const message={nonce:importer.challenge.nonce,session:material()};
  if(variant==='expired')clock+=120001;
  if(variant==='nonce')message.nonce=Buffer.alloc(32,3).toString('base64');
  if(variant==='cookie')message.session.cookies[0].expires=1;
  await assert.rejects(importer.submit(message));
  await assert.rejects(importer.submit(message),code('SESSION_IMPORT_REPLAY'));
  assert.equal(writes,variant==='stale-cas'?1:0);assert.equal(message.session.cookies[0].value,'');
}));
function fixture(ctx,{broken=false}={}){
  let row={...encryptSession(scope,material(),ring,now,ctx),company_id:scope.companyId,location_id:scope.locationId,external_org_id:scope.organizationId,state:'NOT_CONFIGURED',revision:1};
  const stats={fetch:0,transition:0,forbidden:0};
  const forbidden=()=>{stats.forbidden++;throw Error('FORBIDDEN_EFFECT');};
  const store={read:async()=>structuredClone(row),replace:forbidden,snapshot:forbidden,claimAlert:forbidden,transition:async(s,r,data)=>{assert.equal(r,row.revision);assert.equal(data.sync_ok,false);stats.transition++;row={...row,...data,revision:r+1};return structuredClone(row);}};
  const service=createYandexSessionService({context:ctx,keyring:ring,store,now:()=>new Date(now),allowRead:true,notify:forbidden,fetchImpl:async(url,options)=>{
    stats.fetch++;assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');
    if(broken)return new Response('<html>login</html>');
    const page=Number(new URL(url).searchParams.get('page'));
    return new Response(JSON.stringify({list:{items:[{id:'synthetic-'+page,cmnt_entity_id:'synthetic-'+page,author:{user:'SYNTHETIC_AUTHOR'},full_text:'SYNTHETIC_REVIEW',rating:5,time_created:now,owner_comment:null,public_rating:true}],pager:{limit:1,offset:page-1,total:2}}}),{headers:{'content-type':'application/json'}});
  }});
  return {service,stats,store,get row(){return row;}};
}
test('VPS Stage A real service -> one fake page -> CAS READY; Stage B complete without writes',()=>profile('vps-lab',async ctx=>{
  const f=fixture(ctx);const a=await f.service.run(scope,{mode:'health',pageBase:1});
  assert.equal(a.ok,true);assert.equal(a.state,'READY');assert.equal(a.revision,2);assert.equal(f.stats.fetch,1);
  const b=await f.service.contractDiagnosticFull(scope,{expectedRevision:2});
  assert.equal(b.ok,true);assert.equal(b.unique_count,2);assert.equal(b.completeness,'PASS');
  assert.deepEqual(f.stats,{fetch:3,transition:1,forbidden:0});
  assert.doesNotMatch(JSON.stringify([a,b]),/NO_REAL_COOKIE|SYNTHETIC_AUTHOR|SYNTHETIC_REVIEW/);
}));
test('VPS login response -> REAUTH_REQUIRED and no alerts',()=>profile('vps-lab',async ctx=>{
  const f=fixture(ctx,{broken:true}),r=await f.service.run(scope,{mode:'health',pageBase:1});
  assert.equal(r.state,'REAUTH_REQUIRED');assert.deepEqual(f.stats,{fetch:1,transition:1,forbidden:0});
}));
test('full read failure only uses existing health CAS; uncertain CAS is not old READY',async()=>{
  let writes=0;
  const service={contractDiagnosticFull:async()=>({ok:false,error:'YANDEX_CONTRACT_DRIFT'})};
  const row={state:'READY',revision:2};
  const store={transition:async(s,r,value)=>{writes++;assert.equal(r,2);assert.equal(value.state,'ERROR');assert.equal(value.sync_ok,false);return {state:'ERROR',revision:3};}};
  const result=await runVpsDiagnostic({service,store,scope,row,operation:'full'});
  assert.equal(result.state,'ERROR');assert.equal(writes,1);
  store.transition=async()=>{throw Error('SYNTHETIC_CAS_FAILURE');};
  const unknown=await runVpsDiagnostic({service,store,scope,row,operation:'full'});
  assert.equal(unknown.state,null);assert.equal(unknown.revision,null);assert.equal(unknown.stateCas,'NOT_CONFIRMED');
});
test('changed session is never reconciled by full diagnostic adapter',async()=>{
  const result=await runVpsDiagnostic({service:{contractDiagnosticFull:async()=>({ok:false,error:'SESSION_CHANGED'})},
    store:{transition:async()=>{throw Error('MUST_NOT_CALL');}},scope,row:{revision:1},operation:'full'});
  assert.equal(result.state,null);
});
test('VPS rejects persist/dry_run/probe/rotate/disable and page zero',()=>profile('vps-lab',async ctx=>{
  const f=fixture(ctx);
  for(const mode of ['persist','dry_run','probe','pagination_probe'])await assert.rejects(f.service.run(scope,{mode,pageBase:1}),code('SESSION_MODE_INVALID'));
  await assert.rejects(f.service.run(scope,{mode:'health',pageBase:0}),code('SESSION_MODE_INVALID'));
  await assert.rejects(f.service.rotateKey(scope,1),code('SESSION_MODE_INVALID'));
  await assert.rejects(f.service.disable(scope,1),code('SESSION_MODE_INVALID'));
  assert.equal(f.stats.fetch,0);
}));
test('private VPS transport still rejects mutation, foreign host and page overflow',()=>profile('vps-lab',async ctx=>{
  let calls=0;const session=material();session.cookies[0].expires=-1;
  const transport=createYandexReadTransport({scope,context:ctx,session,allowRead:true,fetchImpl:()=>{calls++;}});
  const base={method:'GET',page:1,permanentId:scope.organizationId,url:`https://yandex.ru/sprav/api/${scope.organizationId}/reviews?ranking=by_time&source=pagination&page=1`};
  for(const req of [{...base,method:'POST'},{...base,url:base.url.replace('yandex.ru','example.invalid')},{...base,page:11},{...base,page:0}])await assert.rejects(transport(req),code('SESSION_REQUEST_INVALID'));
  assert.equal(calls,0);
}));
test('VPS adapter uses private pipe and peer roles, no Cloud/http/secret argv fallback',()=>{
  const ps=source('scripts/yandex-vps-import.ps1');
  assert.match(ps,/RedirectStandardInput=\$true/);assert.match(ps,/StrictHostKeyChecking=yes/);
  assert.doesNotMatch(ps,/Invoke-RestMethod|vercel\.app|SUPABASE_SERVICE_ROLE_KEY|Set-Content|Out-File|WriteAllText/);
  assert.match(source('tools/vps08a/session-access.sql'),/session_user not in/);
  assert.match(source('tools/vps08a/session-access.sql'),/security definer set search_path=''/);
  assert.doesNotMatch(source('tools/vps08a/session-access.sql'),/grant .* on review_private\.yandex_sessions to "review-yandex/);
  assert.doesNotMatch(source('tools/vps08a/session.mjs'),/writeFile|createWriteStream|sendSessionAlert|persistNormalizedReviews|enqueue/);
});
