import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createYandexConnectionReconciliation, requestDevServiceRpc } from '../lib/server/review-sync.js';
import { createReviewSyncWorkerHandler, ASBEST_SYNC_SCOPE } from '../lib/server/review-sync-worker.js';
import deployedHandler from '../api/internal/review-sync-worker.js';
const secret = 'synthetic-worker-only';
const key = 'sb_secret_synthetic_only';
const forbidden = 'PRIVATE_SYNTHETIC_COOKIE_OR_TOKEN';
const good = {ok:true,changed:true,status:'READY',session_state:'READY'};
const business = ['REVIEW_SCOPE_INVALID','REVIEW_CONNECTION_NOT_FOUND','SESSION_NOT_READY','RECONCILIATION_NOT_ALLOWED'];
const req = () => ({method:'POST',headers:{authorization:`Bearer ${secret}`},body:{operation:'reconcile_connection'}});
const res = () => ({statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(c){this.statusCode=c;return this;},json(b){this.body=b;return this;}});
function setup(fetchImpl, credential=key) {
  const calls=[];
  const rpc=(name,payload)=>requestDevServiceRpc(name,payload,{key:credential,fetchImpl:async(url,opts)=>{
    calls.push({url,opts});return fetchImpl(url,opts);
  }});
  const handler=createReviewSyncWorkerHandler({getSecret:()=>secret,
    reconcileConnection:createYandexConnectionReconciliation({rpc}),
    run:async()=>assert.fail('worker forbidden'),health:async()=>assert.fail('health forbidden'),
    preflight:async()=>assert.fail('preflight forbidden')});
  return {calls,run:async(r=req())=>{const response=res();await handler(r,response);return response;}};
}
for(const code of business) test(`real HTTP/helper/client preserves exact RPC rejection ${code}`, async()=>{
  const f=setup(async()=>new Response(JSON.stringify({code:'22023',message:code,details:forbidden,hint:forbidden}),{status:400}));
  const r=await f.run();assert.equal(r.statusCode,503);assert.equal(r.body.error,code);
  assert.equal(r.body.outcome,'BUSINESS_REJECTED');assert.equal(r.body.connection_effect,'NOT_APPLIED_BY_THIS_RPC');
  assert.equal(r.body.changed,undefined);assert.equal(f.calls.length,1);
  const call=f.calls[0];assert.equal(call.opts.redirect,'error');
  assert.deepEqual(JSON.parse(call.opts.body),{p_company_id:ASBEST_SYNC_SCOPE.companyId,p_location_id:ASBEST_SYNC_SCOPE.locationId,p_org_id:ASBEST_SYNC_SCOPE.organizationId});
  assert.match(call.url,/\/rpc\/review_reconcile_yandex_connection$/);
  assert.doesNotMatch(JSON.stringify(r.body),new RegExp(forbidden));
});
for(const changed of [true,false]) test(`real reconciliation success changed=${changed}`,async()=>{
  const f=setup(async()=>new Response(JSON.stringify({...good,changed,leak:forbidden})));
  const r=await f.run();assert.equal(r.statusCode,200);assert.equal(r.body.changed,changed);
  assert.equal(r.body.outcome,changed?'CHANGED':'ALREADY_READY');assert.equal(f.calls.length,1);
  assert.doesNotMatch(JSON.stringify(r.body),new RegExp(forbidden));
});
test('transport rejection with forged business code is UNKNOWN, never a business no-op',async()=>{
  const f=setup(async()=>{throw Object.assign(new Error(forbidden),{code:'RECONCILIATION_NOT_ALLOWED',failure_stage:'RPC_ERROR_RESPONSE'});});
  const r=await f.run();assert.equal(r.body.error,'RECONCILIATION_FAILED');
  assert.equal(r.body.connection_effect,'UNKNOWN');assert.equal(r.body.changed,undefined);assert.equal(f.calls.length,1);
});
test('non-JSON response after possible committed mutation retains UNKNOWN',async()=>{
  let committed=false;
  const f=setup(async()=>{committed=true;return new Response(forbidden);});const r=await f.run();
  assert.equal(committed,true);assert.equal(r.body.connection_effect,'UNKNOWN');
  assert.equal(r.body.error,'RECONCILIATION_CONTRACT_DRIFT');assert.equal(f.calls.length,1);
});
for(const payload of [{...good,changed:'false'},null,[],{...good,status:'ERROR'}, {code:'22023',message:'RECONCILIATION_NOT_ALLOWED'}])
 test('malformed HTTP 200 is not a business rejection: '+JSON.stringify(payload),async()=>{
  const f=setup(async()=>new Response(JSON.stringify(payload)));const r=await f.run();
  assert.equal(r.statusCode,503);assert.equal(r.body.error,'RECONCILIATION_CONTRACT_DRIFT');assert.equal(r.body.connection_effect,'UNKNOWN');
 });
