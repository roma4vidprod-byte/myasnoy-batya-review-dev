import test from 'node:test';import assert from 'node:assert/strict';
import {createYandexSessionService} from '../lib/server/yandex-session/service.js';
import {createReviewPersistenceWriter} from '../lib/server/review-persistence-writer.js';
import {encryptSession,ACCOUNT} from '../lib/server/yandex-session/crypto.js';
import {createVpsSessionContext,VPS_SESSION_SCOPE as scope} from '../lib/server/yandex-session/profile-context.js';
const secret='SYNTHETIC_PRIVATE_VPS09';
const review=i=>({id:secret+i,author:{user:secret},rating:5,full_text:secret,time_created:1577836800000,
 owner_comment:i===0?{text:secret,time_created:1577836800000,moderation_status:'published'}:null});
async function fixture(fn,opt={}){
 const names=['RA_RUNTIME_PROFILE','RA_YANDEX_MODE','VERCEL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SECRET_KEY','SUPABASE_ANON_KEY','YANDEX_SESSION_KEYS_JSON','YANDEX_SESSION_ACTIVE_KID','REVIEW_WORKER_SECRET'];
 const saved=Object.fromEntries(names.map(k=>[k,process.env[k]]));for(const k of names)delete process.env[k];
 process.env.RA_RUNTIME_PROFILE='vps-lab';process.env.RA_YANDEX_MODE='read-only-admin';
 try{
  const context=createVpsSessionContext(),keyring={currentKid:'synthetic',keys:{synthetic:Buffer.alloc(32,89)}};
  const row={...encryptSession(scope,{account:ACCOUNT,cookies:[{name:'synthetic',value:secret,domain:'.yandex.ru',path:'/',secure:true,expires:-1}]},keyring,Date.now(),context),company_id:scope.companyId,location_id:scope.locationId,external_org_id:scope.organizationId,state:opt.state??'READY',revision:opt.revision??4};
  const calls=[],writes=[];let forbidden=0;
  const deny=()=>{forbidden++;throw Error(secret);};
  const store={read:async()=>structuredClone(row),transition:deny,replace:deny,snapshot:deny,claimAlert:deny};
  const writer=createReviewPersistenceWriter({rpc:async(name,args)=>{
   assert.equal(name,'review_persist_external_reviews');assert.equal(calls.length,4);assert.equal(args.p_company_id,scope.companyId);
   assert.equal(args.p_location_id,scope.locationId);assert.equal(args.p_provider,'yandex');assert.equal(args.p_external_location_id,scope.organizationId);
   writes.push(args);if(opt.dbFail)throw Object.assign(Error(secret),{code:'REVIEW_STORAGE_FAILED'});
   return {inserted:71,updated:0,unchanged:0,seen:71,persistence_enabled:true};
  }});
  const service=createYandexSessionService({store,keyring,context,allowRead:true,allowManualPersistence:true,persistenceWriter:writer,notify:deny,fetchImpl:async(url,options)=>{
   const n=Number(new URL(url).searchParams.get('page'));calls.push(n);assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');assert.equal(new URL(url).hostname,'yandex.ru');
   if(opt.networkFail&&n===2)throw Error(secret);
   if(opt.race&&n===2)row.revision++;
   const items=Array.from({length:n===4?11:20},(_,i)=>review((n-1)*20+i));
   if(opt.bad&&n===4)items[0].rating=6;
   const total=opt.incomplete?70:n===4?70:71;
   return new Response(JSON.stringify({list:{items,pager:{offset:(n-1)*20,limit:20,total}}}),{headers:{'content-type':'application/json'}});
  }});
  await fn({service,calls,writes,row});assert.equal(forbidden,0);
 }finally{for(const k of names)if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}
}
test('VPS09 accepted mutable full batch -> existing writer once; owner reply preserved; no downstream',()=>fixture(async f=>{
 const r=await f.service.persistManual(scope,{expectedRevision:4});assert.equal(r.ok,true);assert.equal(r.persistence_result.inserted,71);
 assert.equal(r.pagination_report.classification,'MUTABLE_TOTAL_COMPLETE');assert.equal(f.writes.length,1);assert.equal(f.writes[0].p_reviews.length,71);
 assert.equal(f.writes[0].p_reviews[0].owner_reply_text,secret);assert.equal(f.writes[0].p_reviews[0].owner_replied_at,'2020-01-01T00:00:00.000Z');
 assert.deepEqual(f.calls,[1,2,3,4]);assert.equal(f.row.revision,4);assert.doesNotMatch(JSON.stringify(r),new RegExp(secret));
}));
for(const opt of [{bad:true},{incomplete:true},{race:true},{networkFail:true},{state:'ERROR'},{revision:5}])test('VPS09 pre-persistence failure gives zero writer calls '+JSON.stringify(opt),()=>fixture(async f=>{
 const r=await f.service.persistManual(scope,{expectedRevision:4});assert.equal(r.ok,false);assert.equal(f.writes.length,0);assert.equal(r.review_persistence,'NOT_RUN');assert.doesNotMatch(JSON.stringify(r),new RegExp(secret));
},opt));
test('VPS09 DB uncertainty no retry and never successful batch',()=>fixture(async f=>{
 const r=await f.service.persistManual(scope,{expectedRevision:4});assert.equal(r.ok,false);assert.equal(r.error,'REVIEW_STORAGE_FAILED');assert.equal(f.writes.length,1);assert.equal(r.review_persistence,'ATTEMPTED');assert.doesNotMatch(JSON.stringify(r),new RegExp(secret));
},{dbFail:true}));
test('VPS09 wrong scope before provider/writer',()=>fixture(async f=>{
 const r=await f.service.persistManual({...scope,locationId:'11111111-1111-4111-8111-111111111111'},{expectedRevision:4});assert.equal(r.ok,false);assert.equal(f.calls.length,0);assert.equal(f.writes.length,0);
}));
test('VPS09 cannot use diagnostic options as a persistence bypass',()=>fixture(async f=>{
 const r=await f.service.contractDiagnosticFull(scope,{expectedRevision:4,paginationMode:'MUTABLE_OFFSET',persist:true});assert.equal(r.ok,false);assert.equal(f.writes.length,0);assert.equal(f.calls.length,0);
}));
