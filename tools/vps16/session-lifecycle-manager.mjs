import {spawn,spawnSync} from 'node:child_process';
import {createInterface} from 'node:readline';
import {mkdirSync,realpathSync,renameSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {userInfo} from 'node:os';
import {pathToFileURL} from 'node:url';

const ORG='54309413522';
const STATE_PATH='/var/lib/review-activator-ops/YANDEX_LIFECYCLE_STAGE16.json';
const SNAPSHOT_UNIT=`review-yandex-stage16-snapshot-${process.pid}.service`;
const READ_UNIT=`review-yandex-stage16-read-${process.pid}.service`;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const SAFE_ERRORS=new Set([
  'LIFECYCLE_REQUEST_INVALID','LIFECYCLE_TIMEOUT','LIFECYCLE_PROTOCOL_INVALID',
  'LIFECYCLE_SESSION_UNAVAILABLE','LIFECYCLE_CSRF_UNAVAILABLE','LIFECYCLE_READ_UNAVAILABLE',
  'LIFECYCLE_SESSION_CHANGED','LIFECYCLE_TELEMETRY_UNSAFE'
]);

export const LIFECYCLE_ACTIONS=Object.freeze({
  RUN_READINESS:Object.freeze({kind:'READ_ONLY_CHECK',provider_write:false,automatic:false}),
  ROTATE_SESSION:Object.freeze({kind:'SESSION_ROTATION',provider_write:false,automatic:false}),
  OPERATOR_REAUTH:Object.freeze({kind:'HUMAN_FALLBACK',provider_write:false,automatic:false}),
  CONTRACT_DIAGNOSTIC:Object.freeze({kind:'READ_ONLY_DIAGNOSTIC',provider_write:false,automatic:false})
});

export function isMainEntrypoint(metaUrl,argv1,{realpath=realpathSync}={}){
  if(typeof metaUrl!=='string'||typeof argv1!=='string'||!argv1)return false;
  try{return metaUrl===pathToFileURL(realpath(argv1)).href;}catch{return false;}
}

function systemdBase(user,unit){return [
  '--quiet','--wait','--collect','--pipe','--service-type=exec',`--unit=${unit}`,
  `--uid=${user}`,`--gid=${user}`,'-p','NoNewPrivileges=yes',
  '-p','ProtectSystem=strict','-p','ProtectHome=yes','-p','PrivateTmp=yes',
  '-p','PrivateDevices=yes','-p','CapabilityBoundingSet='
];}

function snapshotArgs(){
  const a=systemdBase('review-yandex-browser',SNAPSHOT_UNIT);
  a.push('-p','PrivateNetwork=yes',
    '-p','LoadCredential=yandex-session-key:/etc/review-activator-yandex/session-key.json',
    '-p','RuntimeDirectory=review-yandex-lifecycle','-p','RuntimeDirectoryMode=0700',
    '-E','RA_RUNTIME_PROFILE=vps-lab','-E','RA_YANDEX_MODE=read-only-admin',
    '-E','RA_STAGE16_LIFECYCLE=snapshot','/opt/node/bin/node',
    '/opt/review-activator-yandex-browser/current/tools/yandex-server-browser/session-lifecycle-snapshot.mjs');
  return a;
}

function readArgs(){
  const a=systemdBase('review-yandex-browser',READ_UNIT);
  a.push('-p','RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6',
    '-p','LoadCredential=yandex-session-key:/etc/review-activator-yandex/session-key.json',
    '-p','RuntimeDirectory=review-yandex-browser','-p','RuntimeDirectoryMode=0700',
    '-E','RA_RUNTIME_PROFILE=vps-lab','-E','RA_YANDEX_MODE=read-only-admin',
    '-E','RA_YANDEX_BROWSER_BIN=/usr/bin/google-chrome-stable','/opt/node/bin/node',
    '/opt/review-activator-yandex-browser/current/tools/yandex-server-browser/browser-once.mjs');
  return a;
}

function cleanupUnits(){
  for(const unit of [SNAPSHOT_UNIT,READ_UNIT]){
    try{spawnSync('/usr/bin/systemctl',['stop',unit],{stdio:'ignore',timeout:5000});}catch{}
    try{spawnSync('/usr/bin/systemctl',['reset-failed',unit],{stdio:'ignore',timeout:5000});}catch{}
  }
}

function runJson(command,args,{input='',timeoutMs=30000}={}){
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8'},stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='',closed=false;
    const done=(error,value)=>{
      if(closed)return;closed=true;clearTimeout(timer);stdout='';stderr='';
      error?reject(Object.assign(new Error(error),{code:error})):resolve(value);
    };
    const timer=setTimeout(()=>{try{child.kill('SIGKILL');}catch{}done('LIFECYCLE_TIMEOUT');},timeoutMs);
    child.stdout.on('data',b=>{stdout+=b.toString('utf8');if(Buffer.byteLength(stdout)>32768)done('LIFECYCLE_PROTOCOL_INVALID');});
    child.stderr.on('data',b=>{if(stderr.length<4096)stderr+=b.toString('utf8');});
    child.on('error',()=>done('LIFECYCLE_PROTOCOL_INVALID'));
    child.on('close',code=>{
      if(closed)return;
      const lines=stdout.trim().split(/\r?\n/).filter(Boolean);
      if(lines.length!==1)return done('LIFECYCLE_PROTOCOL_INVALID');
      let value;try{value=JSON.parse(lines[0]);}catch{return done('LIFECYCLE_PROTOCOL_INVALID');}
      if(!value||typeof value!=='object'||Array.isArray(value))return done('LIFECYCLE_PROTOCOL_INVALID');
      if(code!==0&&value.ok!==false)return done('LIFECYCLE_PROTOCOL_INVALID');
      done(null,value);
    });
    child.stdin.end(input);
  });
}

