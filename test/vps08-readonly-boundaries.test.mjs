// Offline source audit/regressions. These do NOT authorize or implement a VPS import.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createYandexReadTransport} from '../lib/server/yandex-session/transport.js';
import {createYandexSessionService} from '../lib/server/yandex-session/service.js';
import {createSessionStore} from '../lib/server/yandex-session/store.js';
import {encryptSession, ACCOUNT, ORG_ID} from '../lib/server/yandex-session/crypto.js';
import {runtimeProfile} from '../lib/server/runtime-profile.js';

const scope={companyId:'13f3cb80-487a-4a19-96a1-fb3103200230',locationId:'9a95f63b-18e6-447b-a449-8530b67ddbae',organizationId:ORG_ID};
const marker='SYNTHETIC_VPS08_NOT_A_REAL_COOKIE';
const material={account:ACCOUNT,cookies:[{name:'Session_id',value:marker,domain:'.yandex.ru',path:'/',secure:true,httpOnly:true,expires:-1}]};
const ring=()=>({currentKid:'synthetic-vps08',keys:{'synthetic-vps08':Buffer.alloc(32,43)}});
const request=page=>({method:'GET',page,permanentId:ORG_ID,url:`https://yandex.ru/sprav/api/${ORG_ID}/reviews?ranking=by_time&source=pagination&page=${page}`});
const payload=(page=1,total=2)=>({list:{items:[{id:`synthetic-${page}`,cmnt_entity_id:`synthetic-${page}`,author:{user:'SYNTHETIC_AUTHOR'},full_text:'SYNTHETIC_BODY',rating:5,time_created:1789000000123,owner_comment:null,public_rating:true}],pager:{limit:1,offset:page-1,total}}});
const response=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const code=name=>error=>error.code===name&&error.message===name;
const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
async function profile(name, action) {
  const names=['RA_RUNTIME_PROFILE','RA_LAB_ORIGIN','RA_LAB_ISSUER','RA_LAB_ANON_TOKEN','VERCEL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ANON_KEY','SUPABASE_SECRET_KEY'];
  const saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  for(const n of names)delete process.env[n];
  Object.assign(process.env,{RA_RUNTIME_PROFILE:name,RA_LAB_ORIGIN:'http://127.0.0.1:13000',RA_LAB_ISSUER:'http://127.0.0.1:13000/auth/v1',RA_LAB_ANON_TOKEN:'synthetic-not-a-token'});
  try{return await action();}finally{for(const n of names){if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];}}
}

test('VPS08 current vps-lab transport remains denied before any fetch',()=>profile('vps-lab',()=>{
  assert.equal(runtimeProfile().profile,'vps-lab');
  let fetches=0;
  assert.throws(()=>createYandexReadTransport({scope,session:material,allowRead:true,fetchImpl:()=>{fetches++;}}),code('PROVIDER_DISABLED_IN_VPS_LAB'));
  assert.equal(fetches,0);
}));
test('VPS08 current vps-lab store remains denied before any Cloud RPC',()=>profile('vps-lab',async()=>{
  let calls=0;
  await assert.rejects(createSessionStore({rpc:()=>{calls++;}}).read(scope),code('PROVIDER_DISABLED_IN_VPS_LAB'));
  assert.equal(calls,0);
}));
test('VPS08 current vps-lab encryption cannot silently reuse Cloud AAD',()=>profile('vps-lab',()=>{
  assert.throws(()=>encryptSession(scope,material,ring()),code('PROVIDER_DISABLED_IN_VPS_LAB'));
}));
test('unknown profile cannot silently select Cloud',()=>profile('unknown-vps08',()=>{
  assert.throws(()=>runtimeProfile(),{message:'RUNTIME_PROFILE_INVALID'});
}));
test('approved legacy source transport still denies mutation, foreign host/org/path and HTTP',()=>profile('cloud-dev',async()=>{
  let calls=0;
  const read=createYandexReadTransport({scope,session:material,allowRead:true,fetchImpl:()=>{calls++;return response(payload());}});
  const valid=request(1);
  for(const req of [
    ...['POST','PUT','PATCH','DELETE','HEAD'].map(method=>({...valid,method})),
    {...valid,url:valid.url.replace('https:','http:')},
    {...valid,url:valid.url.replace('yandex.ru','example.invalid')},
    {...valid,url:valid.url.replace('/reviews','/owner-comment')},
    {...valid,url:valid.url.replace(ORG_ID,'123')},
    {...valid,permanentId:'123'}
  ])await assert.rejects(read(req),code('SESSION_REQUEST_INVALID'));
  assert.equal(calls,0);
}));
test('missing approval fails before transport',()=>profile('cloud-dev',async()=>{
  let calls=0;
  const read=createYandexReadTransport({scope,session:material,fetchImpl:()=>{calls++;}});
  await assert.rejects(read(request(1)),code('LIVE_READ_NOT_APPROVED'));assert.equal(calls,0);
}));
test('redirect is refused once and never followed',()=>profile('cloud-dev',async()=>{
  let calls=0;
  const read=createYandexReadTransport({scope,session:material,allowRead:true,fetchImpl:async(_url,options)=>{
    calls++;assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');assert.ok(options.signal);
    return new Response(null,{status:302,headers:{location:'https://example.invalid/login'}});
  }});
  await assert.rejects(read(request(1)),code('YANDEX_LOGIN_REDIRECT'));assert.equal(calls,1);
}));
test('expired material fails without contacting provider',()=>profile('cloud-dev',async()=>{
  let calls=0;const session=structuredClone(material);session.cookies[0].expires=1;
  const read=createYandexReadTransport({scope,session,allowRead:true,fetchImpl:()=>{calls++;}});
  await assert.rejects(read(request(1)),code('SESSION_COOKIE_INVALID'));assert.equal(calls,0);
}));
test('timeout fixture is safe and never retried',()=>profile('cloud-dev',async()=>{
  let calls=0;
  const read=createYandexReadTransport({scope,session:material,allowRead:true,fetchImpl:()=>{calls++;throw Error(marker);}});
  await assert.rejects(read(request(1)),code('YANDEX_NETWORK_ERROR'));assert.equal(calls,1);
}));
test('login HTML, challenge, malformed JSON and non-JSON media types fail closed',()=>profile('cloud-dev',async()=>{
  const fixtures=[
    [()=>new Response('<html>login</html>'),'YANDEX_LOGIN_HTML'],
    [()=>response({captcha:true}),'YANDEX_CHALLENGE'],
    [()=>new Response('not json'),'YANDEX_MALFORMED_JSON'],
    [()=>new Response(JSON.stringify(payload())),'YANDEX_MALFORMED_JSON']
  ];
  for(const [fake,expected] of fixtures){let calls=0;const read=createYandexReadTransport({scope,session:material,allowRead:true,fetchImpl:()=>{calls++;return fake();}});await assert.rejects(read(request(1)),code(expected));assert.equal(calls,1);}
}));
test('oversize fixture is bounded',()=>profile('cloud-dev',async()=>{
  const read=createYandexReadTransport({scope,session:material,allowRead:true,fetchImpl:()=>new Response('x'.repeat(2_000_001))});
  await assert.rejects(read(request(1)),code('YANDEX_RESPONSE_TOO_LARGE'));
}));

