import {readFileSync,existsSync,statSync,realpathSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {userInfo} from 'node:os';
import {sanitizeOpsTelemetry} from '../../lib/ai/yandex-ops.js';
import {executeRecovery} from './recovery-orchestrator.mjs';

const INPUT='/var/lib/review-activator-ops/YANDEX_AI_OPS_INPUT.json';
const DECISION='/var/lib/review-activator-ops/YANDEX_AI_OPS_DECISION.json';
const KEY='/etc/review-activator-ai/openai-api-key';
const fail=code=>{throw Object.assign(new Error(code),{code});};

function systemctl(args){
  const r=spawnSync('/usr/bin/systemctl',args,{encoding:'utf8',timeout:40000});
  return {ok:r.status===0,status:r.status,stdout:String(r.stdout||'').trim(),stderr:String(r.stderr||'').trim()};
}
function telemetryHash(){
  const s=statSync(INPUT);
  if(!s.isFile()||s.uid!==0||s.gid!==0||(s.mode&0o077)!==0||s.size<2||s.size>32768)fail('RECOVERY_CYCLE_INPUT_INVALID');
  let raw;
  try{raw=readFileSync(INPUT);const t=sanitizeOpsTelemetry(JSON.parse(raw.toString('utf8')));
    return createHash('sha256').update(JSON.stringify(t)).digest('hex');
  }catch(error){if(error?.code)throw error;fail('RECOVERY_CYCLE_INPUT_INVALID');}
  finally{if(raw)raw.fill(0);}
}
function decisionFresh(hash){
  if(!existsSync(DECISION))return false;
  try{
    const s=statSync(DECISION);
    if(!s.isFile()||s.uid!==0||s.gid!==0||(s.mode&0o077)!==0||s.size<2||s.size>32768||
       Date.now()-s.mtimeMs>1800000)return false;
    const v=JSON.parse(readFileSync(DECISION,'utf8'));
    return v?.ok===true&&v.telemetry_hash===hash&&v.execution_authorized===false&&v.provider_write_authorized===false;
  }catch{return false;}
}

export async function runRecoveryCycle({startUnit=systemctl,recover=executeRecovery,
  getHash=telemetryHash,hasKey=()=>existsSync(KEY),hasFreshDecision=decisionFresh}={}){
  let hash=null,reused=false,classificationRun=false;
  try{hash=getHash();reused=hasFreshDecision(hash);}catch{}
  if(!reused){
    const collected=startUnit(['start','review-ai-ops-collect.service']);
    if(!collected.ok)fail('RECOVERY_CYCLE_COLLECT_FAILED');
    hash=getHash();
    reused=hasFreshDecision(hash);
    if(!reused){
      if(!hasKey()){
        return Object.freeze({ok:true,operation:'ai_ops_recovery_cycle',state:'WAITING_AI_CONFIGURATION',
          telemetry_hash:hash,classification_run:false,recovery_run:false,provider_writes:0,no_retry:true});
      }
      const ai=startUnit(['start','review-ai-ops.service']);
      if(!ai.ok){
        return Object.freeze({ok:true,operation:'ai_ops_recovery_cycle',state:'WAITING_AI_SERVICE',
          telemetry_hash:hash,classification_run:false,recovery_run:false,provider_writes:0,no_retry:true});
      }
      const classified=startUnit(['start','review-ai-ops-once.service']);
      if(!classified.ok)fail('RECOVERY_CYCLE_CLASSIFICATION_FAILED');
      if(!hasFreshDecision(hash))fail('RECOVERY_CYCLE_DECISION_INVALID');
      classificationRun=true;
    }
  }
  const result=await recover();
  return Object.freeze({ok:result?.ok===true,operation:'ai_ops_recovery_cycle',
    state:result?.status??result?.state??'UNKNOWN',telemetry_hash:hash,
    classification_run:classificationRun,recovery_run:true,provider_writes:0,no_retry:true,
    playbook_id:result?.playbook_id??null,recovery_id:result?.recovery_id??null});
}

function isMainEntrypoint(metaUrl,argv1){
  if(typeof metaUrl!=='string'||typeof argv1!=='string'||!argv1)return false;
  try{return metaUrl===pathToFileURL(realpathSync(argv1)).href;}catch{return false;}
}
if(isMainEntrypoint(import.meta.url,process.argv[1])){
  try{
    if(process.argv.length!==2||process.platform!=='linux'||userInfo().username!=='root')
      fail('RECOVERY_CYCLE_RUNTIME_INVALID');
    const result=await runRecoveryCycle();
    process.stdout.write(JSON.stringify(result)+'\n');
    if(!result.ok)process.exitCode=1;
  }catch(error){
    const safe=['RECOVERY_CYCLE_INPUT_INVALID','RECOVERY_CYCLE_COLLECT_FAILED','RECOVERY_CYCLE_CLASSIFICATION_FAILED',
      'RECOVERY_CYCLE_DECISION_INVALID','RECOVERY_CYCLE_RUNTIME_INVALID'].includes(error?.code)?error.code:'RECOVERY_CYCLE_FAILED';
    process.stdout.write(JSON.stringify({ok:false,operation:'ai_ops_recovery_cycle',state:'BLOCKED',
      error:safe,provider_writes:0,no_retry:true})+'\n');
    process.exitCode=1;
  }
}
