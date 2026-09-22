import {createHash} from 'node:crypto';
import {buildReviewReplyPrompt,validateDraft,AI_REPLY_POLICY_VERSION} from '../lib/ai/review-reply.js';

const SCOPE=Object.freeze({
  companyId:'13f3cb80-487a-4a19-96a1-fb3103200230',
  locationId:'9a95f63b-18e6-447b-a449-8530b67ddbae',
  externalLocationId:'54309413522',provider:'yandex'
});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODEL=/^[A-Za-z0-9._:\-]{2,120}$/;

function bearer(req){
  const h=String(req.headers.authorization||'');
  return /^Bearer [A-Za-z0-9_.-]+$/.test(h)&&h.length<=8192?h.slice(7):'';
}
function extractOutputText(data){
  if(typeof data?.output_text==='string')return data.output_text.trim();
  for(const item of data?.output||[])for(const part of item?.content||[])
    if(part?.type==='output_text'&&part.text)return String(part.text).trim();
  return '';
}
function safeErrorStatus(error){
  const status=Number(error?.status);
  return Number.isInteger(status)&&status>=400&&status<600?status:500;
}
function safeErrorCode(error){
  const status=safeErrorStatus(error);
  if(status===401)return 'AUTH_REQUIRED';if(status===403)return 'ADMIN_REQUIRED';
  if(status===404)return 'REVIEW_NOT_FOUND';if(status===503)return 'AI_NOT_CONFIGURED';
  return status===502?'AI_PROVIDER_FAILED':'AI_DRAFT_FAILED';
}
async function rpc(name,payload,token){
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_ANON_KEY;
  if(!url||!key)throw Object.assign(new Error('SERVER_ENV_NOT_CONFIGURED'),{status:503});
  const r=await fetch(`${url}/rest/v1/rpc/${name}`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(5000),
    headers:{apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(payload||{})});
  const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{}
  if(!r.ok)throw Object.assign(new Error('RPC_FAILED'),{status:r.status});
  return data;
}

export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
  const token=bearer(req);if(!token)return res.status(401).json({ok:false,error:'AUTH_REQUIRED'});
  if(!req.body||Object.keys(req.body).sort().join()!=='reviewId'||typeof req.body.reviewId!=='string'||!UUID.test(req.body.reviewId))
    return res.status(400).json({ok:false,error:'REVIEW_ID_INVALID'});
  const model=String(process.env.OPENAI_REVIEW_MODEL||'').trim();
  if(!process.env.OPENAI_API_KEY||!MODEL.test(model))return res.status(503).json({ok:false,error:'AI_NOT_CONFIGURED'});
  try{
    const profile=await rpc('review_admin_profile',{},token);
    if(!Array.isArray(profile)||!profile.length)return res.status(403).json({ok:false,error:'ADMIN_REQUIRED'});
    const rows=await rpc('review_admin_review_for_ai_scoped',{
      p_review_id:req.body.reviewId,p_company_id:SCOPE.companyId,p_location_id:SCOPE.locationId,
      p_external_location_id:SCOPE.externalLocationId,p_provider:SCOPE.provider
    },token);
    const review=Array.isArray(rows)?rows[0]:null;
    if(!review||review.id!==req.body.reviewId||review.provider!=='yandex'||typeof review.review_text!=='string')
      return res.status(404).json({ok:false,error:'REVIEW_NOT_FOUND'});
    const context={rating:review.rating,reviewText:review.review_text,authorName:typeof review.author_name==='string'?review.author_name:null,locationName:typeof review.location_name==='string'?review.location_name:null};
    const prompt=buildReviewReplyPrompt(context);
    const ai=await fetch('https://api.openai.com/v1/responses',{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),
      headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},
      body:JSON.stringify({model,instructions:prompt.system,input:prompt.user,max_output_tokens:220})});
    const text=await ai.text();if(text.length>1048576)throw Object.assign(new Error('AI_PROVIDER_FAILED'),{status:502});
    let body=null;try{body=text?JSON.parse(text):null}catch{}
    if(!ai.ok)throw Object.assign(new Error('AI_PROVIDER_FAILED'),{status:502});
    const draft=validateDraft(extractOutputText(body));
    const contextHash=createHash('sha256').update(JSON.stringify({
      rating:review.rating,reviewText:review.review_text,authorName:review.author_name??null,locationName:review.location_name??null,provider:'yandex'
    })).digest('hex');
    return res.status(200).json({ok:true,draft,model,policy_version:AI_REPLY_POLICY_VERSION,context_hash:contextHash});
  }catch(e){
    const code=String(e?.code||'');
    if(code.startsWith('AI_REPLY_'))return res.status(502).json({ok:false,error:'AI_POLICY_REJECTED'});
    return res.status(safeErrorStatus(e)).json({ok:false,error:safeErrorCode(e)});
  }
}
