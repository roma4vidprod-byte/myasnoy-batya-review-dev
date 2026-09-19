import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {diagnoseYandexReviewsPayload,parseYandexReviewsPayload} from '../lib/providers/yandex.js';
import {createYandexSessionService} from '../lib/server/yandex-session/service.js';
import {encryptSession,ACCOUNT} from '../lib/server/yandex-session/crypto.js';
import {createVpsSessionContext,VPS_SESSION_SCOPE as scope} from '../lib/server/yandex-session/profile-context.js';
const marker='SYNTHETIC_PRIVATE_VPS08B';
const payload=()=>JSON.parse(readFileSync(new URL('./fixtures/yandex/single-review.json',import.meta.url),'utf8'));
async function fixture(fn,options={}){
  const names=['RA_RUNTIME_PROFILE','RA_YANDEX_MODE','VERCEL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SECRET_KEY','SUPABASE_ANON_KEY','YANDEX_SESSION_KEYS_JSON','YANDEX_SESSION_ACTIVE_KID','REVIEW_WORKER_SECRET'];
  const saved=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  for(const n of names)delete process.env[n];
  process.env.RA_RUNTIME_PROFILE='vps-lab';process.env.RA_YANDEX_MODE='read-only-admin';
  try{
    const context=createVpsSessionContext(),keyring={currentKid:'synthetic',keys:{synthetic:Buffer.alloc(32,82)}};
    const material={account:ACCOUNT,cookies:[{name:'synthetic',value:marker,domain:'.yandex.ru',path:'/',secure:true,httpOnly:true,expires:-1}]};
    const row={...encryptSession(scope,material,keyring,Date.now(),context),company_id:scope.companyId,location_id:scope.locationId,external_org_id:scope.organizationId,state:options.state??'ERROR',revision:options.revision??3};
    const before=structuredClone(row),calls={fetch:0,reads:0,forbidden:0};
    const forbidden=()=>{calls.forbidden++;throw Error(marker);};
    const store={read:async()=>{calls.reads++;return structuredClone(row);},transition:forbidden,replace:forbidden,snapshot:forbidden,claimAlert:forbidden};
    const service=createYandexSessionService({context,keyring,store,allowRead:true,notify:forbidden,fetchImpl:async(url,opt)=>{
      calls.fetch++;assert.equal(new URL(url).hostname,'yandex.ru');assert.equal(new URL(url).searchParams.get('page'),'4');assert.equal(opt.method,'GET');assert.equal(opt.redirect,'manual');
      if(options.throw)throw Error(marker);
      if(options.race)row.revision++;
      return new Response(options.body??JSON.stringify(payload()),{status:options.status??200,headers:{'content-type':options.contentType??'application/json'}});
    }});
    await fn({service,row,before,calls});assert.equal(calls.forbidden,0);
  }finally{for(const n of names)if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];}
}
test('page4 scoped diagnostic has one GET, measured bytes, safe projection, no CAS',()=>fixture(async({service,row,before,calls})=>{
  const r=await service.contractDiagnostic(scope,{page:4,expectedRevision:3});
  assert.equal(r.ok,true);assert.equal(r.response_bytes,Buffer.byteLength(JSON.stringify(payload())));
  assert.equal(r.revision,3);assert.equal(r.state_after,'ERROR');assert.equal(calls.fetch,1);
  assert.deepEqual(row,before);assert.doesNotMatch(JSON.stringify(r),new RegExp(marker));
}));
for(const opt of [{page:1,expectedRevision:3},{page:4,expectedRevision:2},{page:4},{page:5,expectedRevision:3}])test('VPS deny unapproved page/revision '+JSON.stringify(opt),()=>fixture(async({service,calls})=>{
  await assert.rejects(service.contractDiagnostic(scope,opt),{code:'SESSION_MODE_INVALID'});assert.equal(calls.fetch,0);
}));
for(const opt of [{state:'READY'},{revision:4}])test('VPS deny changed snapshot '+JSON.stringify(opt),()=>fixture(async({service,calls})=>{
  await assert.rejects(service.contractDiagnostic(scope,{page:4,expectedRevision:3}),{code:'SESSION_CHANGED'});assert.equal(calls.fetch,0);
},opt));
for(const [opt,code] of [[{throw:true},'YANDEX_NETWORK_ERROR'],[{status:302},'YANDEX_LOGIN_REDIRECT'],[{body:'<html>captcha</html>'},'YANDEX_CHALLENGE'],[{body:'bad'},'YANDEX_MALFORMED_JSON'],[{body:'x'.repeat(2000001)},'YANDEX_RESPONSE_TOO_LARGE'],[{race:true},'SESSION_CHANGED']])test('page4 fail closed '+code,()=>fixture(async({service,calls})=>{
  const r=await service.contractDiagnostic(scope,{page:4,expectedRevision:3});assert.equal(r.ok,false);assert.equal(r.error,code);assert.equal(calls.fetch,1);assert.doesNotMatch(JSON.stringify(r),new RegExp(marker));
},opt));
test('existing full diagnostic still requires READY, no page4 fallback',()=>fixture(async({service,calls})=>{
  const r=await service.contractDiagnosticFull(scope,{expectedRevision:3});assert.equal(r.error,'SESSION_NOT_READY');assert.equal(calls.fetch,0);
}));
for(const [field,value,rule,actual] of [['rating',0,'integer.range','number'],['time_created','bad','timestamp.format','string'],['author',{user:{}},'text.type','object'],['owner_comment',{text:null},'field.required','undefined']])test('precise item rule '+field,()=>{
  const p=payload();p.list.items[0][field]=value;p[marker]=marker;p.list.items[0].full_text=marker;
  const r=diagnoseYandexReviewsPayload(p,scope.organizationId);assert.equal(r.ok,false);
  assert.equal(r.contract_failure.contract_rule_id,rule);assert.equal(r.contract_failure.actual_type,actual);assert.equal(r.contract_failure.item_index,0);
  assert.doesNotMatch(JSON.stringify(r),new RegExp(marker));assert.throws(()=>parseYandexReviewsPayload(p),{code:'YANDEX_CONTRACT_DRIFT'});
});
test('partial page remains rejected with exact length rule',()=>{
  const p=payload();p.list.pager.total=50;const r=diagnoseYandexReviewsPayload(p);assert.equal(r.contract_failure.contract_rule_id,'items.page_length');assert.equal(r.contract_failure.json_path,'$.list.items.length');
});
const page4=()=>JSON.parse(readFileSync(new URL('./fixtures/yandex/page4-inconsistent-total-synthetic.json',import.meta.url)));
test('live structural case: eleven items cannot complete offset60 total70; no semantic relaxation',()=>{
  const p=page4(),r=diagnoseYandexReviewsPayload(p,scope.organizationId);
  assert.equal(r.ok,false);assert.equal(r.parser.failure_point,'list.items.length');
  assert.deepEqual(r.contract_failure,{contract_rule_id:'items.page_length',json_path:'$.list.items.length',
    expected_shape:'min(limit,total-offset)',actual_type:'number',present:true,item_index:null});
  assert.deepEqual(r.pagination,{limit:20,offset:60,total:70,items:11});
  assert.throws(()=>parseYandexReviewsPayload(p),{code:'YANDEX_CONTRACT_DRIFT'});
});
test('valid terminal ten items total70 still passes',()=>{
  const p=page4();p.list.items.pop();assert.equal(parseYandexReviewsPayload(p).reviews.length,10);
});
test('valid terminal eleven items total71 passes without count hardcoding',()=>{
  const p=page4();p.list.pager.total=71;assert.equal(parseYandexReviewsPayload(p).reviews.length,11);
});
test('structurally valid page length does not hide malformed item',()=>{
  const p=page4();p.list.pager.total=71;p.list.items[10].owner_comment.time_created={};
  const r=diagnoseYandexReviewsPayload(p);assert.equal(r.ok,false);assert.equal(r.contract_failure.item_index,10);
  assert.equal(r.contract_failure.contract_rule_id,'timestamp.type');assert.equal(r.contract_failure.actual_type,'object');
});
test('actual diagnostic service reports inconsistent terminal shape once, no state/write side effects',()=>fixture(async({service,row,before,calls})=>{
  const r=await service.contractDiagnostic(scope,{page:4,expectedRevision:3});assert.equal(r.ok,false);
  assert.equal(r.contract_failure.page_number,4);assert.equal(r.contract_failure.contract_rule_id,'items.page_length');
  assert.equal(calls.fetch,1);assert.deepEqual(row,before);
},{body:JSON.stringify(page4())}));
