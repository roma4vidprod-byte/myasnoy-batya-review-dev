import http from 'node:http';
import { createAdapterServer } from './http-adapter.js';
import { CLOSED_ROUTES } from './foundation.js';
import { validateDraft, AI_REPLY_POLICY_VERSION } from '../../ai/review-reply.js';

const AI_DRAFT_SOCKET='/run/review-ai-draft/ai.sock';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64=/^[0-9a-f]{64}$/;
const RPCS=['review_admin_profile','review_is_admin','review_admin_reviews_scoped','review_public_sync_status','vps_lab_readiness',
  'review_admin_reviews_with_drafts_scoped','review_admin_save_reply_draft_scoped','review_admin_discard_reply_draft_scoped',
  'review_admin_reply_workflow_scoped','review_admin_prepare_reply_approval_scoped','review_admin_approve_reply_scoped',
  'review_admin_cancel_queued_reply_scoped'];
export function requestAiDraftSocket(payload,{socketPath=AI_DRAFT_SOCKET,timeoutMs=25000}={}){
  const body=Buffer.from(JSON.stringify(payload),'utf8');
  if(body.length>12288)return Promise.reject(Object.assign(new Error('AI_INPUT_INVALID'),{code:'AI_INPUT_INVALID'}));
  return new Promise((resolve,reject)=>{
    let done=false,text='',timer=null;
    const finish=(error,value)=>{if(done)return;done=true;if(timer)clearTimeout(timer);error?reject(error):resolve(value);};
    const req=http.request({socketPath,path:'/draft',method:'POST',headers:{'content-type':'application/json','content-length':body.length}},res=>{
      res.setEncoding('utf8');
      res.on('data',chunk=>{text+=chunk;if(text.length>65536)req.destroy();});
      res.on('end',()=>{
        let data=null;try{data=text?JSON.parse(text):null}catch{}
        if(res.statusCode===503&&data?.error==='AI_NOT_CONFIGURED')return finish(Object.assign(new Error('AI_NOT_CONFIGURED'),{code:'AI_NOT_CONFIGURED'}));
        if(res.statusCode!==200||!data?.ok)return finish(Object.assign(new Error('AI_DRAFT_UNAVAILABLE'),{code:'AI_DRAFT_UNAVAILABLE'}));
        finish(null,data);
      });
    });
    timer=setTimeout(()=>{req.destroy();finish(Object.assign(new Error('AI_DRAFT_UNAVAILABLE'),{code:'AI_DRAFT_UNAVAILABLE'}));},timeoutMs);
    req.on('error',error=>{
      const code=['ENOENT','ECONNREFUSED'].includes(error?.code)?'AI_NOT_CONFIGURED':'AI_DRAFT_UNAVAILABLE';
      finish(Object.assign(new Error(code),{code}));
    });
    req.end(body);
  });
}
export async function labReadiness(config,fetchImpl=fetch) {
  try {
    const get=async(url,options={})=>{
      const r=await fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(1500)});
      if(!r.ok)throw new Error();return r.json();
    };
    const health=await get(config.authUrl+'/health');
    if(health.version!=='v2.196.0')throw new Error();
    const keys=await get(config.authUrl+'/.well-known/jwks.json');
    if(!keys.keys?.some(k=>k.kty===config.jwk.kty&&k.crv===config.jwk.crv&&k.x===config.jwk.x&&k.y===config.jwk.y&&k.kid===config.jwk.kid))throw new Error();
    const db=await get(config.apiUrl+'/rpc/vps_lab_readiness',{method:'POST',headers:{Authorization:'Bearer '+config.target.publicKey,'Content-Type':'application/json'},body:'{}'});
    if(db.database!=='review_activator_lab'||db.profile!=='vps-lab'||db.version!==config.schemaVersion||db.auth_schema!==true)throw new Error();
    return {ok:true,profile:'vps-lab',dependencies:'PASS',migrations:'PASS',providers:'DISABLED',scheduler:'DISABLED'};
  }catch {return {ok:false,profile:'vps-lab',error:'LAB_DEPENDENCY_NOT_READY',providers:'DISABLED',scheduler:'DISABLED'};}
}
export function createLabServer({config,logger,fetchImpl=(...a)=>fetch(...a),aiDraftRequest=requestAiDraftSocket,adminHtml=null}={}) {
  if(config?.profile!=='vps-lab')throw new Error('VPS_LAB_OPT_IN_REQUIRED');
  const closed=(_,res)=>res.status(503).json({ok:false,error:'LAB_ROUTE_DISABLED'});
  const routes=new Map(CLOSED_ROUTES.map(p=>[p,{methods:['GET','POST','PUT','DELETE','OPTIONS','PATCH'],handler:closed}]));
  const readiness=async(_,res)=>{const r=await labReadiness(config,fetchImpl);res.status(r.ok?200:503).json(r);};
  const aiDraft=async(req,res)=>{
    if(req.headers.origin&&req.headers.origin!==config.target.url)return res.status(403).json({ok:false,error:'ORIGIN_NOT_ALLOWED'});
    if(Object.keys(req.headers).some(k=>/^x-(user|role|company|jwt|supabase)/.test(k)))return res.status(403).json({ok:false,error:'IDENTITY_HEADER_FORBIDDEN'});
    const auth=req.headers.authorization;
    if(typeof auth!=='string'||!/^Bearer [A-Za-z0-9_.-]+$/.test(auth)||auth.length>8192)return res.status(401).json({ok:false,error:'AUTH_REQUIRED'});
    if(!req.body||Object.keys(req.body).sort().join()!=='reviewId'||typeof req.body.reviewId!=='string'||!UUID.test(req.body.reviewId))
      return res.status(400).json({ok:false,error:'REVIEW_ID_INVALID'});
    try{
      const rr=await fetchImpl(config.apiUrl+'/rpc/review_admin_review_for_ai_scoped',{
        method:'POST',headers:{Authorization:auth,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(3500),
        body:JSON.stringify({p_review_id:req.body.reviewId,p_company_id:config.adminScope.companyId,p_location_id:config.adminScope.locationId,p_external_location_id:config.adminScope.externalLocationId,p_provider:config.adminScope.provider})
      });
      if(!rr.ok)return res.status(rr.status===401?401:rr.status===403?403:rr.status===404?404:503).json({ok:false,error:rr.status===401?'AUTH_REQUIRED':rr.status===403?'ADMIN_REQUIRED':rr.status===404?'REVIEW_NOT_FOUND':'LAB_BACKEND_REJECTED'});
      const raw=await rr.text();if(raw.length>65536)throw new Error();
      const rows=raw?JSON.parse(raw):[];const review=Array.isArray(rows)?rows[0]:null;
      if(!review||review.id!==req.body.reviewId||review.provider!=='yandex'||typeof review.review_text!=='string'||review.review_text.length>5000) return res.status(404).json({ok:false,error:'REVIEW_NOT_FOUND'});
      const context={rating:review.rating,reviewText:review.review_text,authorName:typeof review.author_name==='string'?review.author_name:null,locationName:typeof review.location_name==='string'?review.location_name:null,provider:'yandex'};
      const ai=await aiDraftRequest(context);
      const draft=validateDraft(ai?.draft);
      if(ai?.policy_version!==AI_REPLY_POLICY_VERSION||typeof ai?.model!=='string'||ai.model.length>120||!HEX64.test(String(ai?.context_hash||'')))throw new Error();
      return res.status(200).json({ok:true,draft,model:ai.model,policy_version:ai.policy_version,context_hash:ai.context_hash});
    }catch(error){
      if(error?.code==='AI_NOT_CONFIGURED')return res.status(503).json({ok:false,error:'AI_NOT_CONFIGURED'});
      return res.status(503).json({ok:false,error:'AI_DRAFT_UNAVAILABLE'});
    }
  };
  routes.set('/healthz',{methods:['GET','HEAD'],handler:(_,res)=>res.status(200).json({ok:true,profile:'vps-lab',providers:'DISABLED',scheduler:'DISABLED'})});
  routes.set('/readyz',{methods:['GET','HEAD'],handler:readiness});
  routes.set('/api/health',{methods:['GET'],handler:readiness});
  routes.set('/api/admin-review-reply-draft',{methods:['POST'],handler:aiDraft});
  const forward=(base,path)=>async(req,res)=>{
    if(req.headers.origin&&req.headers.origin!==config.target.url)return res.status(403).json({error:'ORIGIN_NOT_ALLOWED'});
    if(Object.keys(req.headers).some(k=>/^x-(user|role|company|jwt|supabase)/.test(k)))return res.status(403).json({error:'IDENTITY_HEADER_FORBIDDEN'});
    // No dynamic destinations, forwarding of cookies, apikey, Host, or identity claims.
    let tail='';
    if(path==='/token') {
      if(Object.keys(req.query).length!==1||!['password','refresh_token'].includes(req.query.grant_type))return res.status(400).json({error:'AUTH_FLOW_DISABLED'});
      tail='?grant_type='+req.query.grant_type;
    }else if(path==='/review_external_reviews') {
      if(Object.keys(req.query).some(k=>k!=='select')||typeof req.query.select!=='string'||!/^[a-z_,]+$/.test(req.query.select))return res.status(400).json({error:'QUERY_NOT_ALLOWED'});
      tail='?select='+req.query.select+'&limit=50';
    }else if(Object.keys(req.query).length)return res.status(400).json({error:'QUERY_NOT_ALLOWED'});
    if(path==='/user'&&req.method==='PUT'&&(Object.keys(req.body).length!==1||typeof req.body.password!=='string'))return res.status(400).json({error:'AUTH_UPDATE_DISABLED'});
    const auth=req.headers.authorization;
    if(auth!==undefined&&(typeof auth!=='string'||!/^Bearer [A-Za-z0-9_.-]+$/.test(auth)||auth.length>8192))return res.status(401).json({error:'AUTHORIZATION_INVALID'});
    try {
      const r=await fetchImpl(base+path+tail,{method:req.method,headers:{'Content-Type':'application/json',...(auth?{Authorization:auth}:{})},
        body:['GET','HEAD'].includes(req.method)?undefined:JSON.stringify(req.body),redirect:'error',signal:AbortSignal.timeout(3500)});
      if(!r.ok)return res.status(r.status>=400&&r.status<500?r.status:503).json({error:'LAB_BACKEND_REJECTED'});
      if(r.status===204)return res.status(204).send('');
      const text=await r.text();if(text.length>1048576)throw new Error();
      return res.status(r.status).json(text?JSON.parse(text):null);
    }catch {return res.status(503).json({error:'LAB_BACKEND_UNAVAILABLE'});}
  };
  for(const [path,methods] of [['/token',['POST']],['/user',['GET','PUT']],['/logout',['POST']]]) routes.set('/auth/v1'+path,{methods,handler:forward(config.authUrl,path)});
  for(const name of RPCS)routes.set('/rest/v1/rpc/'+name,{methods:['POST'],handler:forward(config.apiUrl,'/rpc/'+name)});
  routes.set('/rest/v1/review_external_reviews',{methods:['GET'],handler:forward(config.apiUrl,'/review_external_reviews')});
  // Existing static admin UI only. No filesystem path chosen by request.
  if(adminHtml!==null)routes.set('/admin.html',{methods:['GET'],handler:(_,res)=>{
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.send(adminHtml);
  }});
  return createAdapterServer({config,routes,logger});
}
