import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {userInfo} from 'node:os';
import {VPS_SESSION_SCOPE,createVpsSessionContext} from '../../lib/server/yandex-session/profile-context.js';
import {createBrowserSessionStore} from './browser-session-store.mjs';
import {createBrowserSessionAdapter} from './browser-session-adapter.mjs';
import {createCdpPipe} from './chrome-pipe.mjs';

const ORG=VPS_SESSION_SCOPE.organizationId;
const PAGE=`https://yandex.ru/sprav/${ORG}/p/edit/reviews/`;
const BROWSER='/usr/bin/google-chrome-stable';
const NONCE=/^[A-Za-z0-9+/]{43}=$/;
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

export function validatePublicChallenge(value,{now=Date.now()}={}){
  if(!value||typeof value!=='object'||Array.isArray(value)||
     Object.keys(value).sort().join()!=='expiresAt,nonce,version'||
     value.version!==1||typeof value.nonce!=='string'||!NONCE.test(value.nonce)||
     !Number.isSafeInteger(value.expiresAt)||value.expiresAt<=now||value.expiresAt>now+120000)
    fail('SERVER_CSRF_CHALLENGE_INVALID');
  return value;
}
export function validatePreloadResult(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||
     typeof value.token!=='string'||value.token.length<8||value.token.length>1024||
     !/^[\x21-\x7e]+$/.test(value.token)||String(value.permanentId??'')!==ORG)
    fail('SERVER_CSRF_VALUE_INVALID');
  return value.token;
}
async function readOneJsonLine(){
  const rl=createInterface({input:process.stdin,crlfDelay:Infinity});
  try{
    const it=rl[Symbol.asyncIterator]();const next=await it.next();
    if(next.done||typeof next.value!=='string'||Buffer.byteLength(next.value,'utf8')>2048)
      fail('SERVER_CSRF_CHALLENGE_INVALID');
    return JSON.parse(next.value);
  }catch(error){
    if(error?.code)throw error;fail('SERVER_CSRF_CHALLENGE_INVALID');
  }finally{rl.close();}
}

function waitFor(timeoutMs,code){
  let resolve,reject,timer;
  const promise=new Promise((res,rej)=>{
    resolve=res;reject=rej;
    timer=setTimeout(()=>rej(Object.assign(new Error(code),{code})),timeoutMs);
  });
  return {promise,resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}};
}
function preloadExpression(){
  return `(()=>{
    const token=globalThis?.__PRELOAD_DATA?.initialState?.env?.csrf??null;
    const permanentId=globalThis?.__PRELOAD_DATA?.initialState?.edit?.company?.permanent_id??null;
    return {token:typeof token==='string'?token:null,permanentId:permanentId==null?null:String(permanentId)};
  })()`;
}

