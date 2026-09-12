import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createYandexSessionService } from '../lib/server/yandex-session/service.js';
import { encryptSession } from '../lib/server/yandex-session/crypto.js';
const scope={companyId:'13f3cb80-487a-4a19-96a1-fb3103200230',locationId:'9a95f63b-18e6-447b-a449-8530b67ddbae',organizationId:'54309413522'};
const keyring={currentKid:'fixture',keys:{fixture:Buffer.alloc(32,7)}};
const now=new Date('2026-09-13T00:00:00Z');
const item=JSON.parse(readFileSync(new URL('./fixtures/yandex/single-review.json',import.meta.url))).list.items[0];
function setup({failure,unit='seconds',duplicate=false,total=67,existing=false}={}){
  const calls=[],transitions=[];let snapshots=0,alerts=0;
  const row={...encryptSession(scope,{account:'myasnoibatya-zakaz',cookies:[{name:'fixture',value:'PRIVATE_SYNTHETIC_COOKIE',domain:'.yandex.ru',path:'/',secure:true,expires:-1}]},keyring),
    company_id:scope.companyId,location_id:scope.locationId,external_org_id:scope.organizationId,state:'READY',revision:3};
  const service=createYandexSessionService({keyring,allowRead:true,now:()=>now,
    notify:async()=>{alerts++;return 'MOCKED_NO_DELIVERY';},
    store:{read:async()=>row,snapshot:async(s,ids)=>{
      snapshots++;assert.deepEqual(s,scope);
      if(failure==='scope')return [{company_id:'bad',location_id:scope.locationId,provider:'yandex',external_location_id:scope.organizationId,external_review_id:ids[0]}];
      return existing||failure==='collision'?[{company_id:failure==='collision'?'11111111-1111-4111-8111-111111111111':scope.companyId,
        location_id:scope.locationId,provider:'yandex',external_location_id:scope.organizationId,external_review_id:ids[0]}]:[];
    },transition:async(s,r,t)=>{assert.equal(r,3);transitions.push(t);return {...row,state:t.state,revision:4,last_error_code:t.error_code,last_successful_sync_at:t.sync_ok?now.toISOString():null};},
    claimAlert:async()=>({claimed:true,incident_id:'fixture'})},
    fetchImpl:async(url,options)=>{
      assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');
      const page=calls.length+1;
      assert.equal(url,`https://yandex.ru/sprav/api/54309413522/reviews?ranking=by_time&source=pagination&page=${page}`);
      calls.push(page);
      if(page===2){
        if(['401','403'].includes(failure))return new Response('',{status:Number(failure)});
        if(failure==='login')return new Response('<html>login</html>');
        if(failure==='captcha')return new Response('{"challenge":true}',{headers:{'content-type':'application/json'}});
        if(failure==='malformed')return new Response('{',{headers:{'content-type':'application/json'}});
      }
      const offset=(page-1)*20;
      const items=Array.from({length:Math.min(20,total-offset)},(_,i)=>{
        const index=offset+i,id=duplicate&&index===20?0:index;
        return {...item,id:'private-review-'+id,cmnt_entity_id:'private-review-'+id,
          author:index%2?{user:'PRIVATE_AUTHOR'}:null,full_text:index%2?'PRIVATE_REVIEW_TEXT':null,
          rating:index%5+1,time_created:(1750000000+id)*(unit==='milliseconds'?1000:1),public_rating:true,
          owner_comment:index%3?null:{text:'PRIVATE_REPLY',time_created:1750001000,moderation_status:'approved'}};
      });
      if(page===2&&failure==='short')items.pop();
      if(page===2&&failure==='type')items[0].public_rating=5;
      if(page===2&&failure==='time')items[0].time_created=1;
      const data={business_answer_csrf_token:'PRIVATE_CSRF',list:{items,pager:{limit:20,offset:failure==='pagination'&&page===2?0:offset,total}}};
      return new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
    }});
  return {run:()=>service.run(scope,{mode:'dry_run',pageBase:1,safeReport:true}),stats:()=>({calls,snapshots,transitions,alerts})};
}
for(const unit of ['seconds','milliseconds'])test('67 records, 4 GETs, '+unit+' safe report with existing plan',async()=>{
  const f=setup({unit});const r=await f.run();
  assert.equal(r.ok,true);assert.equal(r.state,'READY');assert.equal(r.reviewPersistence,'OFF');
  const d=r.dryRunReport;
  assert.deepEqual(f.stats().calls,[1,2,3,4]);assert.equal(f.stats().snapshots,1);assert.equal(f.stats().alerts,0);
  assert.equal(d.receivedReviews,67);assert.equal(d.uniqueReviews,67);assert.equal(d.duplicates,0);
  assert.equal(d.ownerReplyCount,23);assert.equal(d.reviewText.null,34);assert.equal(d.author.nonNull,33);
  assert.deepEqual(d.ratingDistribution,{'1':14,'2':14,'3':13,'4':13,'5':13});
  assert.equal(d.timeCreated.unit,unit==='seconds'?'UNIX_SECONDS':'UNIX_MILLISECONDS');
  assert.equal(d.persistencePlan.plannedInserts,67);assert.equal(d.persistencePlan.unchanged,0);
  assert.equal(d.sample.length,3);assert.equal(r.evidence.idConsistency.equal,67);
  assert.equal(f.stats().transitions[0].sync_ok,true);
  assert.equal(r.lastSuccessfulSyncAt,now.toISOString());
  assert.doesNotMatch(JSON.stringify(r),/PRIVATE_|private-review|raw_payload|rawPayload|full_text|cookie|csrf/i);
});
test('duplicate count and unique statistics; existing identity means update candidate, not proven change',async()=>{
  const f=setup({duplicate:true,existing:true});const r=await f.run();
  assert.equal(r.ok,true);assert.equal(r.dryRunReport.duplicates,1);assert.equal(r.dryRunReport.uniqueReviews,66);
  assert.equal(r.dryRunReport.persistencePlan.plannedInserts,65);
  assert.equal(r.dryRunReport.persistencePlan.plannedUpdates,1);assert.equal(r.dryRunReport.persistencePlan.unchanged,null);
});
for(const failure of ['401','403','login','captcha','malformed','short','pagination','type','time','collision','scope'])test('full report fail closed: '+failure,async()=>{
  const f=setup({failure});const r=await f.run();
  assert.equal(r.ok,false);assert.equal(r.dryRunReport,undefined);assert.equal(r.evidence,undefined);
  assert.equal(r.reviewPersistence,'OFF');assert.equal(r.alert,'MOCKED_NO_DELIVERY');
  assert.equal(f.stats().transitions[0].sync_ok,false);
  assert.equal(f.stats().calls.length,['collision','scope'].includes(failure)?4:2);
  assert.equal(f.stats().snapshots,['collision','scope'].includes(failure)?1:0);
  if(failure==='collision')assert.equal(r.errorCode,'REVIEW_SCOPE_COLLISION');
  if(failure==='collision')assert.equal(r.dryRunFailure.collision,'DETECTED');
  if(failure==='scope')assert.equal(r.dryRunFailure.scopeFailure,'DETECTED');
});
test('empty response yields no timestamp evidence and no fabricated sample',async()=>{
  const r=await setup({total:0}).run();assert.equal(r.ok,true);
  assert.equal(r.dryRunReport.timeCreated.unit,'NO_EVIDENCE');assert.deepEqual(r.dryRunReport.sample,[]);
});
test('operator entrypoint fixed scope, page 1, mocked alerts, no file or writer API',()=>{
  const source=readFileSync(new URL('../scripts/yandex-full-dry-run-03.mjs',import.meta.url),'utf8');
  assert.match(source,/pageBase:1/);assert.match(source,/MOCKED_NO_DELIVERY/);
  assert.doesNotMatch(source,/writeFile|appendFile|importSession|console\.error|process\.env\[/);
});
