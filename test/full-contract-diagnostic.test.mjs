import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createYandexSessionService} from '../lib/server/yandex-session/service.js';
import {encryptSession} from '../lib/server/yandex-session/crypto.js';
import {createReviewContractDiagnostic,createReviewSyncWorkerHandler,ASBEST_SYNC_SCOPE as scope} from '../lib/server/review-sync-worker.js';
import deployedHandler from '../api/internal/review-sync-worker.js';
import {safeSchemaRule} from '../lib/server/yandex-session/preflight.js';
import {inspectYandexReviewsPayload} from '../lib/providers/yandex.js';
const keyring=()=>({currentKid:'fixture',keys:{fixture:Buffer.alloc(32,7)}});
const item=JSON.parse(readFileSync(new URL('./fixtures/yandex/single-review.json',import.meta.url))).list.items[0];
const SECRET='synthetic-worker';const PRIVATE='PRIVATE_SESSION_AND_REVIEW_MARKER';
const material={account:'myasnoibatya-zakaz',cookies:[{name:'fixture',value:PRIVATE,domain:'.yandex.ru',path:'/',secure:true,expires:-1}]};
const httpResponse=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
function fixture({failure,total=67,state='READY',revision=13}={}){
 const ring=keyring();const calls=[];let reads=0;
 const row={...encryptSession(scope,material,ring),company_id:scope.companyId,location_id:scope.locationId,external_org_id:scope.organizationId,state,revision};
 const original=JSON.stringify(row);
 const get=async()=>{
  reads++;
  if(failure==='read')throw Object.assign(new Error(PRIVATE),{code:'SESSION_STORAGE_FAILED'});
  return failure==='stale'&&calls.length===1?{...row,revision:revision+1}:row;
 };
 const fetchImpl=async(url,opts)=>{
  const page=Number(new URL(url).searchParams.get('page'));calls.push(page);
  assert.equal(opts.method,'GET');assert.equal(opts.redirect,'manual');assert.ok(opts.signal instanceof AbortSignal);
  assert.match(url,/^https:\/\/yandex\.ru\/sprav\/api\/54309413522\/reviews\?ranking=by_time&source=pagination&page=[1-5]$/);
  if(failure==='sync_throw')throw new Error(PRIVATE);
  if(page===3 && failure==='login')return new Response('',{status:302,headers:{location:'https://evil.invalid/'+PRIVATE}});
  if(page===3 && failure==='malformed')return new Response('{',{headers:{'content-type':'application/json'}});
  const offset=(page-1)*20;
  const items=Array.from({length:Math.min(20,total-offset)},(_,i)=>{
   const id=failure==='duplicate'&&offset+i===20?0:offset+i;
   return {...item,id:'fixture-'+id,cmnt_entity_id:'fixture-'+id,author:{user:PRIVATE},full_text:PRIVATE,public_rating:true};
  });
  if(page===3&&failure==='drift')items[0].public_rating={unexpected:true};
  if(page===3&&failure==='short')items.pop();
  return httpResponse({[PRIVATE]:PRIVATE,list:{items,pager:{limit:20,offset,total:failure==='moving_total'&&page===3?total+1:total}}});
 };
 const service=createYandexSessionService({store:{read:get,transition:async()=>assert.fail('state writes forbidden'),snapshot:async()=>assert.fail('review reads forbidden'),claimAlert:async()=>assert.fail('alert claims forbidden'),replace:async()=>assert.fail('replace forbidden')},keyring:ring,allowRead:true,fetchImpl,notify:async()=>assert.fail('notification forbidden')});
 return {service,calls,get,fetchImpl,row,unchanged:()=>assert.equal(JSON.stringify(row),original)};
}
test('four pages use existing full parser with no DB/state/queue/notification side effects',async()=>{
 const f=fixture();const r=await f.service.contractDiagnosticFull(scope,{expectedRevision:13});
 assert.equal(r.ok,true);assert.deepEqual(f.calls,[1,2,3,4]);assert.equal(r.unique_count,67);assert.equal(r.received_count,67);
 assert.equal(r.transport_attempted,4);assert.equal(r.transport_completed,4);assert.equal(r.completeness,'PASS');
 assert.equal(r.session_mutations,'OFF');assert.equal(r.review_persistence,'OFF');assert.equal(r.revision,13);
 assert.doesNotMatch(JSON.stringify(r),new RegExp(PRIVATE));f.unchanged();
});
for(const [failure,code,calls] of [['drift','YANDEX_CONTRACT_DRIFT',3],['short','YANDEX_CONTRACT_DRIFT',3],['moving_total','YANDEX_PAGINATION_CHANGED',3],['duplicate','YANDEX_PAGINATION_CHANGED',4],['login','YANDEX_LOGIN_REDIRECT',3],['malformed','YANDEX_MALFORMED_JSON',3],['sync_throw','YANDEX_NETWORK_ERROR',1],['stale','SESSION_CHANGED',1],['read','SESSION_STORAGE_FAILED',0]])
 test('full diagnostic fail-closed '+failure,async()=>{
  const f=fixture({failure});const r=await f.service.contractDiagnosticFull(scope,{expectedRevision:13});
  assert.equal(r.ok,false);assert.equal(r.error,code);assert.equal(f.calls.length,calls);assert.equal(r.transport_attempted,calls);
  assert.equal(r.completeness,'NOT_CONFIRMED');assert.equal(r.review_persistence,'OFF');f.unchanged();
  assert.doesNotMatch(JSON.stringify(r),new RegExp(PRIVATE));
  if(failure==='drift'){assert.equal(r.failed_page,3);assert.equal(r.parser.failure_point,'public_rating');assert.deepEqual(r.parser.field_stats.types,{object:1,boolean:19});}
 });