export async function resolveServerCsrf({challenge,now=Date.now}={}){
  const validated=validatePublicChallenge(challenge,{now:now()});
  if(process.platform!=='linux'||userInfo().username!=='review-yandex-browser')fail('BROWSER_ROLE_DENIED');
  if(process.env.RA_RUNTIME_PROFILE!=='vps-lab'||process.env.RA_YANDEX_MODE!=='read-only-admin'||
     process.env.RA_YANDEX_REPLY_WRITE_ENABLED!==undefined)fail('BROWSER_RUNTIME_INVALID');
  if(process.env.RA_YANDEX_BROWSER_BIN!==BROWSER)fail('BROWSER_BINARY_INVALID');
  const runtime=process.env.RUNTIME_DIRECTORY;
  if(runtime!=='/run/review-yandex-csrf')fail('BROWSER_RUNTIME_INVALID');
  const profile=join(runtime,'profile');mkdirSync(profile,{mode:0o700});
  const context=createVpsSessionContext();
  const store=createBrowserSessionStore();
  const openSession=createBrowserSessionAdapter({store,context});
  let child,cdp,session,opened,allowed=0,blocked=0,blockedNonGet=0,replyEndpointAttempts=0;
  let targetSessionId=null,mainRequestId=null,responseStatus=null;
  const responseWait=waitFor(12000,'SERVER_CSRF_NAVIGATION_FAILED');
  const finishedWait=waitFor(12000,'SERVER_CSRF_NAVIGATION_FAILED');
  try{
    opened=await openSession();session=opened.session;
    child=spawn(BROWSER,browserArgs(profile),{
      env:{PATH:'/usr/bin:/bin',HOME:runtime,LANG:'C.UTF-8',TMPDIR:runtime},
      stdio:['ignore','ignore','ignore','pipe','pipe']
    });
    cdp=createCdpPipe({input:child.stdio[3],output:child.stdio[4],timeoutMs:8000,onEvent:async event=>{
      if(!targetSessionId||event.sessionId!==targetSessionId)return;
      if(event.method==='Fetch.requestPaused'){
        const request=event.params?.request||{};
        const url=String(request.url||''),method=String(request.method||'');
        if(url.includes('/sprav/api/ugcpub/business-answer'))replyEndpointAttempts++;
        if(method==='GET'&&url===PAGE){
          allowed++;await cdp.send('Fetch.continueRequest',{requestId:event.params.requestId},targetSessionId);
        }else{
          blocked++;if(!['GET','HEAD'].includes(method))blockedNonGet++;
          await cdp.send('Fetch.failRequest',{requestId:event.params.requestId,errorReason:'BlockedByClient'},targetSessionId);
        }
      }
      if(event.method==='Network.responseReceived'&&event.params?.response?.url===PAGE){
        mainRequestId=event.params.requestId;responseStatus=event.params.response.status;
        responseWait.resolve(true);
      }
      if(event.method==='Network.loadingFinished'&&mainRequestId&&event.params?.requestId===mainRequestId){
        finishedWait.resolve(true);
      }
    }});
    const created=await cdp.send('Target.createTarget',{url:'about:blank'});
    if(typeof created.targetId!=='string')fail('BROWSER_CDP_PROTOCOL_INVALID');
    const attached=await cdp.send('Target.attachToTarget',{targetId:created.targetId,flatten:true});
    if(typeof attached.sessionId!=='string')fail('BROWSER_CDP_PROTOCOL_INVALID');
    targetSessionId=attached.sessionId;
    await cdp.send('Network.enable',{},targetSessionId);
    await cdp.send('Page.enable',{},targetSessionId);
    await cdp.send('Runtime.enable',{},targetSessionId);
    await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]},targetSessionId);
    await cdp.send('Network.setCookies',{cookies:session.cookies.map(cookieForCdp)},targetSessionId);
    const navigation=await cdp.send('Page.navigate',{url:PAGE},targetSessionId);
    if(navigation.errorText)fail('SERVER_CSRF_NAVIGATION_FAILED');
    await responseWait.promise;await finishedWait.promise;
    if(responseStatus!==200||allowed!==1||replyEndpointAttempts!==0)
      fail('SERVER_CSRF_NETWORK_CONTRACT_INVALID');
    await new Promise(resolve=>setTimeout(resolve,150));
    const evaluated=await cdp.send('Runtime.evaluate',{expression:preloadExpression(),returnByValue:true,awaitPromise:false},targetSessionId);
    const preload=evaluated?.result?.value;
    let token=validatePreloadResult(preload);
    if(now()>=validated.expiresAt)fail('SERVER_CSRF_CHALLENGE_EXPIRED');
    const handoff={version:1,op:'csrf_handoff',nonce:validated.nonce,organizationId:ORG,token};
    process.stdout.write(JSON.stringify(handoff)+'\n');
    token='';
    process.stdout.write(JSON.stringify({
      ok:true,operation:'server_csrf_resolver',state:'CSRF_READY',
      organization_id:ORG,session_revision:Number(opened.stored.revision),
      provider_requests:1,provider_writes:0,blocked_requests:blocked,
      blocked_non_get:blockedNonGet,reply_endpoint_attempts:replyEndpointAttempts,
      profile_persistent:false
    })+'\n');
    return true;
  }finally{
    if(session?.cookies)for(const cookie of session.cookies)if(cookie)cookie.value='';
    try{cdp?.close();}catch{}
    if(child&&!child.killed){try{child.kill('SIGTERM');}catch{}}
    await new Promise(resolve=>setTimeout(resolve,150));
    try{rmSync(profile,{recursive:true,force:true});}catch{}
  }
}

if(import.meta.url===`file://${process.argv[1]}`){
  try{
    const challenge=await readOneJsonLine();
    await resolveServerCsrf({challenge});
  }catch(error){
    process.stderr.write(String(error?.code||'SERVER_CSRF_FAILED')+'\n');
    process.exitCode=1;
  }
}
