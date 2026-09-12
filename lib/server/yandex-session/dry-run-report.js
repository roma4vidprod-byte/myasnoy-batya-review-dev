import { randomBytes, createHmac } from 'node:crypto';
import { fail } from './crypto.js';

// Scalar observation only; existing provider still owns parsing/deduplication.
export function createDryRunReport(now) {
  const pages=[];
  const lower=Date.UTC(2000,0,1), upper=now.getTime()+86400000;
  let received=0, min=null, max=null, seconds=0, milliseconds=0;
  const plausible=n=>Number.isFinite(n)&&n>=lower&&n<=upper;
  return {
    observe(payload,page) {
      const {limit,offset,total}=payload.list.pager;
      pages.push({page,limit,offset,total,items:payload.list.items.length});
      for(const item of payload.list.items){
        // Probe 02 confirmed these primitive types. New shapes stop, not coerce.
        const n=item.time_created;
        if(!Number.isSafeInteger(n)||n<0||typeof item.public_rating!=='boolean')fail('YANDEX_CONTRACT_DRIFT');
        received++;min=min===null?n:Math.min(min,n);max=max===null?n:Math.max(max,n);
        if(plausible(n*1000))seconds++;
        if(plausible(n))milliseconds++;
        if(!plausible(n*1000)&&!plausible(n))fail('YANDEX_CONTRACT_DRIFT');
      }
    },
    finish(reviews,plan) {
      if(!pages.length||received!==pages[0].total)fail('YANDEX_PAGINATION_CHANGED');
      const unit=received===0?'NO_EVIDENCE':seconds===received&&milliseconds===0?'UNIX_SECONDS':
        milliseconds===received&&seconds===0?'UNIX_MILLISECONDS':null;
      if(unit===null)fail('YANDEX_CONTRACT_DRIFT');
      const factor=unit==='UNIX_SECONDS'?1000:1;
      const ratings={'1':0,'2':0,'3':0,'4':0,'5':0};
      let replies=0,textNull=0,authorNull=0;
      for(const r of reviews){
        if(r.publishedAt!==new Date(r.rawPayload.time_created*factor).toISOString())fail('YANDEX_CONTRACT_DRIFT');
        ratings[r.rating]++;if(r.ownerReply!==null)replies++;
        if(r.reviewText===null)textNull++;if(r.authorName===null)authorNull++;
      }
      const inserts=plan.operations.filter(o=>o.kind==='insert').length;
      const updates=plan.operations.filter(o=>o.kind==='update_same_scope').length;
      const key=randomBytes(32);
      let sample;
      try{sample=reviews.slice(0,3).map(r=>({
        external_review_id_hash:createHmac('sha256',key).update(r.externalReviewId).digest('hex'),
        rating:r.rating,published_at:r.publishedAt,owner_reply_present:r.ownerReply!==null,
        provider:r.provider,external_location_id:r.externalLocationId
      }));}finally{key.fill(0);}
      return {
        pagesFetched:pages.length,pages,pagerTotal:pages[0].total,receivedReviews:received,
        uniqueReviews:reviews.length,duplicates:received-reviews.length,
        statisticsBasis:'UNIQUE_NORMALIZED_REVIEWS',ownerReplyCount:replies,ratingDistribution:ratings,
        reviewText:{null:textNull,nonNull:reviews.length-textNull},
        author:{null:authorNull,nonNull:reviews.length-authorNull},
        timeCreated:{unit,rawMin:min,rawMax:max,
          minPublishedAt:min===null?null:new Date(min*factor).toISOString(),
          maxPublishedAt:max===null?null:new Date(max*factor).toISOString(),
          plausibilityWindow:{from:new Date(lower).toISOString(),to:new Date(upper).toISOString()},
          secondsPlausible:seconds,millisecondsPlausible:milliseconds},
        persistencePlan:{plannedInserts:inserts,plannedUpdates:updates,
          unchanged:updates===0?0:null,unchangedStatus:updates===0?'NO_EXISTING_MATCHES':'NOT_COMPUTED_BY_EXISTING_PLAN',
          collisions:0,scopeFailures:0,persistenceEnabled:false},sample
      };
    }
  };
}