function validateSnapshot(v){
  if(v?.ok!==true||v.operation!=='session_lifecycle_snapshot'||v.state!=='SESSION_READY'||
     v.organization_id!==ORG||!Number.isSafeInteger(Number(v.session_revision))||Number(v.session_revision)<1||
     v.provider_requests!==0||v.provider_writes!==0||v.credential_version_present!==true||
     !Number.isSafeInteger(v.cookie_count)||v.cookie_count<1||
     !['CURRENT','SOON','DUE','SESSION_BOUND'].includes(v.rotation_state))
    fail('LIFECYCLE_SESSION_UNAVAILABLE');
  return v;
}

function validateCsrf(v){
  if(v?.ok!==true||v.mode!=='readiness'||v.state!=='SERVER_CSRF_READY'||v.organization_id!==ORG||
     !Number.isSafeInteger(Number(v.session_revision))||v.browser_provider_requests!==1||
     v.writer_provider_requests!==0||v.provider_writes!==0||v.queue_claims!==0||
     v.action_binding!==true||v.session_match!==true||v.profile_persistent!==false)
    fail('LIFECYCLE_CSRF_UNAVAILABLE');
  return v;
}

function validateRead(v){
  if(v?.ok!==true||v.operation!=='server_browser_read'||v.state!=='BROWSER_READY'||v.organization_id!==ORG||
     !Number.isSafeInteger(Number(v.session_revision))||v.provider_requests!==1||v.provider_writes!==0||
     v.reply_endpoint_attempts!==0||v.profile_persistent!==false||v.sandbox_disabled!==false)
    fail('LIFECYCLE_READ_UNAVAILABLE');
  return v;
}

function freshness(snapshot){
  const check=snapshot.last_session_check_age_seconds;
  const sync=snapshot.last_successful_sync_age_seconds;
  if(check===null||check>86400)return 'SESSION_CHECK_DUE';
  if(sync===null||sync>10800)return 'SYNC_STALE';
  return 'FRESH';
}

export function classifyLifecycle({mode,snapshot,csrf=null,read=null}){
  const s=validateSnapshot(snapshot);
  const fresh=freshness(s);
  const actions=[];
  if(s.rotation_state==='DUE')actions.push('ROTATE_SESSION');
  if(mode==='snapshot'){
    if(fresh!=='FRESH')actions.push('RUN_READINESS');
    const unique=[...new Set(actions)];
    return Object.freeze({
      ok:true,operation:'yandex_session_lifecycle',telemetry_version:1,mode:'snapshot',
      state:s.rotation_state==='DUE'?'ROTATION_DUE':fresh==='FRESH'?'MONITORING':'READINESS_DUE',
      ready:null,organization_id:ORG,session_revision:Number(s.session_revision),
      chain:Object.freeze({auth:'NOT_CHECKED',session:'SESSION_READY',csrf:'NOT_CHECKED',read:'NOT_CHECKED'}),
      rotation_state:s.rotation_state,freshness_state:fresh,
      cookie_count:s.cookie_count,persistent_cookie_count:s.persistent_cookie_count,
      session_cookie_count:s.session_cookie_count,min_cookie_ttl_seconds:s.min_cookie_ttl_seconds,
      max_cookie_ttl_seconds:s.max_cookie_ttl_seconds,expiring_within_6h:s.expiring_within_6h,
      expiring_within_72h:s.expiring_within_72h,
      last_session_check_age_seconds:s.last_session_check_age_seconds,
      last_successful_sync_age_seconds:s.last_successful_sync_age_seconds,
      provider_requests:0,provider_writes:0,queue_claims:0,allowed_action_ids:unique
    });
  }
  if(mode!=='readiness')fail('LIFECYCLE_REQUEST_INVALID');
  const c=validateCsrf(csrf),r=validateRead(read);
  if(Number(c.session_revision)!==Number(s.session_revision)||Number(r.session_revision)!==Number(s.session_revision))
    fail('LIFECYCLE_SESSION_CHANGED');
  return Object.freeze({
    ok:true,operation:'yandex_session_lifecycle',telemetry_version:1,mode:'readiness',
    state:'READY',ready:true,organization_id:ORG,session_revision:Number(s.session_revision),
    chain:Object.freeze({auth:'AUTH_OK',session:'SESSION_READY',csrf:'CSRF_READY',read:'READ_OK'}),
    rotation_state:s.rotation_state,freshness_state:fresh,
    cookie_count:s.cookie_count,persistent_cookie_count:s.persistent_cookie_count,
    session_cookie_count:s.session_cookie_count,min_cookie_ttl_seconds:s.min_cookie_ttl_seconds,
    max_cookie_ttl_seconds:s.max_cookie_ttl_seconds,expiring_within_6h:s.expiring_within_6h,
    expiring_within_72h:s.expiring_within_72h,
    last_session_check_age_seconds:s.last_session_check_age_seconds,
    last_successful_sync_age_seconds:s.last_successful_sync_age_seconds,
    provider_requests:2,provider_writes:0,queue_claims:0,
    allowed_action_ids:[...new Set(actions)]
  });
}

