import test from 'node:test';
import assert from 'node:assert/strict';
import {compareYandexBoundary} from '../lib/server/yandex-session/pagination-structure.js';
import {parseYandexReviewsPayload} from '../lib/providers/yandex.js';
import {encryptSession,ACCOUNT} from '../lib/server/yandex-session/crypto.js';
import {createVpsSessionContext,VPS_SESSION_SCOPE as scope} from '../lib/server/yandex-session/profile-context.js';
import {createYandexSessionService} from '../lib/server/yandex-session/service.js';
const PRIVATE='SYNTHETIC_PRIVATE_VPS08C';
const item=i=>({id:PRIVATE+i,cmnt_entity_id:PRIVATE+i,author:{user:PRIVATE},rating:5,full_text:PRIVATE,time_created:1577836800000,owner_comment:null,public_rating:true});
const pair=()=>[{list:{items:Array.from({length:20},(_,i)=>item(40+i)),pager:{limit:20,offset:40,total:70}}},{list:{items:Array.from({length:11},(_,i)=>item(60+i)),pager:{limit:20,offset:60,total:70}}}];
test('C: same total, 11 individually valid new IDs, zero boundary overlap; strict parser still rejects',()=>{
  const [a,b]=pair(),r=compareYandexBoundary(a,b,scope.organizationId);
  assert.equal(r.classification,'C_TOTAL_IS_STALE_OR_INCONSISTENT');assert.equal(r.page3.unique_count,20);assert.equal(r.page4.unique_count,11);
  assert.equal(r.page4.valid_review_count,11);assert.equal(r.page4.invalid_review_count,0);
  assert.equal(r.boundary.boundary_overlap_count,0);assert.equal(r.boundary.combined_unique_count,31);
  assert.equal(r.boundary.overlap_with_pages_1_2,'UNKNOWN_NOT_READ');
  assert.equal(r.page4.structural_classes.length,1);assert.equal(r.page4.shape_seen_on_page3_count,11);
  assert.throws(()=>parseYandexReviewsPayload(b),{code:'YANDEX_CONTRACT_DRIFT'});assert.doesNotMatch(JSON.stringify(r),new RegExp(PRIVATE));
});
test('A: extra known boundary identity, exact remainder; diagnostic does not accept page for persistence',()=>{
  const [a,b]=pair();b.list.items[10]=structuredClone(a.list.items[19]);
  const r=compareYandexBoundary(a,b,scope.organizationId);assert.equal(r.classification,'A_BOUNDARY_DUPLICATE');assert.equal(r.boundary.boundary_overlap_count,1);assert.equal(r.boundary.combined_unique_count,30);assert.equal(r.boundary.page4_new_unique_vs_page3,10);assert.throws(()=>parseYandexReviewsPayload(b));
});
test('E: normal terminal ten, no hidden verification request',()=>{
  const [a,b]=pair();b.list.items.pop();const r=compareYandexBoundary(a,b,scope.organizationId);assert.equal(r.classification,'E_TRANSIENT_PROVIDER_RESPONSE');assert.equal(r.page4.parser,'PASS');
});
test('current valid total can differ: no historical 69/70 assertion',()=>{
  const [a,b]=pair();a.list.pager.total=71;b.list.pager.total=71;assert.equal(compareYandexBoundary(a,b,scope.organizationId).classification,'E_TRANSIENT_PROVIDER_RESPONSE');
});
for(const kind of ['within_duplicate','missing_identity','missing_author_user','different_totals','malformed_review','unknown_type'])test('ambiguous/malformed '+kind+' stays UNKNOWN, never silently drops an item',()=>{
  const [a,b]=pair();
  if(kind==='within_duplicate')b.list.items[10]=structuredClone(b.list.items[0]);
  if(kind==='missing_identity'){delete b.list.items[10].id;delete b.list.items[10].cmnt_entity_id;}
  if(kind==='missing_author_user')b.list.items[10].author={};
  if(kind==='different_totals')b.list.pager.total=71;
  if(kind==='malformed_review')b.list.items[10].rating={};
  if(kind==='unknown_type'){for(const x of a.list.items)x.type='review';for(const x of b.list.items)x.type='review';b.list.items[10]={type:PRIVATE};}
  const r=compareYandexBoundary(a,b,scope.organizationId);assert.equal(r.classification,'G_UNKNOWN');assert.doesNotMatch(JSON.stringify(r),new RegExp(PRIVATE));
  if(kind==='unknown_type'){assert.equal(r.page4.explicit_different_discriminator_count,1);assert.equal(r.page4.missing_required_fields_count,1);}
});
test('structural classes detect optional/null difference, unknown names/values remain private',()=>{
  const [a,b]=pair();b.list.items[10].owner_comment={text:PRIVATE,time_created:1577836800000,moderation_status:PRIVATE};
  b.list.items[10][PRIVATE]={[PRIVATE]:PRIVATE};a[PRIVATE]=PRIVATE;b[PRIVATE]=42;
  const r=compareYandexBoundary(a,b,scope.organizationId);assert.equal(r.page4.structural_classes.length,2);assert.equal(r.page4.alternate_shape_count,1);assert.equal(r.structure.top_level_signature_match,false);assert.doesNotMatch(JSON.stringify(r),new RegExp(PRIVATE));
});
for(const delta of [{limit:0},{offset:59},{total:'70'},{total:null}])test('malformed/unproven pager semantics denied '+JSON.stringify(delta),()=>{
  const [a,b]=pair();Object.assign(b.list.pager,delta);assert.throws(()=>compareYandexBoundary(a,b,scope.organizationId),{code:'YANDEX_PAGINATION_CHANGED'});
});
test('canonical fallback cmnt_entity_id uses same dedupe identity contract',()=>{
  const [a,b]=pair();b.list.items[10]=structuredClone(a.list.items[19]);delete b.list.items[10].id;
  assert.equal(compareYandexBoundary(a,b,scope.organizationId).boundary.boundary_overlap_count,1);
});
test('new discriminator absent from baseline does not prove ordinary review semantics',()=>{
  const [a,b]=pair();b.list.items[10].type=PRIVATE;
  const r=compareYandexBoundary(a,b,scope.organizationId);assert.equal(r.classification,'G_UNKNOWN');assert.equal(r.page4.uncomparable_discriminator_count,1);assert.doesNotMatch(JSON.stringify(r),new RegExp(PRIVATE));
});
async function liveFixture(fn,opt={}){
  const names=['RA_RUNTIME_PROFILE','RA_YANDEX_MODE','VERCEL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SECRET_KEY','SUPABASE_ANON_KEY','YANDEX_SESSION_KEYS_JSON','YANDEX_SESSION_ACTIVE_KID','REVIEW_WORKER_SECRET'];
  const old=Object.fromEntries(names.map(k=>[k,process.env[k]]));for(const k of names)delete process.env[k];
  process.env.RA_RUNTIME_PROFILE='vps-lab';process.env.RA_YANDEX_MODE='read-only-admin';
  try{
    const context=createVpsSessionContext(),keyring={currentKid:'synthetic',keys:{synthetic:Buffer.alloc(32,84)}};
    const row={...encryptSession(scope,{account:ACCOUNT,cookies:[{name:'synthetic',value:PRIVATE,domain:'.yandex.ru',path:'/',secure:true,expires:opt.expired?1:-1}]},keyring, opt.expired?0:Date.now(),context),company_id:scope.companyId,location_id:scope.locationId,external_org_id:scope.organizationId,state:opt.state??'ERROR',revision:opt.revision??3};
    const before=JSON.stringify(row),calls=[],effects=[];
    const forbid=()=>{effects.push('FORBIDDEN');throw Error(PRIVATE);};
    const store={read:async()=>opt.missing?null:structuredClone(row),transition:forbid,replace:forbid,snapshot:forbid,claimAlert:forbid};
    const service=createYandexSessionService({context,keyring,store,allowRead:opt.approval??true,notify:forbid,fetchImpl:async(url,options)=>{
      const page=Number(new URL(url).searchParams.get('page'));calls.push(page);
      assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');assert.equal(new URL(url).hostname,'yandex.ru');
      if(opt.throwAt===page)throw Error(PRIVATE);
      if(opt.redirectAt===page)return new Response('',{status:302});
      if(opt.challengeAt===page)return new Response('<html>captcha</html>');
      if(opt.raceAt===page)row.revision++;
      const data=pair()[page-3];if(opt.badFirst&&page===3)data.list.items.pop();
      return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
    }});
    await fn({service,calls,row,before});assert.deepEqual(effects,[]);
    if(!opt.raceAt)assert.equal(JSON.stringify(row),before);
  }finally{for(const k of names)if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}
}
test('real service composition: exactly 3 then4, no CAS/persistence/notification, counts only',()=>liveFixture(async({service,calls})=>{
  const r=await service.boundaryDiagnostic(scope,{expectedRevision:3});assert.equal(r.ok,true);assert.deepEqual(calls,[3,4]);assert.equal(r.transport_attempted,2);assert.equal(r.transport_completed,2);assert.equal(r.diagnostic.classification,'C_TOTAL_IS_STALE_OR_INCONSISTENT');assert.equal(r.state,'ERROR');assert.equal(r.revision,3);assert.equal(r.session_mutations,'OFF');assert.doesNotMatch(JSON.stringify(r),new RegExp(PRIVATE));
}));
for(const opt of [{state:'READY'},{revision:4},{missing:true},{approval:false}])test('pretransport deny '+JSON.stringify(opt),()=>liveFixture(async({service,calls})=>{await assert.rejects(service.boundaryDiagnostic(scope,{expectedRevision:3}));assert.deepEqual(calls,[]);},opt));
for(const [opt,expected]of [[{throwAt:3},[3]],[{throwAt:4},[3,4]],[{redirectAt:3},[3]],[{challengeAt:4},[3,4]],[{raceAt:3},[3]],[{badFirst:true},[3]],[{expired:true},[]]])test('no retry or second page after fail '+JSON.stringify(opt),()=>liveFixture(async({service,calls})=>{const r=await service.boundaryDiagnostic(scope,{expectedRevision:3});assert.equal(r.ok,false);assert.deepEqual(calls,expected);assert.doesNotMatch(JSON.stringify(r),new RegExp(PRIVATE));},opt));
test('wrong revision argument rejected before read',()=>liveFixture(async({service,calls})=>{await assert.rejects(service.boundaryDiagnostic(scope,{expectedRevision:4}),{code:'SESSION_MODE_INVALID'});assert.deepEqual(calls,[]);}));
test('wrong scope rejected before provider',()=>liveFixture(async({service,calls})=>{await assert.rejects(service.boundaryDiagnostic({...scope,organizationId:'123'},{expectedRevision:3}));assert.deepEqual(calls,[]);}));
