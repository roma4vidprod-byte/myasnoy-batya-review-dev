import { requestDevServiceRpc } from './review-sync.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail=code=>{throw Object.assign(new Error(code),{code});};

// The only runtime review writer. It sends normalized rows to the atomic DEV RPC;
// the database owns the transaction, scoped constraint and local-field preservation.
export function createReviewPersistenceWriter({rpc=requestDevServiceRpc}={}){
  async function persistNormalizedReviews({companyId,locationId,provider,externalLocationId,reviews}={}){
    if(typeof window!=='undefined')fail('SERVER_ONLY');
    if(!uuid.test(companyId||'')||!uuid.test(locationId||'')||!['yandex','2gis'].includes(provider)||typeof externalLocationId!=='string'||!externalLocationId.trim()||!Array.isArray(reviews))fail('REVIEW_SCOPE_REQUIRED');
    const rows=reviews.map(row=>{
      if(!row||row.company_id!==companyId||row.location_id!==locationId||row.provider!==provider||row.external_location_id!==externalLocationId)fail('REVIEW_SCOPE_COLLISION');
      return {external_review_id:row.external_review_id,author_name:row.author_name,rating:row.rating,
        review_text:row.review_text,published_at:row.published_at,observed_at:row.observed_at,
        owner_reply_text:row.owner_reply_text,owner_replied_at:row.owner_replied_at,raw_payload:row.raw_payload};
    });
    const result=await rpc('review_persist_external_reviews',{p_company_id:companyId,p_location_id:locationId,
      p_provider:provider,p_external_location_id:externalLocationId,p_reviews:rows});
    if(!result||result.persistence_enabled!==true||![result.inserted,result.updated,result.unchanged,result.seen].every(Number.isSafeInteger)||
      result.inserted<0||result.updated<0||result.unchanged<0||result.seen!==rows.length||result.inserted+result.updated+result.unchanged!==rows.length)fail('REVIEW_WRITER_CONTRACT_DRIFT');
    return result;
  }
  return {persistNormalizedReviews};
}
