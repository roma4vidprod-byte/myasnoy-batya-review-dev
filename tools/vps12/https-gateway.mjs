import http from 'node:http';

export const DEFAULT_INTERNAL_ORIGIN='http://127.0.0.1:13000';
export const DEFAULT_HOST='127.0.0.1';
export const DEFAULT_PORT=13010;

const ALLOWED_RPC=new Set([
  '/rest/v1/rpc/review_admin_profile',
  '/rest/v1/rpc/review_admin_reviews_scoped',
  '/rest/v1/rpc/review_admin_reviews_with_drafts_scoped',
  '/rest/v1/rpc/review_admin_save_reply_draft_scoped',
  '/rest/v1/rpc/review_admin_discard_reply_draft_scoped',
  '/rest/v1/rpc/review_admin_reply_workflow_scoped',
  '/rest/v1/rpc/review_admin_prepare_reply_approval_scoped',
  '/rest/v1/rpc/review_admin_approve_reply_scoped',
  '/rest/v1/rpc/review_admin_cancel_queued_reply_scoped'
]);

function json(res,status,value){
  const body=JSON.stringify(value);
  res.writeHead(status,{
    'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store',
    'x-content-type-options':'nosniff',
    'referrer-policy':'no-referrer'
  });
  res.end(body);
}

export function isAllowedRequest(method,url){
  const u=new URL(url,'https://gateway.invalid');
  if(method==='GET'&&['/admin.html','/healthz','/readyz'].includes(u.pathname))return true;
  if(method==='POST'&&u.pathname==='/auth/v1/logout')return true;
  if(method==='GET'&&u.pathname==='/auth/v1/user')return true;
  if(method==='PUT'&&u.pathname==='/auth/v1/user')return true;
  if(method==='POST'&&ALLOWED_RPC.has(u.pathname))return true;
  if(method==='POST'&&u.pathname==='/api/admin-review-reply-draft')return true;
  if(method==='POST'&&u.pathname==='/auth/v1/token'){
    const keys=[...u.searchParams.keys()];
    return keys.length===1&&keys[0]==='grant_type'&&
      ['password','refresh_token'].includes(u.searchParams.get('grant_type'));
  }
  return false;
}

export function rewriteAdmin(html,publicOrigin,operatorEmail='tas.food@yandex.ru'){
  return html
    .replaceAll(DEFAULT_INTERNAL_ORIGIN,publicOrigin)
    .replaceAll('owner@vps04.invalid',operatorEmail)
    .replaceAll('Myasnoibatya@yandex.ru',operatorEmail);
}

function exactPublicOrigin(value){
  if(typeof value!=='string')return null;
  if(!/^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(value))return null;
  return value.replace(/\/$/,'');
}

async function readBody(req,maxBytes=65536){
  const chunks=[];let size=0;
  for await(const chunk of req){
    size+=chunk.length;
    if(size>maxBytes)throw Object.assign(new Error('BODY_TOO_LARGE'),{status:413});
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function assertBrowserOrigin(req,publicOrigin){
  if(['GET','HEAD'].includes(req.method))return;
  if(req.headers.origin!==publicOrigin)
    throw Object.assign(new Error('ORIGIN_NOT_ALLOWED'),{status:403});
}

function upstreamHeaders(req){
  const h={'content-type':'application/json'};
  const auth=req.headers.authorization;
  if(auth!==undefined){
    if(typeof auth!=='string'||!/^Bearer [A-Za-z0-9_.-]+$/.test(auth)||auth.length>8192)
      throw Object.assign(new Error('AUTHORIZATION_INVALID'),{status:401});
    h.authorization=auth;
  }
  return h;
}

async function proxy(req,res,internalOrigin){
  const body=['GET','HEAD'].includes(req.method)?undefined:await readBody(req);
  const r=await fetch(internalOrigin+req.url,{
    method:req.method,
    headers:upstreamHeaders(req),
    body,
    redirect:'error',
    signal:AbortSignal.timeout(7000)
  });
  const text=await r.text();
  const type=r.headers.get('content-type')||'application/json; charset=utf-8';
  res.writeHead(r.status,{
    'content-type':type,
    'cache-control':'no-store',
    'x-content-type-options':'nosniff',
    'referrer-policy':'no-referrer'
  });
  res.end(text);
}

async function serveAdmin(res,internalOrigin,publicOrigin,operatorEmail){
  const r=await fetch(internalOrigin+'/admin.html',{
    redirect:'error',
    signal:AbortSignal.timeout(7000)
  });
  if(!r.ok)throw Object.assign(new Error('ADMIN_UPSTREAM_FAILED'),{status:503});
  const html=rewriteAdmin(await r.text(),publicOrigin,operatorEmail);
  res.writeHead(200,{
    'content-type':'text/html; charset=utf-8',
    'cache-control':'no-store',
    'content-security-policy':"default-src 'none'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'strict-transport-security':'max-age=31536000',
    'x-content-type-options':'nosniff',
    'referrer-policy':'no-referrer',
    'x-frame-options':'DENY'
  });
  res.end(html);
}

export function createGateway({
  publicOrigin,
  internalOrigin=DEFAULT_INTERNAL_ORIGIN,
  operatorEmail='tas.food@yandex.ru'
}={}){
  publicOrigin=exactPublicOrigin(publicOrigin);
  if(!publicOrigin)throw new Error('PUBLIC_ORIGIN_INVALID');
  if(internalOrigin!==DEFAULT_INTERNAL_ORIGIN)throw new Error('INTERNAL_ORIGIN_INVALID');

  return http.createServer(async(req,res)=>{
    try{
      if(!isAllowedRequest(req.method,req.url))
        return json(res,404,{ok:false,error:'HTTPS_GATEWAY_DRAFT_ONLY'});
      assertBrowserOrigin(req,publicOrigin);
      const path=new URL(req.url,publicOrigin).pathname;
      if(req.method==='GET'&&path==='/admin.html')
        return await serveAdmin(res,internalOrigin,publicOrigin,operatorEmail);
      return await proxy(req,res,internalOrigin);
    }catch(error){
      const status=Number(error?.status)||502;
      return json(res,status,{ok:false,error:error?.message||'HTTPS_GATEWAY_FAILED'});
    }
  });
}

export function startGateway(env=process.env){
  const publicOrigin=env.RA_PUBLIC_ORIGIN;
  const host=env.RA_GATEWAY_HOST||DEFAULT_HOST;
  const port=Number(env.RA_GATEWAY_PORT||DEFAULT_PORT);
  if(host!==DEFAULT_HOST||port!==DEFAULT_PORT)throw new Error('GATEWAY_BIND_INVALID');
  const server=createGateway({publicOrigin,operatorEmail:env.RA_OPERATOR_EMAIL||'tas.food@yandex.ru'});
  server.listen(port,host,()=>{
    process.stdout.write(JSON.stringify({ok:true,host,port,publicOrigin,mode:'draft-only'})+'\n');
  });
  for(const signal of ['SIGTERM','SIGINT'])
    process.on(signal,()=>server.close(()=>process.exit(0)));
  return server;
}

if(import.meta.url===new URL('file://'+process.argv[1].replaceAll('\\','/')).href)
  startGateway();
