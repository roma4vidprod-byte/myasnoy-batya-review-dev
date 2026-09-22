import {readFileSync,statSync,writeFileSync,renameSync,rmSync,chmodSync,existsSync,realpathSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {userInfo} from 'node:os';
import {pathToFileURL} from 'node:url';
import {buildRecoveryPlan,safeRecoveryResult,RECOVERY_POLICY_VERSION} from '../../lib/server/ai-ops-recovery.js';

const OPS='/var/lib/review-activator-ops';
const TELEMETRY=OPS+'/YANDEX_AI_OPS_INPUT.json';
const DECISION=OPS+'/YANDEX_AI_OPS_DECISION.json';
const STATE=OPS+'/YANDEX_RECOVERY_STAGE18.json';
const REQUEST=OPS+'/YANDEX_RECONCILIATION_REQUEST_STAGE18.json';
const ESCALATION=OPS+'/YANDEX_OPERATOR_ESCALATION_STAGE18.json';
const LIFECYCLE='/opt/review-activator-lifecycle/current/tools/vps16/session-lifecycle-manager.mjs';
const WRITER_ENV='/etc/review-activator-reply/writer.env';
const fail=code=>{throw Object.assign(new Error(code),{code});};

export function isMainEntrypoint(metaUrl,argv1,{realpath=realpathSync}={}){
  if(typeof metaUrl!=='string'||typeof argv1!=='string'||!argv1)return false;
  try{return metaUrl===pathToFileURL(realpath(argv1)).href;}catch{return false;}
}
function readRootJson(path,{optional=false,max=65536}={}){
  if(!existsSync(path)){if(optional)return null;fail('RECOVERY_INPUT_MISSING');}
  const s=statSync(path);
  if(!s.isFile()||s.uid!==0||s.gid!==0||(s.mode&0o077)!==0||s.size<2||s.size>max)
    fail('RECOVERY_INPUT_INVALID');
  let raw;
  try{
    raw=readFileSync(path);
    return {value:JSON.parse(raw.toString('utf8')),ageSeconds:Math.max(0,Math.floor((Date.now()-s.mtimeMs)/1000))};
  }catch{fail('RECOVERY_INPUT_INVALID');}
  finally{if(raw)raw.fill(0);}
}
function atomicWrite(path,value){
  const tmp=path+'.tmp-'+process.pid;
  try{
    writeFileSync(tmp,JSON.stringify(value)+'\n',{encoding:'utf8',mode:0o600,flag:'w'});
    chmodSync(tmp,0o600);renameSync(tmp,path);
  }finally{try{rmSync(tmp,{force:true});}catch{}}
}
function assertRuntimeGuards(){
  let env;
  try{env=readFileSync(WRITER_ENV,'utf8').trim();}catch{fail('RECOVERY_RUNTIME_UNSAFE');}
  if(env!=='RA_YANDEX_REPLY_WRITE_ENABLED=false')fail('RECOVERY_RUNTIME_UNSAFE');
  const active=spawnSync('/usr/bin/systemctl',['show','review-activator-reply.service','-p','ActiveState','--value'],
    {encoding:'utf8',timeout:5000});
  if(active.status!==0||String(active.stdout).trim()==='active')fail('RECOVERY_RUNTIME_UNSAFE');
}
function runLifecycleReadiness(){
  return new Promise((resolve,reject)=>{
    const child=spawn('/opt/node/bin/node',[LIFECYCLE],{
      env:{PATH:'/usr/bin:/bin',LANG:'C.UTF-8',RA_STAGE16_MODE:'readiness'},
      stdio:['ignore','pipe','pipe']
    });
    let out='',err='',done=false;
    const finish=(error,value)=>{
      if(done)return;done=true;clearTimeout(timer);
      out='';err='';error?reject(error):resolve(value);
    };
    const timer=setTimeout(()=>{try{child.kill('SIGKILL');}catch{}finish(Object.assign(new Error('RECOVERY_TIMEOUT'),{code:'RECOVERY_TIMEOUT'}));},90000);
    child.stdout.on('data',b=>{out+=b.toString('utf8');if(Buffer.byteLength(out)>32768)finish(Object.assign(new Error('RECOVERY_PROTOCOL_INVALID'),{code:'RECOVERY_PROTOCOL_INVALID'}));});
    child.stderr.on('data',b=>{if(err.length<4096)err+=b.toString('utf8');});
    child.on('error',()=>finish(Object.assign(new Error('RECOVERY_EXECUTION_FAILED'),{code:'RECOVERY_EXECUTION_FAILED'})));
    child.on('close',code=>{
      if(done)return;
      let value;try{value=JSON.parse(out.trim());}catch{return finish(Object.assign(new Error('RECOVERY_PROTOCOL_INVALID'),{code:'RECOVERY_PROTOCOL_INVALID'}));}
      if(code!==0||value?.ok!==true||value?.mode!=='readiness'||value?.state!=='READY'||
         value?.provider_writes!==0||value?.queue_claims!==0)
        return finish(Object.assign(new Error('RECOVERY_VERIFICATION_FAILED'),{code:'RECOVERY_VERIFICATION_FAILED'}));
      finish(null,{ok:true,state:'READY',provider_requests:Number(value.provider_requests??0),provider_writes:0,queue_claims:0});
    });
  });
}

function persistMarker(path,plan,status){
  const value={version:1,recovery_policy_version:RECOVERY_POLICY_VERSION,recovery_id:plan.recovery_id,
    classification:plan.classification,playbook_id:plan.playbook_id,reason_code:plan.reason_code,
    status,provider_write_authorized:false,no_retry:true,created_at:new Date().toISOString()};
  atomicWrite(path,value);return value;
}
export async function executeRecovery({
  telemetryPath=TELEMETRY,decisionPath=DECISION,statePath=STATE,
  requestPath=REQUEST,escalationPath=ESCALATION,
  runReadiness=runLifecycleReadiness,guard=assertRuntimeGuards,now=Date.now
}={}){
  const t=readRootJson(telemetryPath),d=readRootJson(decisionPath,{optional:true});
  if(!d)return Object.freeze({ok:true,operation:'ai_ops_recovery',state:'WAITING_DECISION',
    provider_writes:0,no_retry:true});
  const previous=readRootJson(statePath,{optional:true})?.value??null;
  const plan=buildRecoveryPlan({telemetry:t.value,decision:d.value,
    telemetryAgeSeconds:t.ageSeconds,decisionAgeSeconds:d.ageSeconds,previous});
  guard();
  if(plan.mode==='DEDUPLICATED'){
    const result=safeRecoveryResult(plan,null);atomicWrite(statePath,{...result,updated_at:new Date(now()).toISOString()});return result;
  }

  // Persist before any external recovery action. A crash after this point never retries this fingerprint.
  atomicWrite(statePath,{...plan,status:'EXECUTING',started_at:new Date(now()).toISOString()});
  try{
    let result;
    if(plan.mode==='READ_ONLY_AUTOMATIC'){
      result=safeRecoveryResult(plan,await runReadiness());
    }else if(plan.mode==='LOCAL_REQUEST'){
      persistMarker(requestPath,plan,'REQUESTED');
      result=safeRecoveryResult(plan,null);
    }else if(plan.mode==='ESCALATE'){
      persistMarker(escalationPath,plan,'ESCALATED');
      result=safeRecoveryResult(plan,null);
    }else{
      result=safeRecoveryResult(plan,null);
    }
    atomicWrite(statePath,{...result,finished_at:new Date(now()).toISOString()});
    return result;
  }catch(error){
    const failed={...plan,status:'FAILED',error:['RECOVERY_TIMEOUT','RECOVERY_PROTOCOL_INVALID',
      'RECOVERY_EXECUTION_FAILED','RECOVERY_VERIFICATION_FAILED'].includes(error?.code)?error.code:'RECOVERY_EXECUTION_FAILED',
      finished_at:new Date(now()).toISOString()};
    atomicWrite(statePath,failed);
    return Object.freeze(failed);
  }
}

const SAFE_ERRORS=new Set(['RECOVERY_INPUT_MISSING','RECOVERY_INPUT_INVALID','RECOVERY_DECISION_INVALID',
  'RECOVERY_TELEMETRY_MISMATCH','RECOVERY_STALE_INPUT','RECOVERY_UNSAFE_STATE','RECOVERY_PLAYBOOK_DENIED',
  'RECOVERY_RUNTIME_UNSAFE','RECOVERY_PLAN_INVALID']);

if(isMainEntrypoint(import.meta.url,process.argv[1])){
  try{
    if(process.argv.length!==2||process.platform!=='linux'||userInfo().username!=='root')
      fail('RECOVERY_RUNTIME_UNSAFE');
    const result=await executeRecovery();
    process.stdout.write(JSON.stringify({operation:'ai_ops_recovery',...result})+'\n');
    if(result.status==='FAILED')process.exitCode=1;
  }catch(error){
    const code=SAFE_ERRORS.has(error?.code)?error.code:'RECOVERY_FAILED';
    process.stdout.write(JSON.stringify({ok:false,operation:'ai_ops_recovery',state:'BLOCKED',
      error:code,provider_writes:0,no_retry:true})+'\n');
    process.exitCode=1;
  }
}
