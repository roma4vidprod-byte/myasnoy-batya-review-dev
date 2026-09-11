function clean(v,n=5000){return String(v||'').trim().slice(0,n)}
function bearer(req){const h=String(req.headers.authorization||'');return h.startsWith('Bearer ')?h.slice(7):''}
function extractOutputText(data){if(typeof data?.output_text==='string')return data.output_text.trim();for(const item of data?.output||[]){for(const part of item?.content||[]){if(part?.type==='output_text'&&part.text)return String(part.text).trim()}}return ''}
async function rpc(name,payload,token){
  const url=process.env.SUPABASE_URL;const key=process.env.SUPABASE_ANON_KEY;
  if(!url||!key)throw Object.assign(new Error('SUPABASE_SERVER_ENV_NOT_CONFIGURED'),{status:503});
  const r=await fetch(`${url}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(payload||{})});
  const text=await r.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!r.ok)throw Object.assign(new Error(data?.message||'SUPABASE_RPC_FAILED'),{status:r.status});
  return data;
}
export default async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({ok:false,error:'METHOD_NOT_ALLOWED'});
  const token=bearer(req);if(!token)return res.status(401).json({ok:false,error:'AUTH_REQUIRED'});
  const reviewId=clean(req.body?.reviewId,100);if(!reviewId)return res.status(400).json({ok:false,error:'REVIEW_ID_REQUIRED'});
  if(!process.env.OPENAI_API_KEY)return res.status(503).json({ok:false,error:'AI_NOT_CONFIGURED'});
  try{
    const profile=await rpc('review_admin_profile',{},token);if(!Array.isArray(profile)||!profile.length)return res.status(403).json({ok:false,error:'ADMIN_REQUIRED'});
    const rows=await rpc('review_admin_review_for_ai',{p_review_id:reviewId},token);const review=Array.isArray(rows)?rows[0]:null;if(!review)return res.status(404).json({ok:false,error:'REVIEW_NOT_FOUND'});
    const model=process.env.OPENAI_REVIEW_MODEL||'gpt-5.6-luna';
    const instructions='Ты помощник сети быстрого питания «Мясной Батя». Подготовь только черновик публичного ответа на отзыв. Пиши по-русски, коротко, конкретно, по-человечески, 1–3 предложения, максимум 700 символов. Не выдумывай факты, причины, компенсации, скидки, возвраты или действия сотрудников. Не спорь с клиентом. Для негатива поблагодари за сигнал и спокойно предложи разобраться; для положительного естественно поблагодари. Не упоминай AI, внутренние системы, промокоды или Review Activator. Ничего не публикуй.';
    const input=JSON.stringify({rating:review.rating,review:clean(review.review_text),author:clean(review.author_name,120)||null,location:clean(review.location_name,200)||null,provider:review.provider});
    const ai=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model,instructions,input,reasoning:{effort:'low'},max_output_tokens:220})});
    const body=await ai.json();if(!ai.ok)return res.status(502).json({ok:false,error:'AI_PROVIDER_FAILED'});
    const draft=extractOutputText(body).slice(0,700);if(!draft)return res.status(502).json({ok:false,error:'AI_EMPTY_RESPONSE'});
    return res.status(200).json({ok:true,draft,model});
  }catch(e){return res.status(e.status||500).json({ok:false,error:e.message||'AI_DRAFT_FAILED'})}
}