function diagnostic(total=2, state='READY') {
  const keyring=ring();const row={...encryptSession(scope,material,keyring),company_id:scope.companyId,location_id:scope.locationId,external_org_id:ORG_ID,state,revision:1};
  const calls={fetch:0,mutations:0,notifications:0};
  const forbidden=()=>{calls.mutations++;throw Error('SIDE_EFFECT_DENIED');};
  const store={read:async()=>structuredClone(row),snapshot:forbidden,replace:forbidden,transition:forbidden,claimAlert:forbidden};
  const service=createYandexSessionService({store,keyring,allowRead:true,notify:()=>{calls.notifications++;throw Error('NOTIFY_DENIED');},
    persistenceWriter:{persistNormalizedReviews:forbidden},fetchImpl:(_url,options)=>{assert.equal(options.method,'GET');calls.fetch++;return response(payload(calls.fetch,total));}});
  return {service,calls,row,store};
}
test('existing full diagnostic uses no writer, snapshot, alert, promo or AI and returns no content',()=>profile('cloud-dev',async()=>{
  const f=diagnostic();const result=await f.service.contractDiagnosticFull(scope,{expectedRevision:1});
  assert.equal(result.ok,true);assert.equal(result.completeness,'PASS');assert.equal(result.unique_count,2);
  assert.deepEqual(f.calls,{fetch:2,mutations:0,notifications:0});
  assert.doesNotMatch(JSON.stringify(result),/SYNTHETIC_BODY|SYNTHETIC_AUTHOR|SYNTHETIC_VPS08|synthetic-1|Cookie:|Authorization:/);
}));
test('existing full diagnostic retains hard cap five; no hidden page six',()=>profile('cloud-dev',async()=>{
  const f=diagnostic(6);const result=await f.service.contractDiagnosticFull(scope,{expectedRevision:1});
  assert.equal(result.ok,false);assert.equal(result.error,'YANDEX_PAGINATION_LIMIT_EXCEEDED');
  assert.equal(result.completeness,'NOT_CONFIRMED');assert.deepEqual(f.calls,{fetch:5,mutations:0,notifications:0});
}));
test('revision mismatch and non-READY state stop full diagnostic before fetch',()=>profile('cloud-dev',async()=>{
  const f=diagnostic();assert.equal((await f.service.contractDiagnosticFull(scope,{expectedRevision:2})).error,'SESSION_CHANGED');
  const g=diagnostic(2,'NOT_CONFIGURED');assert.equal((await g.service.contractDiagnosticFull(scope,{expectedRevision:1})).error,'SESSION_NOT_READY');
  assert.equal(f.calls.fetch+g.calls.fetch,0);
}));
test('missing stored session stops diagnostic before fetch',()=>profile('cloud-dev',async()=>{
  const f=diagnostic();f.store.read=async()=>null;
  assert.equal((await f.service.contractDiagnosticFull(scope,{expectedRevision:1})).error,'SESSION_CHANGED');
  assert.equal(f.calls.fetch,0);
}));
test('import and native worker are NOT represented as VPS08-ready mechanisms',()=>{
  assert.match(source('scripts/import-yandex-session.ps1'),/myasnoy-batya-review-dev-preview\.vercel\.app/);
  assert.match(source('lib/server/yandex-session/crypto.js'),/JSON\.stringify\(\['ykiubttldgyjpajmsuas'/);
  assert.match(source('tools/vps06/worker.mjs'),/SYNTHETIC_MODE_REQUIRED/);
  assert.doesNotMatch(source('lib/server/yandex-session/transport.js'),/replies|persistNormalizedReviews|sendSessionAlert|sendTelegram|sendResend|openai/i);
});