test('five-page budget stops incomplete response, not a truncated PASS',async()=>{
 const f=fixture({total:101});const r=await f.service.contractDiagnosticFull(scope,{expectedRevision:13});
 assert.equal(r.error,'YANDEX_PAGINATION_LIMIT_EXCEEDED');assert.equal(r.failure_stage,'PAGINATION');assert.deepEqual(f.calls,[1,2,3,4,5]);f.unchanged();
});
for(const state of ['DISABLED','NOT_CONFIGURED','ERROR','REAUTH_REQUIRED'])test('full diagnostic requires READY without forcing it: '+state,async()=>{
 const f=fixture({state});const r=await f.service.contractDiagnosticFull(scope,{expectedRevision:13});assert.equal(r.error,'SESSION_NOT_READY');assert.equal(f.calls.length,0);f.unchanged();
});
test('stale expected revision fails before request',async()=>{
 const f=fixture();const r=await f.service.contractDiagnosticFull(scope,{expectedRevision:12});assert.equal(r.error,'SESSION_CHANGED');assert.equal(f.calls.length,0);
});
test('empty provider feed is valid and has no invented sample',async()=>{
 const f=fixture({total:0});const r=await f.service.contractDiagnosticFull(scope,{expectedRevision:13});assert.equal(r.ok,true);assert.equal(r.unique_count,0);assert.deepEqual(f.calls,[1]);
});
function res(){return {statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(b){this.body=b;return this;}};}
const req=body=>({method:'POST',headers:{authorization:`Bearer ${SECRET}`},body});
test('actual default composition: full operation uses only session read RPC and fake Yandex',async t=>{
 const f=fixture();let rpcCalls=0;
 const variables={REVIEW_WORKER_SECRET:SECRET,SUPABASE_SERVICE_ROLE_KEY:'sb_secret_synthetic_only',YANDEX_SESSION_KEYS_JSON:JSON.stringify({fixture:Buffer.alloc(32,7).toString('base64')}),YANDEX_SESSION_ACTIVE_KID:'fixture',YANDEX_LIVE_READ_APPROVAL:'asbest-read-only-v1'};
 for(const [n,v]of Object.entries(variables)){const old=process.env[n];process.env[n]=v;t.after(()=>{if(old===undefined)delete process.env[n];else process.env[n]=old;});}
 t.mock.method(globalThis,'fetch',async(url,opts)=>{
  if(url.includes('supabase.co')){rpcCalls++;assert.match(url,/\/review_yandex_session_store$/);const p=JSON.parse(opts.body);assert.equal(p.p_action,'read');return httpResponse(await f.get());}
  return f.fetchImpl(url,opts);
 });
 const r=res();await deployedHandler(req({operation:'contract_diagnostic_full',expected_revision:13}),r);
 assert.equal(r.statusCode,200);assert.equal(r.body.operation,'contract_diagnostic_full');assert.equal(r.body.unique_count,67);assert.deepEqual(f.calls,[1,2,3,4]);assert.equal(rpcCalls,7);f.unchanged();
});
test('full diagnostic HTTP denies extra scope, missing/bad revision, wrong auth, no worker fallthrough',async()=>{
 let calls=0;const handler=createReviewSyncWorkerHandler({getSecret:()=>SECRET,contractDiagnostic:async()=>{calls++;},run:async()=>assert.fail('worker forbidden')});
 for(const body of [{operation:'contract_diagnostic_full'},{operation:'contract_diagnostic_full',expected_revision:'13'},{operation:'contract_diagnostic_full',expected_revision:13,scope:'attacker'},{operation:'contract_diagnostic_full',expected_revision:-1}]){
  const r=res();await handler(req(body),r);assert.equal(r.statusCode,400);
 }
 const r=res();await handler({...req({operation:'contract_diagnostic_full',expected_revision:13}),headers:{}},r);assert.equal(r.statusCode,401);assert.equal(calls,0);
});
test('diagnostic unknown property names never leak at any nesting level',()=>{
 const payload={list:{items:[{...item,[PRIVATE]:PRIVATE,author:{user:'normal',[PRIVATE]:PRIVATE}}],pager:{limit:20,total:1,offset:0,[PRIVATE]:PRIVATE},[PRIVATE]:PRIVATE},[PRIVATE]:PRIVATE};
 const report=inspectYandexReviewsPayload(payload);assert.doesNotMatch(JSON.stringify(report),new RegExp(PRIVATE));
 assert.equal(report.unexpected_key_counts.top_level,1);assert.equal(report.unexpected_key_counts.author,1);
});
test('schema-rule output rejects tainted metadata and getters',()=>{
 const rule={code:'SESSION_COOKIE_EXPIRED',path:'cookies[*].expires',expected_type:'future unix-seconds number',actual_type:'number',present:true};
 assert.deepEqual(safeSchemaRule(rule),rule);
 for(const field of ['path','expected_type','actual_type'])assert.equal(safeSchemaRule({...rule,[field]:PRIVATE}),null);
 const getter={...rule};Object.defineProperty(getter,'path',{get(){assert.fail('getter executed');}});assert.equal(safeSchemaRule(getter),null);
});
