import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchYandexReviews,parseYandexReviewsPayload,diagnoseYandexReviewsPayload} from '../lib/providers/yandex.js';
import {encryptSession,ACCOUNT} from '../lib/server/yandex-session/crypto.js';
import {createVpsSessionContext,VPS_SESSION_SCOPE as scope} from '../lib/server/yandex-session/profile-context.js';
import {createYandexSessionService} from '../lib/server/yandex-session/service.js';
import {runVpsDiagnostic} from '../lib/server/yandex-session/vps-diagnostic.js';
const PRIVATE='SYNTHETIC_PRIVATE_VPS08D';
const mode='MUTABLE_OFFSET';
const item=i=>({id:PRIVATE+i,cmnt_entity_id:PRIVATE+i,author:{user:PRIVATE},full_text:PRIVATE,rating:5,time_created:1577836800000,owner_comment:null});
const page=(offset,count,total)=>({list:{items:Array.from({length:count},(_,i)=>item(offset+i)),pager:{offset,limit:20,total}}});
const observed=()=>[page(0,20,71),page(20,20,71),page(40,20,71),page(60,11,70)];
async function read(pages,opt={}){
  const calls=[];let report=null,result,error;
  try{result=await fetchYandexReviews({permanentId:scope.organizationId,maxPages:10,pageBase:1,paginationMode:mode,
    onPaginationReport:r=>{report=r;},transport:async req=>{assert.equal(req.method,'GET');assert.equal(new URL(req.url).hostname,'yandex.ru');calls.push(req.page);assert.ok(pages[req.page-1],'NO_HIDDEN_REQUEST');return pages[req.page-1];},...opt});}
  catch(e){error=e;}
  assert.doesNotMatch(JSON.stringify(report),new RegExp(PRIVATE));
  return {calls,report,result,error};
}
test('D regression: 71/71/71/70 totals, terminal eleven valid new reviews',async()=>{
  const r=await read(observed());assert.ifError(r.error);assert.equal(r.result.length,71);
  assert.deepEqual(r.calls,[1,2,3,4]);assert.equal(r.report.classification,'MUTABLE_TOTAL_COMPLETE');
  for(const [k,v] of Object.entries({raw_received:71,unique_received:71,duplicates:0,first_total:71,last_total:70,min_total:70,max_total:71,terminal_page_length:11,total_change_count:1,provider_total_stable:false,pagination_mode:mode}))assert.equal(r.report[k],v,k);
  assert.deepEqual(r.report.total_values_observed,[71,71,71,70]);
});
for(const [name,pages,count] of [['stable',[page(0,20,30),page(20,10,30)],30],['exact multiple requires empty terminal',[page(0,20,20),page(20,0,20)],20],['empty',[page(0,0,0)],0]])test('D '+name,async()=>{
  const r=await read(pages);assert.ifError(r.error);assert.equal(r.result.length,count);assert.equal(r.report.classification,'STRICT_STABLE_COMPLETE');assert.equal(r.calls.length,pages.length);
});
test('D short terminal never requests a hidden extra page',async()=>{
  const r=await read([page(0,1,1),page(20,1,2)]);assert.ifError(r.error);assert.deepEqual(r.calls,[1]);
});
test('D valid cross-page duplicate counted, never duplicated logically',async()=>{
  const pages=[page(0,20,20),page(20,1,20)];pages[1].list.items[0]=structuredClone(pages[0].list.items[19]);
  const r=await read(pages);assert.ifError(r.error);assert.equal(r.result.length,20);assert.equal(r.report.raw_received,21);assert.equal(r.report.duplicates,1);assert.equal(r.report.pages[1].boundary_duplicates,1);assert.equal(r.report.pages[1].new_unique,0);
});
for(const [name,pages] of [['stable total70 but75 unique',[page(0,20,70),page(20,20,70),page(40,20,70),page(60,15,70)]],['short partial',[page(0,10,70)]],['duplicates cannot excuse missing reviews',[page(0,20,21),{list:{items:[item(19)],pager:{offset:20,limit:20,total:21}}}]]])test('D incomplete '+name,async()=>{
  const r=await read(pages);assert.equal(r.error?.code,'YANDEX_PAGINATION_CHANGED');assert.equal(r.report.classification,'INCONSISTENT_INCOMPLETE');assert.equal(r.result,undefined);
});
test('D ten full pages fail hard cap even when last offset reaches total',async()=>{
  const r=await read(Array.from({length:10},(_,i)=>page(i*20,20,200)));
  assert.equal(r.error?.code,'YANDEX_PAGINATION_LIMIT_EXCEEDED');assert.equal(r.calls.length,10);assert.equal(r.report.classification,'NO_TERMINAL_PAGE');assert.equal(r.report.terminal_page_length,null);
});
for(const kind of ['overlimit','total_string','total_negative','offset','limit','within_duplicate','identity','rating','timestamp','owner_reply','unknown_object'])test('D strict page/item rejects '+kind,async()=>{
  const p=page(0,20,20);
  if(kind==='overlimit')p.list.items.push(item(20));
  if(kind==='total_string')p.list.pager.total='20';
  if(kind==='total_negative')p.list.pager.total=-1;
  if(kind==='offset')p.list.pager.offset=1;
  if(kind==='limit')p.list.pager.limit=21;
  if(kind==='within_duplicate')p.list.items[19]=structuredClone(p.list.items[0]);
  if(kind==='identity'){delete p.list.items[0].id;delete p.list.items[0].cmnt_entity_id;}
  if(kind==='rating')p.list.items[0].rating=6;
  if(kind==='timestamp')p.list.items[0].time_created={};
  if(kind==='owner_reply')p.list.items[0].owner_comment={text:PRIVATE};
  if(kind==='unknown_object')p.list.items[0]={type:PRIVATE};
  const r=await read([p]);assert.equal(r.error?.code,'YANDEX_CONTRACT_DRIFT');assert.deepEqual(r.calls,[1]);assert.equal(r.result,undefined);
  const d=diagnoseYandexReviewsPayload(p,scope.organizationId,{paginationMode:mode,expectedOffset:0,expectedLimit:20});assert.equal(d.ok,false);assert.doesNotMatch(JSON.stringify(d),new RegExp(PRIVATE));
});
test('D legacy default stays strict; mutable requires explicit requested pager',()=>{
  assert.throws(()=>parseYandexReviewsPayload(observed()[3]),{code:'YANDEX_CONTRACT_DRIFT'});
  assert.throws(()=>parseYandexReviewsPayload(observed()[3],null,{paginationMode:mode}));
});
test('D cap above10 and unknown mode rejected before transport',async()=>{
  for(const options of [{maxPages:11},{paginationMode:'anything'}]){const r=await read([],{...options});assert.ok(r.error);assert.deepEqual(r.calls,[]);}
});

