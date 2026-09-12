import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createYandexSessionService } from '../lib/server/yandex-session/service.js';
import { encryptSession } from '../lib/server/yandex-session/crypto.js';

const scope={organizationId:'54309413522',companyId:'13f3cb80-487a-4a19-96a1-fb3103200230',locationId:'9a95f63b-18e6-447b-a449-8530b67ddbae'};
const ring={currentKid:'fixture',keys:{fixture:Buffer.alloc(32,7)}};
const source=JSON.parse(readFileSync(new URL('./fixtures/yandex/single-review.json',import.meta.url))).list.items[0];
function setup(existing=0){
  const row={...encryptSession(scope,{account:'myasnoibatya-zakaz',cookies:[{name:'fixture',value:'PRIVATE_SYNTHETIC_COOKIE',domain:'.yandex.ru',path:'/',secure:true,expires:-1}]},ring),company_id:scope.companyId,location_id:scope.locationId,external_org_id:scope.organizationId,state:'READY',revision:4};
  const calls=[];let writerCalls=0,transition;
  const store={read:async()=>row,snapshot:async()=>Array.from({length:existing},(_,i)=>({company_id:scope.companyId,location_id:scope.locationId,provider:'yandex',external_review_id:`review-${i}`,external_location_id:scope.organizationId})),transition:async(s,r,p)=>{transition=p;return {...row,state:p.state,revision:5,last_error_code:p.error_code,last_successful_sync_at:p.sync_ok?'2026-09-13T00:00:00.000Z':null};},claimAlert:async()=>({claimed:false})};
  const item=i=>({...source,id:`review-${i}`,cmnt_entity_id:`review-${i}`,time_created:1735495043063+i,owner_comment:null});
  const service=createYandexSessionService({store,keyring:ring,allowRead:true,notify:async()=> 'MOCKED_NO_DELIVERY',fetchImpl:async(url,options)=>{assert.equal(options.method,'GET');calls.push(Number(new URL(url).searchParams.get('page')));return new Response(JSON.stringify({list:{items:[item(0),item(1)],pager:{limit:2,offset:0,total:2}}}),{headers:{'content-type':'application/json'}});},persistenceWriter:{persistNormalizedReviews:async(input)=>{writerCalls+=1;assert.equal(input.companyId,scope.companyId);assert.equal(input.locationId,scope.locationId);assert.equal(input.externalLocationId,scope.organizationId);assert.equal(input.reviews.length,2);return existing?{inserted:0,updated:0,unchanged:2,seen:2,persistence_enabled:true}:{inserted:2,updated:0,unchanged:0,seen:2,persistence_enabled:true};}}});
  return {service,stats:()=>({calls,writerCalls,transition})};
}
test('explicit persist mode fetches, normalizes and calls only the injected atomic writer',async()=>{const f=setup();const r=await f.service.run(scope,{mode:'persist',pageBase:1,maxPages:4,persistenceExpected:'empty'});assert.equal(r.ok,true);assert.equal(r.reviewPersistence,'ON');assert.deepEqual(f.stats().calls,[1]);assert.equal(f.stats().writerCalls,1);assert.deepEqual(r.persistenceResult,{inserted:2,updated:0,unchanged:0,seen:2,persistence_enabled:true,preexistingSameScope:0});assert.equal(f.stats().transition.sync_ok,true);});
test('explicit replay mode requires the existing same scope and reports unchanged',async()=>{const f=setup(2);const r=await f.service.run(scope,{mode:'persist',pageBase:1,persistenceExpected:'same'});assert.equal(r.ok,true);assert.deepEqual(r.persistenceResult,{inserted:0,updated:0,unchanged:2,seen:2,persistence_enabled:true,preexistingSameScope:2});assert.equal(f.stats().writerCalls,1);});
test('first-run preflight mismatch fails before writer call',async()=>{const f=setup(1);const r=await f.service.run(scope,{mode:'persist',pageBase:1,persistenceExpected:'empty'});assert.equal(r.ok,false);assert.equal(f.stats().writerCalls,0);assert.equal(r.reviewPersistence,'OFF');});