export function assertSafeTelemetry(value){
  const forbidden=/password|cookie_(?:name|value)|csrf_(?:value|token)|credential_version$|envelope|ciphertext|authorization|session_key/i;
  const visit=(v)=>{
    if(v&&typeof v==='object'){
      for(const [k,item] of Object.entries(v)){
        if(forbidden.test(k))fail('LIFECYCLE_TELEMETRY_UNSAFE');
        visit(item);
      }
    }else if(typeof v==='string'&&v.length>512)fail('LIFECYCLE_TELEMETRY_UNSAFE');
  };
  visit(value);return value;
}

export function persistLifecycleTelemetry(value,{path=STATE_PATH}={}){
  assertSafeTelemetry(value);
  mkdirSync(dirname(path),{recursive:true,mode:0o700});
  const tmp=path+'.tmp-'+process.pid;
  writeFileSync(tmp,JSON.stringify(value)+'\n',{encoding:'utf8',mode:0o600});
  renameSync(tmp,path);
}

async function defaultSnapshot(){
  return await runJson('/usr/bin/systemd-run',snapshotArgs(),{timeoutMs:20000});
}
async function defaultCsrf(){
  return await runJson('/opt/node/bin/node',
    ['/opt/review-activator-server-reply/current/tools/vps15/server-reply-orchestrator.mjs'],
    {input:'{"version":1,"mode":"readiness"}\n',timeoutMs:45000});
}
async function defaultRead(){
  return await runJson('/usr/bin/systemd-run',readArgs(),{timeoutMs:35000});
}

export async function runLifecycle(mode,{snapshot=defaultSnapshot,csrf=defaultCsrf,read=defaultRead,
  persist=persistLifecycleTelemetry}={}){
  if(!['snapshot','readiness'].includes(mode))fail('LIFECYCLE_REQUEST_INVALID');
  if(snapshot===defaultSnapshot)cleanupUnits();
  try{
    const s=await snapshot();
    const result=mode==='snapshot'?classifyLifecycle({mode,snapshot:s}):
      classifyLifecycle({mode,snapshot:s,csrf:await csrf(),read:await read()});
    assertSafeTelemetry(result);persist(result);return result;
  }finally{if(snapshot===defaultSnapshot)cleanupUnits();}
}

if(isMainEntrypoint(import.meta.url,process.argv[1])){
  let result;
  try{
    if(process.argv.length!==2||process.platform!=='linux'||userInfo().username!=='root')
      fail('LIFECYCLE_REQUEST_INVALID');
    result=await runLifecycle(process.env.RA_STAGE16_MODE);
  }catch(error){
    const code=SAFE_ERRORS.has(error?.code)?error.code:'LIFECYCLE_FAILED';
    result={ok:false,operation:'yandex_session_lifecycle',telemetry_version:1,
      mode:['snapshot','readiness'].includes(process.env.RA_STAGE16_MODE)?process.env.RA_STAGE16_MODE:null,
      state:code==='LIFECYCLE_SESSION_UNAVAILABLE'?'REAUTH_REQUIRED':'DEGRADED',
      ready:false,error:code,provider_writes:0,queue_claims:0,
      allowed_action_ids:code==='LIFECYCLE_SESSION_UNAVAILABLE'?['OPERATOR_REAUTH']:['RUN_READINESS']};
    try{assertSafeTelemetry(result);persistLifecycleTelemetry(result);}catch{}
    process.exitCode=1;
  }
  process.stdout.write(JSON.stringify(result)+'\n');
}