for(const code of ['42501','P0001','PGRST202',null])test('wrong SQLSTATE cannot forge reconciliation rejection '+code,async()=>{
 const f=setup(async()=>new Response(JSON.stringify({code,message:'RECONCILIATION_NOT_ALLOWED',details:forbidden}),{status:400}));
 const r=await f.run();assert.equal(r.body.error,'RECONCILIATION_FAILED');assert.equal(r.body.outcome,'UNCONFIRMED');
});
test('missing service credential is proven NOT_ATTEMPTED',async()=>{
 const f=setup(async()=>assert.fail('must not call'), '');const r=await f.run();
 assert.equal(r.body.connection_effect,'NOT_ATTEMPTED');assert.equal(f.calls.length,0);
});
test('auth, method and invalid operation never dispatch an RPC',async()=>{
 const f=setup(async()=>assert.fail('must not call'));
 for(const request of [{...req(),method:'GET'},{...req(),headers:{}},{...req(),body:{operation:'reconcile_connection',company_id:'attacker'}}]){
  const r=await f.run(request);assert.ok([400,401,405].includes(r.statusCode));
 }assert.equal(f.calls.length,0);
});
test('default deployed composition preserves exact safe code with only Fetch replaced',async t=>{
 for(const [name,value] of Object.entries({REVIEW_WORKER_SECRET:secret,SUPABASE_SERVICE_ROLE_KEY:key})){
  const old=process.env[name];process.env[name]=value;t.after(()=>{if(old===undefined)delete process.env[name];else process.env[name]=old;});
 }
 let n=0;t.mock.method(globalThis,'fetch',async()=>{n++;return new Response(JSON.stringify({code:'22023',message:'RECONCILIATION_NOT_ALLOWED',hint:forbidden}),{status:400});});
 const response=res();await deployedHandler(req(),response);
 assert.equal(response.body.error,'RECONCILIATION_NOT_ALLOWED');assert.equal(n,1);
});
test('installed reconciliation SQL rejects CONTRACT_DRIFT through actual handler/helper/client',async t=>{
 const db=await PGlite.create();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema review_private;create schema cron;create table cron.job(jobname text,active boolean);
 create table public.review_provider_connections(id uuid primary key,company_id uuid,provider text,enabled boolean,status text,last_error text,config jsonb,updated_at timestamptz);
 create table review_private.yandex_sessions(company_id uuid,location_id uuid,external_org_id text,state text);
 insert into public.review_provider_connections values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${ASBEST_SYNC_SCOPE.companyId}','yandex',true,'ERROR','YANDEX_CONTRACT_DRIFT','{"location_id":"${ASBEST_SYNC_SCOPE.locationId}","external_org_id":"${ASBEST_SYNC_SCOPE.organizationId}"}','2000-01-01');
 insert into review_private.yandex_sessions values('${ASBEST_SYNC_SCOPE.companyId}','${ASBEST_SYNC_SCOPE.locationId}','${ASBEST_SYNC_SCOPE.organizationId}','READY');`);
 await db.exec(readFileSync(new URL('../supabase/migrations/20260913200000_yandex_connection_state_reconciliation_07a4b.sql',import.meta.url),'utf8'));
 const before=(await db.query('select status,last_error,updated_at from review_provider_connections')).rows;
 const f=setup(async(_url,opts)=>{
  const p=JSON.parse(opts.body);
  try{const r=await db.query('select review_reconcile_yandex_connection($1,$2,$3) result',[p.p_company_id,p.p_location_id,p.p_org_id]);return new Response(JSON.stringify(r.rows[0].result));}
  catch(e){return new Response(JSON.stringify({code:e.code,message:e.message,details:forbidden}),{status:400});}
 });
 const r=await f.run();assert.equal(r.body.error,'RECONCILIATION_NOT_ALLOWED');assert.equal(f.calls.length,1);
 assert.deepEqual((await db.query('select status,last_error,updated_at from review_provider_connections')).rows,before);
});
for(const error of ['REVIEW_BATCH_INVALID','REVIEW_ROW_INVALID','REVIEW_BATCH_DUPLICATE','REVIEW_RAW_PAYLOAD_INVALID'])test('writer safe code survives outer RPC catch: '+error,async()=>{
 await assert.rejects(requestDevServiceRpc('review_persist_external_reviews',{}, {key,fetchImpl:async()=>new Response(JSON.stringify({code:'P0001',message:error,details:forbidden}),{status:400})}),{code:error});
});
