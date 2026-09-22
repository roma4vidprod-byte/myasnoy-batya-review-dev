import {spawn} from 'node:child_process';
import {mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {userInfo} from 'node:os';
import {createVpsSessionContext,VPS_SESSION_SCOPE} from '../../lib/server/yandex-session/profile-context.js';
import {parseYandexReviewsPayload} from '../../lib/providers/yandex.js';
import {createBrowserSessionStore} from './browser-session-store.mjs';
import {createBrowserSessionAdapter} from './browser-session-adapter.mjs';
import {createCdpPipe} from './chrome-pipe.mjs';

const BROWSER='/usr/bin/google-chrome-stable';
const MAX_BODY=2*1024*1024;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const safeCodes=new Set([
  'BROWSER_ROLE_DENIED','SESSION_NOT_READY','SESSION_KEY_NOT_CONFIGURED',
  'SESSION_DECRYPT_FAILED','BROWSER_SESSION_READ_FAILED','BROWSER_RUNTIME_INVALID',
  'BROWSER_BINARY_INVALID','BROWSER_CDP_INVALID','BROWSER_CDP_CLOSED',
  'BROWSER_CDP_TIMEOUT','BROWSER_CDP_COMMAND_FAILED','BROWSER_CDP_PROTOCOL_INVALID',
  'BROWSER_NAVIGATION_FAILED','BROWSER_HTTP_INVALID','BROWSER_BODY_INVALID',
  'BROWSER_PROVIDER_CONTRACT_INVALID','BROWSER_UNEXPECTED_REPLY_ENDPOINT'
]);

function browserArgs(profile){
  return [
    '--headless=new','--remote-debugging-pipe','--disable-gpu','--disable-extensions','--disable-dev-shm-usage',
    '--no-first-run','--no-default-browser-check','--disable-background-networking',
    '--disable-component-update','--disable-domain-reliability','--disable-sync',
    '--metrics-recording-only','--disable-breakpad','--disable-features=MediaRouter,Translate,OptimizationHints',
    '--user-data-dir='+profile,'about:blank'
  ];
}

function cookieForCdp(cookie){
  if(!cookie||typeof cookie!=='object'||typeof cookie.name!=='string'||typeof cookie.value!=='string')
    fail('BROWSER_PROVIDER_CONTRACT_INVALID');
  const out={name:cookie.name,value:cookie.value,domain:cookie.domain,path:cookie.path||'/',
    secure:cookie.secure===true,httpOnly:cookie.httpOnly===true};
  if(Number.isFinite(cookie.expires)&&cookie.expires>0)out.expires=cookie.expires;
  return out;
}

function waitFor(timeoutMs,code){
  let resolve,reject,timer;
  const promise=new Promise((res,rej)=>{resolve=res;reject=rej;timer=setTimeout(()=>rej(Object.assign(new Error(code),{code})),timeoutMs);});
  return {promise,resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}};
}