async function fixture(fn,opt={}){
  const names=['RA_RUNTIME_PROFILE','RA_YANDEX_MODE','VERCEL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SECRET_KEY','SUPABASE_ANON_KEY','YANDEX_SESSION_KEYS_JSON','YANDEX_SESSION_ACTIVE_KID','REVIEW_WORKER_SECRET'];
  const saved=Object.fromEntries(names.map(k=>[k,process.env[k]]));for(const k of names)delete process.env[k];
  process.env.RA_RUNTIME_PROFILE='vps-lab';process.env.RA_YANDEX_MODE='read-only-admin';
  try{
    const context=createVpsSessionContext(),keyring={currentKid:'synthetic',keys:{synthetic:Buffer.alloc(32,85)}};
    let row={...encryptSession(scope,{account:ACCOUNT,cookies:[{name:'synthetic',value:PRIVATE,domain:'.yandex.ru',path:'/',secure:true,expires:-1}]},keyring,Date.now(),context),company_id:scope.companyId,location_id:scope.locationId,external_org_id:scope.organizationId,state:opt.state??'ERROR',revision:opt.revision??3};
    const original=structuredClone(row),calls=[],cas=[];let forbidden=0;
    const deny=()=>{forbidden++;throw Error(PRIVATE);};
    const store={read:async()=>structuredClone(row),replace:deny,snapshot:deny,claimAlert:deny,transition:async(s,r,data)=>{
      cas.push(data);assert.deepEqual(s,scope);assert.equal(r,3);assert.deepEqual(data,{state:'READY',auth_ok:true,sync_ok:false,error_code:null});
      if(opt.casFailure)throw Error(PRIVATE);
      row={...row,state:data.state,revision:4};return structuredClone(row);
    }};
    const pages=opt.pages??observed();
    const service=createYandexSessionService({context,keyring,store,allowRead:true,notify:deny,fetchImpl:async(url,options)=>{
      const n=Number(new URL(url).searchParams.get('page'));calls.push(n);assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');assert.equal(new URL(url).hostname,'yandex.ru');
      if(opt.throwAt===n)throw Error(PRIVATE);
      if(opt.redirectAt===n)return new Response('',{status:302});
      if(opt.raceAt===n)row.revision++;
      assert.ok(pages[n-1],'NO_EXTRA_PAGE');return new Response(JSON.stringify(pages[n-1]),{headers:{'content-type':'application/json'}});
    }});
    await fn({service,store,calls,cas,original,get row(){return row;},run:()=>runVpsDiagnostic({service,store,scope,row:structuredClone(row),operation:'mutable-full'})});
    assert.equal(forbidden,0);assert.deepEqual(row.envelope,original.envelope);assert.equal(row.credential_version,original.credential_version);
  }finally{for(const k of names)if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];}
}
test('D real service + adapter: accepted complete read then one health CAS, no other writes',()=>fixture(async f=>{
  const r=await f.run();assert.equal(r.ok,true);assert.deepEqual(f.calls,[1,2,3,4]);assert.equal(r.state,'READY');assert.equal(r.revision,4);assert.equal(r.stateCas,'SUCCESS');assert.equal(f.cas.length,1);assert.equal(r.pagination_report.classification,'MUTABLE_TOTAL_COMPLETE');assert.equal(r.scope_valid,true);assert.equal(r.contract_valid,true);assert.doesNotMatch(JSON.stringify(r),new RegExp(PRIVATE));
}));
for(const [name,opt,calls] of [['transport',{throwAt:2},[1,2]],['redirect',{redirectAt:1},[1]],['race',{raceAt:2},[1,2]],['incomplete',{pages:[page(0,1,70)]},[1]],['malformed',{pages:[{list:{items:[{rating:6}],pager:{limit:20,offset:0,total:1}}}]},[1]]])test('D failure '+name+' no CAS/retry/persistence',()=>fixture(async f=>{
  const r=await f.run();assert.equal(r.ok,false);assert.deepEqual(f.calls,calls);assert.equal(f.cas.length,0);assert.equal(f.row.state,'ERROR');assert.doesNotMatch(JSON.stringify(r),new RegExp(PRIVATE));
},opt));
test('D uncertain CAS not retried or reported READY',()=>fixture(async f=>{
  const r=await f.run();assert.equal(r.ok,false);assert.equal(f.cas.length,1);assert.equal(r.state,null);assert.equal(r.revision,null);assert.equal(r.stateCas,'NOT_CONFIRMED');assert.deepEqual(f.calls,[1,2,3,4]);
},{casFailure:true}));
for(const opt of [{state:'READY'},{revision:4}])test('D pinned ERROR/3 guard '+JSON.stringify(opt),()=>fixture(async f=>{
  await assert.rejects(f.run());assert.deepEqual(f.calls,[]);assert.equal(f.cas.length,0);
},opt));
test('D service diagnostic alone never transitions; legacy ERROR guard remains',()=>fixture(async f=>{
  const legacy=await f.service.contractDiagnosticFull(scope,{expectedRevision:3});assert.equal(legacy.ok,false);assert.equal(legacy.error,'SESSION_NOT_READY');assert.deepEqual(f.calls,[]);
  const r=await f.service.contractDiagnosticFull(scope,{expectedRevision:3,paginationMode:mode});assert.equal(r.ok,true);assert.equal(f.cas.length,0);assert.equal(f.row.state,'ERROR');
}));
