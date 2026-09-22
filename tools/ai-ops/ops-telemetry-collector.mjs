import {readFileSync,statSync,mkdirSync,writeFileSync,renameSync,rmSync,chmodSync,realpathSync} from 'node:fs';
import {dirname} from 'node:path';
import {userInfo} from 'node:os';
import {pathToFileURL} from 'node:url';
import {sanitizeOpsTelemetry} from '../../lib/ai/yandex-ops.js';

const LIFECYCLE='/var/lib/review-activator-ops/YANDEX_LIFECYCLE_STAGE16.json';
const SYNC='/var/lib/review-activator-ops/VPS09_LAST_SYNC.json';
const OUTPUT='/var/lib/review-activator-ops/YANDEX_AI_OPS_INPUT.json';
const fail=code=>{throw Object.assign(new Error(code),{code});};

export function isMainEntrypoint(metaUrl,argv1,{realpath=realpathSync}={}){
  if(typeof metaUrl!=='string'||typeof argv1!=='string'||!argv1)return false;
  try{return metaUrl===pathToFileURL(realpath(argv1)).href;}catch{return false;}
}
function readJson(path){
  const stat=statSync(path);
  if(!stat.isFile()||stat.uid!==0||stat.gid!==0||(stat.mode&0o077)!==0||stat.size<2||stat.size>65536)
    fail('AI_OPS_SOURCE_INVALID');
  let raw;
  try{
    raw=readFileSync(path);
    return {value:JSON.parse(raw.toString('utf8')),mtimeMs:stat.mtimeMs};
  }catch{fail('AI_OPS_SOURCE_INVALID');}
  finally{if(raw)raw.fill(0);}
}
const age=(timestamp,nowMs)=>{
  if(typeof timestamp!=='string'||!timestamp)return null;
  const at=Date.parse(timestamp);
  if(!Number.isFinite(at)||at>nowMs+60000)return null;
  return Math.max(0,Math.floor((nowMs-at)/1000));
};
const sourceAge=(mtimeMs,nowMs)=>Math.max(0,Math.floor((nowMs-mtimeMs)/1000));
const safeCode=value=>typeof value==='string'&&/^[A-Z0-9_]{1,64}$/.test(value)?value:null;
const state=(value,allowed,fallback='UNKNOWN')=>allowed.includes(value)?value:fallback;

export function buildOpsTelemetry({lifecycle,lifecycleMtimeMs,sync,syncMtimeMs,nowMs=Date.now()}){
  if(!lifecycle||typeof lifecycle!=='object'||Array.isArray(lifecycle)||
     lifecycle.operation!=='yandex_session_lifecycle'||lifecycle.telemetry_version!==1||
     !sync||typeof sync!=='object'||Array.isArray(sync))fail('AI_OPS_SOURCE_INVALID');
  const chain=lifecycle.chain&&typeof lifecycle.chain==='object'&&!Array.isArray(lifecycle.chain)?lifecycle.chain:{};
  const auth=state(chain.auth,['AUTH_OK','NOT_CHECKED'],'UNKNOWN');
  const csrf=state(chain.csrf,['CSRF_READY','NOT_CHECKED'],'UNKNOWN');
  const read=state(chain.read,['READ_OK','NOT_CHECKED'],'UNKNOWN');
  const lifecycleState=state(lifecycle.state,['MONITORING','READINESS_DUE','ROTATION_DUE','READY','DEGRADED','REAUTH_REQUIRED'],'DEGRADED');
  const rotation=state(lifecycle.rotation_state,['CURRENT','SOON','DUE','SESSION_BOUND'],'UNKNOWN');
  const fresh=state(lifecycle.freshness_state,['FRESH','SESSION_CHECK_DUE','SYNC_STALE'],'UNKNOWN');
  const result=state(sync.last_sync_result,['PASS','FAIL'],'UNKNOWN');
  const envelope={
    telemetry_version:1,
    lifecycle:{
      lifecycle_state:lifecycleState,
      auth_state:auth,
      browser_state:read==='READ_OK'?'READ_OK':read==='NOT_CHECKED'?'NOT_CHECKED':'UNKNOWN',
      csrf_state:csrf,
      read_state:read,
      rotation_state:rotation,
      freshness_state:fresh,
      session_revision:Number.isSafeInteger(Number(lifecycle.session_revision))?Number(lifecycle.session_revision):0,
      source_age_seconds:sourceAge(lifecycleMtimeMs,nowMs),
      min_cookie_ttl_seconds:Number.isSafeInteger(lifecycle.min_cookie_ttl_seconds)?lifecycle.min_cookie_ttl_seconds:null,
      expiring_6h_count:Number.isSafeInteger(lifecycle.expiring_within_6h)?lifecycle.expiring_within_6h:0,
      expiring_72h_count:Number.isSafeInteger(lifecycle.expiring_within_72h)?lifecycle.expiring_within_72h:0,
      provider_writes:Number.isSafeInteger(lifecycle.provider_writes)?lifecycle.provider_writes:0,
      queue_claims:Number.isSafeInteger(lifecycle.queue_claims)?lifecycle.queue_claims:0
    },
    sync:{
      result,
      failure_code:safeCode(sync.sync_failure),
      source_age_seconds:sourceAge(syncMtimeMs,nowMs),
      last_provider_read_age_seconds:age(sync.last_successful_provider_read,nowMs),
      last_persistence_age_seconds:age(sync.last_successful_persistence,nowMs)
    }
  };
  return sanitizeOpsTelemetry(envelope);
}
export function collectOpsTelemetry({now=Date.now}={}){
  const l=readJson(LIFECYCLE),s=readJson(SYNC);
  return buildOpsTelemetry({lifecycle:l.value,lifecycleMtimeMs:l.mtimeMs,
    sync:s.value,syncMtimeMs:s.mtimeMs,nowMs:now()});
}
export function persistOpsTelemetry(value,{path=OUTPUT}={}){
  const safe=sanitizeOpsTelemetry(value);
  mkdirSync(dirname(path),{recursive:true,mode:0o700});
  const tmp=path+'.tmp-'+process.pid;
  try{
    writeFileSync(tmp,JSON.stringify(safe)+'\n',{encoding:'utf8',mode:0o600,flag:'w'});
    chmodSync(tmp,0o600);renameSync(tmp,path);
  }finally{try{rmSync(tmp,{force:true});}catch{}}
}
if(isMainEntrypoint(import.meta.url,process.argv[1])){
  try{
    if(process.argv.length!==2||process.platform!=='linux'||userInfo().username!=='root')
      fail('AI_OPS_RUNTIME_INVALID');
    const telemetry=collectOpsTelemetry();persistOpsTelemetry(telemetry);
    process.stdout.write(JSON.stringify({ok:true,operation:'ai_ops_telemetry_collect',
      telemetry_version:1,provider_requests:0,provider_writes:0,queue_claims:0,
      lifecycle_state:telemetry.lifecycle.lifecycle_state,sync_result:telemetry.sync.result})+'\n');
  }catch(error){
    process.stdout.write(JSON.stringify({ok:false,operation:'ai_ops_telemetry_collect',
      error:['AI_OPS_SOURCE_INVALID','AI_OPS_INPUT_INVALID','AI_OPS_RUNTIME_INVALID'].includes(error?.code)
        ?error.code:'AI_OPS_COLLECT_FAILED',provider_requests:0,provider_writes:0,queue_claims:0})+'\n');
    process.exitCode=1;
  }
}
