import { createAdapterServer } from './http-adapter.js';
import { CLOSED_ROUTES } from './foundation.js';

const RPCS=['review_admin_profile','review_is_admin','review_admin_reviews_scoped','review_public_sync_status','vps_lab_readiness',
  'review_admin_reviews_with_drafts_scoped','review_admin_save_reply_draft_scoped','review_admin_discard_reply_draft_scoped',
  'review_admin_reply_workflow_scoped','review_admin_prepare_reply_approval_scoped','review_admin_approve_reply_scoped',
  'review_admin_cancel_queued_reply_scoped'];
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
export function createLabServer({config,logger,fetchImpl=(...a)=>fetch(...a),adminHtml=null}={}) {
  if(config?.profile!=='vps-lab')throw new Error('VPS_LAB_OPT_IN_REQUIRED');
  const closed=(_,res)=>res.status(503).json({ok:false,error:'LAB_ROUTE_DISABLED'});
  const routes=new Map(CLOSED_ROUTES.map(p=>[p,{methods:['GET','POST','PUT','DELETE','OPTIONS','PATCH'],handler:closed}]));
  const readiness=async(_,res)=>{const r=await labReadiness(config,fetchImpl);res.status(r.ok?200:503).json(r);};
  routes.set('/healthz',{methods:['GET','HEAD'],handler:(_,res)=>res.status(200).json({ok:true,profile:'vps-lab',providers:'DISABLED',scheduler:'DISABLED'})});
  routes.set('/readyz',{methods:['GET','HEAD'],handler:readiness});
  routes.set('/api/health',{methods:['GET'],handler:readiness});
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
