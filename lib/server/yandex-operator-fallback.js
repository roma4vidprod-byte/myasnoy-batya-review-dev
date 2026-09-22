import {createHash} from 'node:crypto';
import {sanitizeOpsTelemetry} from '../ai/yandex-ops.js';

export const OPERATOR_FALLBACK_POLICY_VERSION='yandex-operator-fallback-v1';
const TTL_MS=60*60*1000;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const SAFE_CODE=/^[A-Z0-9_]{1,64}$/;

const AUTH_REASONS=new Set([
  'YANDEX_HTTP_401','YANDEX_HTTP_403','YANDEX_LOGIN_REDIRECT',
  'YANDEX_LOGIN_HTML','SESSION_COOKIE_INVALID','AUTH_REQUIRED'
]);
const CHALLENGE_REASONS=new Map([
  ['YANDEX_CHALLENGE','CHALLENGE'],
  ['YANDEX_CAPTCHA_REQUIRED','CAPTCHA'],
  ['YANDEX_2FA_REQUIRED','TWO_FACTOR']
]);
const FINAL_STATES=new Set(['RESOLVED','FAILED','EXPIRED']);

function exactKeys(value,keys){
  return value&&typeof value==='object'&&!Array.isArray(value)&&
    Object.keys(value).sort().join()===keys.slice().sort().join();
}
function iso(ms){return new Date(ms).toISOString();}
function safeReason(value){
  if(typeof value!=='string'||!SAFE_CODE.test(value))fail('OPERATOR_FALLBACK_INPUT_INVALID');
  return value;
}

export function classifyOperatorEscalation(value){
  if(!exactKeys(value,['version','recovery_policy_version','recovery_id','classification',
    'playbook_id','reason_code','status','provider_write_authorized','no_retry','created_at']))
    fail('OPERATOR_FALLBACK_ESCALATION_INVALID');
  if(value.version!==1||value.recovery_policy_version!=='ai-ops-recovery-v1'||
     typeof value.recovery_id!=='string'||!/^[0-9a-f]{64}$/.test(value.recovery_id)||
     value.status!=='ESCALATED'||value.provider_write_authorized!==false||value.no_retry!==true)
    fail('OPERATOR_FALLBACK_ESCALATION_INVALID');
  const reason=safeReason(value.reason_code);
  if(value.classification==='AUTH_REQUIRED'&&value.playbook_id==='OPERATOR_REAUTH'&&AUTH_REASONS.has(reason))
    return Object.freeze({kind:'REAUTH',reason_code:reason});
  if(value.classification==='CHALLENGE_REQUIRED'&&value.playbook_id==='ESCALATE_OPERATOR'&&CHALLENGE_REASONS.has(reason))
    return Object.freeze({kind:CHALLENGE_REASONS.get(reason),reason_code:reason});
  fail('OPERATOR_FALLBACK_ESCALATION_UNSUPPORTED');
}

export function createOperatorTicket({escalation,telemetry,nowMs=Date.now()}={}){
  const e=classifyOperatorEscalation(escalation);
  const t=sanitizeOpsTelemetry(telemetry);
  if(!Number.isSafeInteger(nowMs)||nowMs<=0)fail('OPERATOR_FALLBACK_INPUT_INVALID');
  const revision=t.lifecycle.session_revision;
  if(!Number.isSafeInteger(revision)||revision<1||t.lifecycle.provider_writes!==0||t.lifecycle.queue_claims!==0)
    fail('OPERATOR_FALLBACK_INPUT_INVALID');
  const ticketId=createHash('sha256').update([
    OPERATOR_FALLBACK_POLICY_VERSION,escalation.recovery_id,e.kind,e.reason_code,String(revision)
  ].join('|')).digest('hex');
  return Object.freeze({
    version:1,policy_version:OPERATOR_FALLBACK_POLICY_VERSION,ticket_id:ticketId,
    source_recovery_id:escalation.recovery_id,fallback_kind:e.kind,reason_code:e.reason_code,
    expected_session_revision:revision,state:'ACTION_REQUIRED',
    issued_at:iso(nowMs),expires_at:iso(nowMs+TTL_MS),
    operator_secret_input_allowed:false,provider_write_authorized:false,no_retry:true
  });
}

