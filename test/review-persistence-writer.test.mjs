import assert from 'node:assert/strict';
import test from 'node:test';
import { createReviewPersistenceWriter } from '../lib/server/review-persistence-writer.js';

const scope={companyId:'11111111-1111-4111-8111-111111111111',locationId:'33333333-3333-4333-8333-333333333333',provider:'yandex',externalLocationId:'54309413522'};
const row={company_id:scope.companyId,location_id:scope.locationId,provider:scope.provider,external_location_id:scope.externalLocationId,external_review_id:'id-1',author_name:'Synthetic',rating:5,review_text:'Synthetic',published_at:'2025-01-01T00:00:00.000Z',observed_at:'2026-09-13T00:00:00.000Z',owner_reply_text:null,owner_replied_at:null,raw_payload:{contract_version:'business-list-v1'}};
test('writer boundary sends only normalized scoped rows and accepts exact atomic summary',async()=>{
  let request;const writer=createReviewPersistenceWriter({rpc:async(name,payload)=>{request={name,payload};return {inserted:1,updated:0,unchanged:0,seen:1,persistence_enabled:true};}});
  assert.deepEqual(await writer.persistNormalizedReviews({...scope,reviews:[row]}),{inserted:1,updated:0,unchanged:0,seen:1,persistence_enabled:true});
  assert.equal(request.name,'review_persist_external_reviews');assert.deepEqual(request.payload.p_reviews,[{external_review_id:'id-1',author_name:'Synthetic',rating:5,review_text:'Synthetic',published_at:'2025-01-01T00:00:00.000Z',observed_at:'2026-09-13T00:00:00.000Z',owner_reply_text:null,owner_replied_at:null,raw_payload:{contract_version:'business-list-v1'}}]);
});
test('writer rejects contradictory scope and malformed atomic result',async()=>{
  const writer=createReviewPersistenceWriter({rpc:async()=>({inserted:1,updated:0,unchanged:0,seen:2,persistence_enabled:true})});
  await assert.rejects(writer.persistNormalizedReviews({...scope,reviews:[{...row,location_id:'44444444-4444-4444-8444-444444444444'}]}),{code:'REVIEW_SCOPE_COLLISION'});
  await assert.rejects(writer.persistNormalizedReviews({...scope,reviews:[row]}),{code:'REVIEW_WRITER_CONTRACT_DRIFT'});
});