export async function runServerBrowserRead(){
  if(process.platform!=='linux'||userInfo().username!=='review-yandex-browser')fail('BROWSER_ROLE_DENIED');
  if(process.env.RA_RUNTIME_PROFILE!=='vps-lab'||process.env.RA_YANDEX_MODE!=='read-only-admin'||
     process.env.RA_YANDEX_REPLY_WRITE_ENABLED!==undefined)fail('BROWSER_RUNTIME_INVALID');
  if(process.env.RA_YANDEX_BROWSER_BIN!==BROWSER)fail('BROWSER_BINARY_INVALID');
  const runtime=process.env.RUNTIME_DIRECTORY;
  if(typeof runtime!=='string'||runtime!=='/run/review-yandex-browser')fail('BROWSER_RUNTIME_INVALID');
  const profile=join(runtime,'profile');mkdirSync(profile,{mode:0o700});
  const context=createVpsSessionContext();
  const store=createBrowserSessionStore();
  const openSession=createBrowserSessionAdapter({store,context});
  let child,cdp,session,opened,stderr='',allowed=0,blocked=0,blockedNonGet=0,replyEndpointAttempts=0;
  const targetUrl=`https://yandex.ru/sprav/api/${VPS_SESSION_SCOPE.organizationId}/reviews?ranking=by_time&source=pagination&page=1`;
  let targetSessionId=null,mainRequestId=null,responseStatus=null;
  const responseWait=waitFor(12000,'BROWSER_NAVIGATION_FAILED');
  const finishedWait=waitFor(12000,'BROWSER_NAVIGATION_FAILED');
  try{
    opened=await openSession();session=opened.session;
    child=spawn(BROWSER,browserArgs(profile),{
      env:{PATH:'/usr/bin:/bin',HOME:runtime,LANG:'C.UTF-8',TMPDIR:runtime},
      stdio:['ignore','ignore','pipe','pipe','pipe']
    });
    child.stdio[2].on('data',buffer=>{if(stderr.length<4096)stderr+=buffer.toString('utf8');});
    cdp=createCdpPipe({input:child.stdio[3],output:child.stdio[4],timeoutMs:8000,onEvent:async event=>{
      if(!targetSessionId||event.sessionId!==targetSessionId)return;
      if(event.method==='Fetch.requestPaused'){
        const request=event.params?.request||{};
        const url=String(request.url||''),method=String(request.method||'');
        if(url.includes('/sprav/api/ugcpub/business-answer'))replyEndpointAttempts++;
        if(method==='GET'&&url===targetUrl){
          allowed++;
          await cdp.send('Fetch.continueRequest',{requestId:event.params.requestId},targetSessionId);
        }else{
          blocked++;if(!['GET','HEAD'].includes(method))blockedNonGet++;
          await cdp.send('Fetch.failRequest',{requestId:event.params.requestId,errorReason:'BlockedByClient'},targetSessionId);
        }
      }
      if(event.method==='Network.responseReceived'&&event.params?.response?.url===targetUrl){
        mainRequestId=event.params.requestId;responseStatus=event.params.response.status;
        responseWait.resolve(true);
      }
      if(event.method==='Network.loadingFinished'&&mainRequestId&&event.params?.requestId===mainRequestId){
        finishedWait.resolve(true);
      }
    }});
    const version=await cdp.send('Browser.getVersion');
    const created=await cdp.send('Target.createTarget',{url:'about:blank'});
    if(typeof created.targetId!=='string')fail('BROWSER_CDP_PROTOCOL_INVALID');
    const attached=await cdp.send('Target.attachToTarget',{targetId:created.targetId,flatten:true});
    if(typeof attached.sessionId!=='string')fail('BROWSER_CDP_PROTOCOL_INVALID');
    targetSessionId=attached.sessionId;
    await cdp.send('Network.enable',{},targetSessionId);
    await cdp.send('Page.enable',{},targetSessionId);
    await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]},targetSessionId);
    await cdp.send('Network.setCookies',{cookies:session.cookies.map(cookieForCdp)},targetSessionId);
    const navigation=await cdp.send('Page.navigate',{url:targetUrl},targetSessionId);
    if(navigation.errorText)fail('BROWSER_NAVIGATION_FAILED');
    await responseWait.promise;await finishedWait.promise;
    if(replyEndpointAttempts!==0)fail('BROWSER_UNEXPECTED_REPLY_ENDPOINT');
    if(responseStatus!==200||allowed!==1)fail('BROWSER_HTTP_INVALID');
    const bodyResult=await cdp.send('Network.getResponseBody',{requestId:mainRequestId},targetSessionId);
    let body=bodyResult.base64Encoded?Buffer.from(bodyResult.body,'base64').toString('utf8'):String(bodyResult.body||'');
    if(Buffer.byteLength(body,'utf8')<2||Buffer.byteLength(body,'utf8')>MAX_BODY)fail('BROWSER_BODY_INVALID');
    let payload;
    try{payload=JSON.parse(body);}catch{fail('BROWSER_BODY_INVALID');}finally{body='';}
    let parsed;
    try{parsed=parseYandexReviewsPayload(payload,VPS_SESSION_SCOPE.organizationId,{
      paginationMode:'MUTABLE_OFFSET',expectedOffset:0,expectedLimit:20
    });}catch{fail('BROWSER_PROVIDER_CONTRACT_INVALID');}
    const items=Array.isArray(payload?.list?.items)?payload.list.items:[];
    const answerCsrfCount=items.filter(item=>typeof item?.business_answer_csrf_token==='string'&&item.business_answer_csrf_token.length>0).length;
    const reportedTotal=Number(payload?.list?.pager?.total??payload?.list?.total??parsed.reviews.length);
    const product=typeof version.product==='string'?version.product.split('/')[0]:'Chrome';
    return Object.freeze({
      ok:true,operation:'server_browser_read',state:'BROWSER_READY',
      organization_id:VPS_SESSION_SCOPE.organizationId,session_revision:Number(opened.stored.revision),
      credential_version_present:true,cookie_count:session.cookies.length,
      browser_product:product,profile_persistent:false,sandbox_disabled:false,
      provider_requests:allowed,provider_writes:0,blocked_requests:blocked,
      blocked_non_get:blockedNonGet,reply_endpoint_attempts:replyEndpointAttempts,
      page_items:parsed.reviews.length,reported_total:Number.isFinite(reportedTotal)?reportedTotal:null,
      list_csrf_present:typeof payload?.list?.csrf_token==='string'&&payload.list.csrf_token.length>0,
      business_answer_csrf_present_count:answerCsrfCount
    });
  }finally{
    if(session?.cookies)for(const cookie of session.cookies)if(cookie)cookie.value='';
    try{cdp?.close();}catch{}
    if(child&&!child.killed){try{child.kill('SIGTERM');}catch{}}
    await new Promise(resolve=>setTimeout(resolve,150));
    try{rmSync(profile,{recursive:true,force:true});}catch{}
    stderr='';
  }
}

export function publicBrowserError(error){
  return safeCodes.has(error?.code)?error.code:'BROWSER_READ_FAILED';
}