export function validateOperatorTicket(value){
  if(!exactKeys(value,['version','policy_version','ticket_id','source_recovery_id','fallback_kind',
    'reason_code','expected_session_revision','state','issued_at','expires_at',
    'operator_secret_input_allowed','provider_write_authorized','no_retry',
    ...(value?.acknowledged_at!==undefined?['acknowledged_at']:[]),
    ...(value?.verification_revision!==undefined?['verification_revision']:[]),
    ...(value?.finished_at!==undefined?['finished_at']:[])
  ]))fail('OPERATOR_FALLBACK_TICKET_INVALID');
  if(value.version!==1||value.policy_version!==OPERATOR_FALLBACK_POLICY_VERSION||
     typeof value.ticket_id!=='string'||!/^[0-9a-f]{64}$/.test(value.ticket_id)||
     typeof value.source_recovery_id!=='string'||!/^[0-9a-f]{64}$/.test(value.source_recovery_id)||
     !['REAUTH','TWO_FACTOR','CAPTCHA','CHALLENGE'].includes(value.fallback_kind)||
     !SAFE_CODE.test(String(value.reason_code||''))||
     !Number.isSafeInteger(value.expected_session_revision)||value.expected_session_revision<1||
     !['ACTION_REQUIRED','OPERATOR_CONFIRMED','VERIFYING','RESOLVED','FAILED','EXPIRED'].includes(value.state)||
     !Number.isFinite(Date.parse(value.issued_at))||!Number.isFinite(Date.parse(value.expires_at))||
     value.operator_secret_input_allowed!==false||value.provider_write_authorized!==false||value.no_retry!==true)
    fail('OPERATOR_FALLBACK_TICKET_INVALID');
  return Object.freeze({...value});
}

export function acknowledgeOperatorTicket(ticket,request,{nowMs=Date.now()}={}){
  const t=validateOperatorTicket(ticket);
  if(!exactKeys(request,['version','op','ticket_id'])||request.version!==1||
     request.op!=='ack'||request.ticket_id!==t.ticket_id)
    fail('OPERATOR_FALLBACK_ACK_INVALID');
  if(FINAL_STATES.has(t.state))return t;
  if(t.state!=='ACTION_REQUIRED')fail('OPERATOR_FALLBACK_STATE_INVALID');
  if(nowMs>=Date.parse(t.expires_at))return Object.freeze({...t,state:'EXPIRED',finished_at:iso(nowMs)});
  return Object.freeze({...t,state:'OPERATOR_CONFIRMED',acknowledged_at:iso(nowMs)});
}

export function verifyOperatorTicket(ticket,sessionStatus,{nowMs=Date.now()}={}){
  const t=validateOperatorTicket(ticket);
  if(FINAL_STATES.has(t.state))return t;
  if(!['OPERATOR_CONFIRMED','VERIFYING'].includes(t.state))
    fail('OPERATOR_FALLBACK_STATE_INVALID');
  if(nowMs>=Date.parse(t.expires_at))
    return Object.freeze({...t,state:'EXPIRED',finished_at:iso(nowMs)});
  if(!exactKeys(sessionStatus,['state','revision','error_code'])||
     !['NOT_CONFIGURED','READY','REAUTH_REQUIRED','ERROR','DISABLED'].includes(sessionStatus.state)||
     !Number.isSafeInteger(sessionStatus.revision)||sessionStatus.revision<0||
     (sessionStatus.error_code!==null&&(typeof sessionStatus.error_code!=='string'||!SAFE_CODE.test(sessionStatus.error_code))))
    fail('OPERATOR_FALLBACK_STATUS_INVALID');
  const expected=t.expected_session_revision+1;
  if(sessionStatus.revision<t.expected_session_revision)
    return Object.freeze({...t,state:'FAILED',finished_at:iso(nowMs),verification_revision:sessionStatus.revision});
  if(sessionStatus.revision===t.expected_session_revision)
    return Object.freeze({...t,state:'OPERATOR_CONFIRMED'});
  if(sessionStatus.revision!==expected)
    return Object.freeze({...t,state:'FAILED',finished_at:iso(nowMs),verification_revision:sessionStatus.revision});
  if(sessionStatus.state==='READY')
    return Object.freeze({...t,state:'RESOLVED',finished_at:iso(nowMs),verification_revision:sessionStatus.revision});
  if(sessionStatus.state==='NOT_CONFIGURED')
    return Object.freeze({...t,state:'VERIFYING',verification_revision:sessionStatus.revision});
  return Object.freeze({...t,state:'FAILED',finished_at:iso(nowMs),verification_revision:sessionStatus.revision});
}

export function safeOperatorInstructions(ticket){
  const t=validateOperatorTicket(ticket);
  return Object.freeze({
    ticket_id:t.ticket_id,state:t.state,fallback_kind:t.fallback_kind,reason_code:t.reason_code,
    expected_session_revision:t.expected_session_revision,expires_at:t.expires_at,
    instruction_code:'COMPLETE_YANDEX_CHALLENGE_IN_BROWSER_THEN_USE_APPROVED_SESSION_IMPORT',
    never_submit_to_slukh:['PASSWORD','OTP','2FA_CODE','CAPTCHA_RESPONSE','COOKIE','CSRF','TOKEN']
  });
}
