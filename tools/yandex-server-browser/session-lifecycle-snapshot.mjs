import {realpathSync} from 'node:fs';
import {userInfo} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createVpsSessionContext,VPS_SESSION_SCOPE} from '../../lib/server/yandex-session/profile-context.js';
import {createBrowserSessionStore} from './browser-session-store.mjs';
import {createBrowserSessionAdapter} from './browser-session-adapter.mjs';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const SAFE_ERRORS=new Set([
  'BROWSER_ROLE_DENIED','BROWSER_RUNTIME_INVALID','SESSION_NOT_READY',
  'SESSION_KEY_NOT_CONFIGURED','SESSION_DECRYPT_FAILED','BROWSER_SESSION_READ_FAILED'
]);
const SIX_HOURS=6*60*60;
const THREE_DAYS=3*24*60*60;

export function isMainEntrypoint(metaUrl,argv1,{realpath=realpathSync}={}){
  if(typeof metaUrl!=='string'||typeof argv1!=='string'||!argv1)return false;
  try{return metaUrl===pathToFileURL(realpath(argv1)).href;}catch{return false;}
}

function ageSeconds(value,nowMs){
  if(typeof value!=='string'||!value)return null;
  const at=Date.parse(value);
  if(!Number.isFinite(at)||at>nowMs+60000)return null;
  return Math.max(0,Math.floor((nowMs-at)/1000));
}

export function summarizeSessionLifecycle({stored,session,nowMs=Date.now()}={}){
  if(!stored||stored.state!=='READY'||!Number.isSafeInteger(Number(stored.revision))||Number(stored.revision)<1)
    fail('SESSION_NOT_READY');
  if(!session||!Array.isArray(session.cookies)||session.cookies.length<1)
    fail('SESSION_DECRYPT_FAILED');
  const ttls=session.cookies
    .filter(c=>Number.isFinite(c?.expires)&&c.expires>0)
    .map(c=>Math.max(0,Math.floor(c.expires-nowMs/1000)));
  const sessionCookies=session.cookies.filter(c=>c?.expires==null||c.expires===-1).length;
  const minTtl=ttls.length?Math.min(...ttls):null;
  const maxTtl=ttls.length?Math.max(...ttls):null;
  const rotationState=minTtl===null?'SESSION_BOUND':
    minTtl<=SIX_HOURS?'DUE':
    minTtl<=THREE_DAYS?'SOON':'CURRENT';
  return Object.freeze({
    ok:true,operation:'session_lifecycle_snapshot',state:'SESSION_READY',
    organization_id:VPS_SESSION_SCOPE.organizationId,
    session_revision:Number(stored.revision),
    credential_version_present:typeof stored.credential_version==='string',
    cookie_count:session.cookies.length,
    persistent_cookie_count:ttls.length,
    session_cookie_count:sessionCookies,
    min_cookie_ttl_seconds:minTtl,
    max_cookie_ttl_seconds:maxTtl,
    expiring_within_6h:ttls.filter(v=>v<=SIX_HOURS).length,
    expiring_within_72h:ttls.filter(v=>v<=THREE_DAYS).length,
    rotation_state:rotationState,
    last_session_check_age_seconds:ageSeconds(stored.last_session_check_at,nowMs),
    last_successful_sync_age_seconds:ageSeconds(stored.last_successful_sync_at,nowMs),
    provider_requests:0,provider_writes:0
  });
}

export async function runSessionLifecycleSnapshot({now=Date.now,createStore=createBrowserSessionStore,
  createAdapter=createBrowserSessionAdapter}={}){
  if(process.platform!=='linux'||userInfo().username!=='review-yandex-browser')fail('BROWSER_ROLE_DENIED');
  if(process.env.RA_RUNTIME_PROFILE!=='vps-lab'||process.env.RA_YANDEX_MODE!=='read-only-admin'||
     process.env.RA_STAGE16_LIFECYCLE!=='snapshot'||process.env.RA_YANDEX_REPLY_WRITE_ENABLED!==undefined)
    fail('BROWSER_RUNTIME_INVALID');
  if(process.env.RUNTIME_DIRECTORY!=='/run/review-yandex-lifecycle')fail('BROWSER_RUNTIME_INVALID');
  const context=createVpsSessionContext();
  const store=createStore();
  const open=createAdapter({store,context,now});
  let opened;
  try{
    opened=await open();
    return summarizeSessionLifecycle({stored:opened.stored,session:opened.session,nowMs:now()});
  }finally{
    if(opened?.session?.cookies)for(const cookie of opened.session.cookies)if(cookie)cookie.value='';
  }
}

if(isMainEntrypoint(import.meta.url,process.argv[1])){
  try{
    if(process.argv.length!==2)fail('BROWSER_RUNTIME_INVALID');
    process.stdout.write(JSON.stringify(await runSessionLifecycleSnapshot())+'\n');
  }catch(error){
    process.stdout.write(JSON.stringify({ok:false,operation:'session_lifecycle_snapshot',
      error:SAFE_ERRORS.has(error?.code)?error.code:'SESSION_LIFECYCLE_SNAPSHOT_FAILED',
      provider_requests:0,provider_writes:0})+'\n');
    process.exitCode=1;
  }
}
