import {createHash} from 'node:crypto';
import {CLASSIFICATIONS,PLAYBOOKS,sanitizeOpsTelemetry} from '../ai/yandex-ops.js';

const SAFE=/^[A-Z0-9_]{1,64}$/;
const AUTO_READ=new Set(['RUN_READINESS','RERUN_READ_ONLY_HEALTH','RESTART_BROWSER_CONTEXT','REBUILD_EPHEMERAL_PROFILE']);
const AUTO_LOCAL=new Set(['NO_ACTION','REQUEST_RECONCILIATION']);
const ESCALATE=new Set(['ROTATE_SESSION','OPERATOR_REAUTH','CONTRACT_DIAGNOSTIC','ESCALATE_OPERATOR']);
const fail=code=>{throw Object.assign(new Error(code),{code});};

export const RECOVERY_POLICY_VERSION='ai-ops-recovery-v1';

function hashTelemetry(value){
  return createHash('sha256').update(JSON.stringify(sanitizeOpsTelemetry(value))).digest('hex');
}
export function validateRecoveryDecision(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||
     Object.keys(value).sort().join()!=='classification,confidence,execution_authorized,ok,operation,playbook_id,policy_version,provider_write_authorized,reason_code,telemetry_hash')
    fail('RECOVERY_DECISION_INVALID');
  if(value.ok!==true||value.operation!=='ai_yandex_ops_decision'||value.policy_version!=='ai-yandex-ops-v1'||
     value.execution_authorized!==false||value.provider_write_authorized!==false||
     typeof value.classification!=='string'||!Object.prototype.hasOwnProperty.call(CLASSIFICATIONS,value.classification)||
     typeof value.playbook_id!=='string'||!Object.prototype.hasOwnProperty.call(PLAYBOOKS,value.playbook_id)||
     !CLASSIFICATIONS[value.classification].includes(value.playbook_id)||
     typeof value.reason_code!=='string'||!SAFE.test(value.reason_code)||
     !['LOW','MEDIUM','HIGH'].includes(value.confidence)||
     typeof value.telemetry_hash!=='string'||!/^[0-9a-f]{64}$/.test(value.telemetry_hash))
    fail('RECOVERY_DECISION_INVALID');
  if(value.classification==='RESULT_UNKNOWN'&&value.playbook_id!=='REQUEST_RECONCILIATION')
    fail('RECOVERY_DECISION_INVALID');
  return Object.freeze({...value});
}

export function buildRecoveryPlan({telemetry,decision,telemetryAgeSeconds,decisionAgeSeconds,previous=null}={}){
  const t=sanitizeOpsTelemetry(telemetry);
  const d=validateRecoveryDecision(decision);
  if(hashTelemetry(t)!==d.telemetry_hash)fail('RECOVERY_TELEMETRY_MISMATCH');
  for(const age of [telemetryAgeSeconds,decisionAgeSeconds])
    if(!Number.isSafeInteger(age)||age<0||age>1800)fail('RECOVERY_STALE_INPUT');
  if(t.lifecycle.provider_writes!==0||t.lifecycle.queue_claims!==0)fail('RECOVERY_UNSAFE_STATE');

  const recoveryId=createHash('sha256').update([
    RECOVERY_POLICY_VERSION,d.telemetry_hash,d.classification,d.playbook_id,d.reason_code
  ].join('|')).digest('hex');
  if(previous?.recovery_id===recoveryId&&
     ['EXECUTING','SUCCESS','FAILED','ESCALATED','REQUESTED','NO_ACTION'].includes(previous?.status)){
    return Object.freeze({ok:true,recovery_id:recoveryId,mode:'DEDUPLICATED',classification:d.classification,
      playbook_id:d.playbook_id,reason_code:d.reason_code,provider_write_authorized:false,no_retry:true});
  }

  let mode;
  if(AUTO_READ.has(d.playbook_id))mode='READ_ONLY_AUTOMATIC';
  else if(AUTO_LOCAL.has(d.playbook_id))mode=d.playbook_id==='NO_ACTION'?'NO_ACTION':'LOCAL_REQUEST';
  else if(ESCALATE.has(d.playbook_id))mode='ESCALATE';
  else fail('RECOVERY_PLAYBOOK_DENIED');

  return Object.freeze({ok:true,recovery_id:recoveryId,mode,classification:d.classification,
    playbook_id:d.playbook_id,reason_code:d.reason_code,confidence:d.confidence,
    telemetry_hash:d.telemetry_hash,provider_write_authorized:false,no_retry:true});
}

export function safeRecoveryResult(plan,result){
  if(!plan?.ok||typeof plan.recovery_id!=='string')fail('RECOVERY_PLAN_INVALID');
  if(plan.mode==='DEDUPLICATED')return Object.freeze({...plan,status:'DEDUPLICATED'});
  if(plan.mode==='NO_ACTION')return Object.freeze({...plan,status:'NO_ACTION'});
  if(plan.mode==='ESCALATE')return Object.freeze({...plan,status:'ESCALATED'});
  if(plan.mode==='LOCAL_REQUEST')return Object.freeze({...plan,status:'REQUESTED'});
  if(plan.mode==='READ_ONLY_AUTOMATIC'){
    if(result?.ok!==true||result?.provider_writes!==0||result?.queue_claims!==0)
      return Object.freeze({...plan,status:'FAILED',error:'RECOVERY_VERIFICATION_FAILED'});
    return Object.freeze({...plan,status:'SUCCESS',verification_state:result.state??null,
      provider_requests:Number(result.provider_requests??0),provider_writes:0,queue_claims:0});
  }
  fail('RECOVERY_PLAN_INVALID');
}
