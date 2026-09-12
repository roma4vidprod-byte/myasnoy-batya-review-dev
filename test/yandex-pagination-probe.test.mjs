import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { probePagination } from '../lib/server/yandex-session/pagination-probe.js';
import { createYandexPageNumbering } from '../lib/providers/yandex.js';
import { createYandexSessionService } from '../lib/server/yandex-session/service.js';
import { encryptSession } from '../lib/server/yandex-session/crypto.js';

const item=JSON.parse(readFileSync(new URL('./fixtures/yandex/single-review.json',import.meta.url))).list.items[0];
const payload=(offset,total=8)=>({list:{pager:{limit:2,offset,total},items:Array.from({length:Math.min(2,total-offset)},(_,i)=>({...item,id:'private-id-'+(offset+i),cmnt_entity_id:'private-id-'+(offset+i)}))}});
const org='54309413522';
test('operator live aggregate evidence replays with synthetic review values',async()=>{
  const offsets=[0,0,20];
  const r=await probePagination(async page=>({list:{pager:{limit:20,offset:offsets[page],total:67},
    items:Array.from({length:20},(_,i)=>({...item,id:'synthetic-'+(offsets[page]+i),
      cmnt_entity_id:'synthetic-'+(offsets[page]+i),time_created:1900000000,public_rating:true}))}}),org);
  assert.equal(r.rule,'ONE_BASED_PAGE_ZERO_ALIAS');assert.equal(r.pageBase,1);
  assert.deepEqual(r.pages.map(p=>p.offset),offsets);
  assert.equal(createYandexPageNumbering(r.pageBase).pageAt(0),1);
  // Numeric timestamp is synthetic: live primitive type is confirmed, units are not.
});
for(const [offsets,rule,base] of [
  [[0,2],'ZERO_BASED',0],[[0,0,2],'ONE_BASED_PAGE_ZERO_ALIAS',1],
  [[0,0,4],'OTHER_CONTRACT',null],[[0,0,0,0],'OTHER_CONTRACT_ALL_FIRST_PAGE',null]
])test('bounded numbering: '+rule,async()=>{
  let calls=0;
  const r=await probePagination(async page=>{assert.equal(page,calls++);return payload(offsets[page]);},org);
  assert.equal(calls,offsets.length);assert.equal(r.rule,rule);assert.equal(r.pageBase,base);
  assert.equal(r.confirmed,base!==null);
  if(base!==null){const adapter=createYandexPageNumbering(base);assert.equal(adapter.pageAt(1),base+1);}
  assert.doesNotMatch(JSON.stringify(r),/private-id|author|full_text|csrf|cookie/i);
  if(offsets[1]===0)assert.equal(r.pages[0].firstIdHash,r.pages[1].firstIdHash);
});
test('hashes are invocation-local; malformed or changing contracts stop immediately',async()=>{
  const run=()=>probePagination(async p=>payload(p*2),org);
  assert.notEqual((await run()).pages[0].firstIdHash,(await run()).pages[0].firstIdHash);
  for(const broken of [{list:{}},payload(2,9)]){
    let calls=0;
    await assert.rejects(probePagination(async()=>++calls===1?payload(0):broken,org));
    assert.equal(calls,2);
  }
  const empty=await probePagination(async()=>payload(0,0),org);
  assert.equal(empty.confirmed,false);assert.equal(empty.pages.length,2);
});

const scope={companyId:'13f3cb80-487a-4a19-96a1-fb3103200230',locationId:'9a95f63b-18e6-447b-a449-8530b67ddbae',organizationId:org};
const keyring={currentKid:'fixture',keys:{fixture:Buffer.alloc(32,7)}};
function setup(failAt){
  let calls=0,transitions=[],alerts=0;
  const row={...encryptSession(scope,{account:'myasnoibatya-zakaz',cookies:[{name:'fixture',value:'SYNTHETIC_PRIVATE',domain:'.yandex.ru',path:'/',secure:true,httpOnly:true,expires:-1}]},keyring),
    company_id:scope.companyId,location_id:scope.locationId,external_org_id:org,revision:2,state:'ERROR'};
  const service=createYandexSessionService({keyring,allowRead:true,
    store:{read:async()=>row,transition:async(s,r,t)=>{assert.equal(r,2);transitions.push(t);return {...row,state:t.state,revision:3};},claimAlert:async()=>({claimed:true,incident_id:'fixture'})},
    notify:async()=>{alerts++;return 'MOCKED_NO_DELIVERY';},
    fetchImpl:async(url,options)=>{
      assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');
      assert.equal(url,`https://yandex.ru/sprav/api/${org}/reviews?ranking=by_time&source=pagination&page=${calls}`);
      calls++;
      if(calls===2 && failAt){
        if(failAt==='401'||failAt==='403')return new Response('',{status:Number(failAt)});
        if(failAt==='login')return new Response('<html>login</html>');
        if(failAt==='captcha')return new Response('{"captcha":true}',{headers:{'content-type':'application/json'}});
        return new Response('{"list":{}}',{headers:{'content-type':'application/json'}});
      }
      return new Response(JSON.stringify(payload(calls===3?2:0)),{headers:{'content-type':'application/json'}});
    }});
  return {service,result:()=>({calls,transitions,alerts})};
}
test('service limited probe: alias confirmation READY, no snapshot/full fetch, safe evidence',async()=>{
  const f=setup();const r=await f.service.run(scope,{mode:'pagination_probe'});
  assert.equal(r.ok,true);assert.equal(r.state,'READY');assert.equal(r.reviewPersistence,'OFF');
  assert.equal(r.paginationProbe.pageBase,1);assert.equal(f.result().calls,3);
  assert.equal(r.pageBaseStatus,'PAGE BASE CONFIRMED BY LIMITED PROBE');
  assert.equal(f.result().transitions[0].sync_ok,false);assert.equal(f.result().alerts,0);
  assert.equal(r.evidence.idConsistency.equal,6);
  assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC_PRIVATE|private-id|full_text|business_answer_csrf_token/);
});
for(const failure of ['401','403','login','captcha','drift'])test('service stops on '+failure,async()=>{
  const f=setup(failure);const r=await f.service.run(scope,{mode:'pagination_probe'});
  assert.equal(r.ok,false);assert.equal(f.result().calls,2);
  assert.equal(r.state,failure==='drift'?'ERROR':'REAUTH_REQUIRED');
  assert.equal(r.paginationProbe,undefined);assert.equal(r.alert,'MOCKED_NO_DELIVERY');
});
test('operator entrypoint has fixed scope/mode, mocked delivery and no plaintext persistence',()=>{
  const source=readFileSync(new URL('../scripts/yandex-pagination-probe-02.mjs',import.meta.url),'utf8');
  assert.match(source,/mode: 'pagination_probe'/);assert.match(source,/MOCKED_NO_DELIVERY/);
  assert.doesNotMatch(source,/writeFile|appendFile|console\.error|dry_run|importSession|process\.env\s*\[/);
});
