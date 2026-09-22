import {spawn} from 'node:child_process';
import {mkdirSync,rmSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {userInfo} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createVpsSessionContext,VPS_SESSION_SCOPE} from '../../lib/server/yandex-session/profile-context.js';
import {createBrowserSessionStore} from '../yandex-server-browser/browser-session-store.mjs';
import {createBrowserSessionAdapter} from '../yandex-server-browser/browser-session-adapter.mjs';
import {createCdpPipe} from '../yandex-server-browser/chrome-pipe.mjs';

const BROWSER='/usr/bin/google-chrome-stable';
const ORG=VPS_SESSION_SCOPE.organizationId;
const PAGE='https://yandex.ru/sprav/'+ORG+'/p/edit/reviews/';
const EXPECTED_PATH='/sprav/'+ORG+'/p/edit/reviews/';
const MAX_BODY=4*1024*1024;
const fail=code=>{throw Object.assign(new Error(code),{code});};

function browserArgs(profile){return [
  '--headless=new','--remote-debugging-pipe','--disable-gpu','--disable-extensions','--disable-dev-shm-usage',
  '--no-first-run','--no-default-browser-check','--disable-background-networking',
  '--disable-component-update','--disable-domain-reliability','--disable-sync',
  '--metrics-recording-only','--disable-breakpad','--disable-features=MediaRouter,Translate,OptimizationHints',
  '--user-data-dir='+profile,'about:blank'
]}
function cookieForCdp(c){
  const out={name:c.name,value:c.value,domain:c.domain,path:c.path||'/',secure:c.secure===true,httpOnly:c.httpOnly===true};
  if(Number.isFinite(c.expires)&&c.expires>0)out.expires=c.expires;return out;
}
function waitFor(timeoutMs,code){
  let resolve,reject,timer;
  const promise=new Promise((res,rej)=>{resolve=res;reject=rej;timer=setTimeout(()=>rej(Object.assign(new Error(code),{code})),timeoutMs);});
  return {promise,resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}};
}
export function pathKind(raw){
  try{
    const u=new URL(raw);
    if(u.origin==='https://yandex.ru'&&u.pathname===EXPECTED_PATH)return 'EXPECTED_PAGE';
    if(u.origin==='https://passport.yandex.ru')return 'PASSPORT';
    if(u.origin==='https://yandex.ru'&&u.pathname.split('/').includes(ORG))return 'SAME_ORG_OTHER';
    if(u.hostname==='yandex.ru'||u.hostname.endsWith('.yandex.ru'))return 'YANDEX_OTHER';
    return 'FOREIGN';
  }catch{return 'UNKNOWN';}
}
function sameOrg(raw){
  try{return new URL(raw).pathname.split('/').includes(ORG);}catch{return false;}
}
function contentKind(mime){
  if(/^text\/html/i.test(mime||''))return 'HTML';
  if(/^application\/(?:[a-z0-9.-]+\+)?json/i.test(mime||''))return 'JSON';
  return mime?'OTHER':'UNKNOWN';
}
function scanBody(body){
  const lower=body.toLowerCase();
  const csrf=(body.match(/csrf/gi)||[]).length;
  const candidates=[...body.matchAll(/["']csrf["']\s*:\s*["']([^"'\\]{8,512})["']/g)].length;
  return {
    preload_marker:body.includes('__PRELOAD_DATA'),
    csrf_key_occurrences:csrf,csrf_candidate_count:candidates,
    challenge_marker:/smartcaptcha|captcha|challenge/.test(lower),
    login_marker:/passport\.yandex|login-form|auth-login/.test(lower)
  };
}
export function isMainEntrypoint(metaUrl,argv1,{realpath=realpathSync}={}){
  if(typeof metaUrl!=='string'||typeof argv1!=='string'||!argv1)return false;
  try{return metaUrl===pathToFileURL(realpath(argv1)).href;}catch{return false;}
}

export async function runBrowserContractProbe(){
  if(process.platform!=='linux'||userInfo().username!=='review-yandex-browser')fail('BROWSER_ROLE_DENIED');
  if(process.env.RA_RUNTIME_PROFILE!=='vps-lab'||process.env.RA_YANDEX_MODE!=='read-only-admin'||
     process.env.RA_YANDEX_REPLY_WRITE_ENABLED!==undefined)fail('BROWSER_RUNTIME_INVALID');
  if(process.env.RA_YANDEX_BROWSER_BIN!==BROWSER)fail('BROWSER_BINARY_INVALID');
  const runtime=process.env.RUNTIME_DIRECTORY;
  if(runtime!=='/run/review-yandex-contract-drift')fail('BROWSER_RUNTIME_INVALID');
  const profile=join(runtime,'profile');mkdirSync(profile,{mode:0o700});
  const context=createVpsSessionContext(),store=createBrowserSessionStore();
  const openSession=createBrowserSessionAdapter({store,context});
  let child,cdp,session,opened,targetSessionId=null,mainRequestId=null,stderr='';
  let documentRequests=0,blocked=0,blockedNonGet=0,replyEndpointAttempts=0;
  let httpStatus=null,mime='',finalUrl='',bodyBytes=null;
  const responseWait=waitFor(12000,'SERVER_CSRF_NAVIGATION_FAILED');
  const finishedWait=waitFor(12000,'SERVER_CSRF_NAVIGATION_FAILED');
  const base=()=>({
    error_code:null,http_status:httpStatus,content_type:contentKind(mime),
    final_path_kind:pathKind(finalUrl),same_org_segment:sameOrg(finalUrl),
    preload_marker:false,csrf_key_occurrences:0,csrf_candidate_count:0,
    challenge_marker:false,login_marker:false,document_requests:documentRequests,
    blocked_requests:blocked,blocked_non_get:blockedNonGet,
    reply_endpoint_attempts:replyEndpointAttempts,body_bytes:bodyBytes,
    session_revision:Number(opened?.stored?.revision??0),provider_writes:0
  });
  try{
    opened=await openSession();session=opened.session;
    child=spawn(BROWSER,browserArgs(profile),{
      env:{PATH:'/usr/bin:/bin',HOME:runtime,LANG:'C.UTF-8',TMPDIR:runtime},
      stdio:['ignore','ignore','pipe','pipe','pipe']
    });
    child.stdio[2].on('data',b=>{if(stderr.length<2048)stderr+=b.toString('utf8');});
    cdp=createCdpPipe({input:child.stdio[3],output:child.stdio[4],timeoutMs:8000,onEvent:async event=>{
      if(!targetSessionId||event.sessionId!==targetSessionId)return;
      if(event.method==='Fetch.requestPaused'){
        const req=event.params?.request||{},url=String(req.url||''),method=String(req.method||'');
        const resourceType=String(event.params?.resourceType||'');
        if(url.includes('/sprav/api/ugcpub/business-answer'))replyEndpointAttempts++;
        let allowed=false;
        if(resourceType==='Document'&&['GET','HEAD'].includes(method)){
          try{
            const u=new URL(url);
            allowed=u.protocol==='https:'&&(u.hostname==='yandex.ru'||u.hostname.endsWith('.yandex.ru'));
          }catch{}
        }
        if(allowed&&documentRequests<8){
          documentRequests++;
          await cdp.send('Fetch.continueRequest',{requestId:event.params.requestId},targetSessionId);
        }else{
          blocked++;if(!['GET','HEAD'].includes(method))blockedNonGet++;
          await cdp.send('Fetch.failRequest',{requestId:event.params.requestId,errorReason:'BlockedByClient'},targetSessionId);
        }
      }
      if(event.method==='Network.responseReceived'&&event.params?.type==='Document'){
        mainRequestId=event.params.requestId;
        const response=event.params.response||{};
        httpStatus=Number.isFinite(response.status)?Math.trunc(response.status):null;
        mime=String(response.mimeType||'');
        finalUrl=String(response.url||'');
        responseWait.resolve(true);
      }
      if(event.method==='Network.loadingFinished'&&mainRequestId&&event.params?.requestId===mainRequestId)
        finishedWait.resolve(true);
    }});
    const created=await cdp.send('Target.createTarget',{url:'about:blank'});
    const attached=await cdp.send('Target.attachToTarget',{targetId:created.targetId,flatten:true});
    if(typeof attached.sessionId!=='string')fail('BROWSER_CDP_PROTOCOL_INVALID');
    targetSessionId=attached.sessionId;
    await cdp.send('Network.enable',{},targetSessionId);
    await cdp.send('Page.enable',{},targetSessionId);
    await cdp.send('Runtime.enable',{},targetSessionId);
    await cdp.send('Emulation.setScriptExecutionDisabled',{value:true},targetSessionId);
    await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]},targetSessionId);
    await cdp.send('Network.setCookies',{cookies:session.cookies.map(cookieForCdp)},targetSessionId);
    const nav=await cdp.send('Page.navigate',{url:PAGE},targetSessionId);
    if(nav.errorText)return Object.freeze({...base(),result:'FAIL',error_code:'SERVER_CSRF_NAVIGATION_FAILED'});
    try{await responseWait.promise;await finishedWait.promise;}
    catch{return Object.freeze({...base(),result:'TIMEOUT',error_code:'SERVER_CSRF_NAVIGATION_FAILED'});}
    if(replyEndpointAttempts!==0)fail('CONTRACT_DRIFT_UNEXPECTED_REPLY_ENDPOINT');
    if(!mainRequestId)return Object.freeze({...base(),result:'FAIL',error_code:'CONTRACT_DRIFT_DOCUMENT_MISSING'});
    let bodyResult;
    try{bodyResult=await cdp.send('Network.getResponseBody',{requestId:mainRequestId},targetSessionId);}
    catch{return Object.freeze({...base(),result:'FAIL',error_code:'CONTRACT_DRIFT_BODY_UNAVAILABLE'});}
    let body=bodyResult?.base64Encoded?Buffer.from(bodyResult.body||'','base64').toString('utf8'):String(bodyResult?.body||'');
    bodyBytes=Buffer.byteLength(body,'utf8');
    if(bodyBytes>MAX_BODY){body='';return Object.freeze({...base(),result:'FAIL',error_code:'CONTRACT_DRIFT_BODY_TOO_LARGE'});}
    const scan=scanBody(body);body='';
    return Object.freeze({...base(),...scan,result:httpStatus===200?'PASS':'FAIL',
      error_code:httpStatus===200?null:'CONTRACT_DRIFT_HTTP_STATUS'});
  }finally{
    if(session?.cookies)for(const c of session.cookies)if(c)c.value='';
    try{cdp?.close();}catch{}
    if(child&&!child.killed){try{child.kill('SIGTERM');}catch{}}
    await new Promise(r=>setTimeout(r,150));
    try{rmSync(profile,{recursive:true,force:true});}catch{}
    stderr='';
  }
}

if(isMainEntrypoint(import.meta.url,process.argv[1])){
  try{
    if(process.argv.length!==2)fail('CONTRACT_DRIFT_ARGUMENTS_DENIED');
    process.stdout.write(JSON.stringify(await runBrowserContractProbe())+'\n');
  }catch(error){
    process.stdout.write(JSON.stringify({result:'FAIL',error_code:[
      'BROWSER_ROLE_DENIED','BROWSER_RUNTIME_INVALID','BROWSER_BINARY_INVALID','SESSION_NOT_READY',
      'SESSION_KEY_NOT_CONFIGURED','BROWSER_SESSION_READ_FAILED','BROWSER_CDP_PROTOCOL_INVALID',
      'CONTRACT_DRIFT_UNEXPECTED_REPLY_ENDPOINT','CONTRACT_DRIFT_ARGUMENTS_DENIED'
    ].includes(error?.code)?error.code:'CONTRACT_DRIFT_BROWSER_FAILED',
      http_status:null,content_type:'UNKNOWN',final_path_kind:'UNKNOWN',same_org_segment:false,
      preload_marker:false,csrf_key_occurrences:0,csrf_candidate_count:0,challenge_marker:false,login_marker:false,
      document_requests:0,blocked_requests:0,blocked_non_get:0,reply_endpoint_attempts:0,body_bytes:null,
      session_revision:0,provider_writes:0})+'\n');
    process.exitCode=1;
  }
}
