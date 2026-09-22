import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  createOperatorTicket,acknowledgeOperatorTicket,verifyOperatorTicket,
  safeOperatorInstructions,OPERATOR_FALLBACK_POLICY_VERSION
} from '../lib/server/yandex-operator-fallback.js';
import {runOperatorFallback} from '../tools/yandex-operator-fallback/operator-fallback-manager.mjs';

const now=Date.parse('2026-09-22T17:00:00Z');
const telemetry={
  telemetry_version:1,
  lifecycle:{
    lifecycle_state:'MONITORING',auth_state:'NOT_CHECKED',browser_state:'NOT_CHECKED',
    csrf_state:'NOT_CHECKED',read_state:'NOT_CHECKED',rotation_state:'CURRENT',
    freshness_state:'SESSION_CHECK_DUE',session_revision:6,source_age_seconds:30,
    min_cookie_ttl_seconds:1000000,expiring_6h_count:0,expiring_72h_count:0,
    provider_writes:0,queue_claims:0
  },
  sync:{result:'FAIL',failure_code:'SYNC_NOT_CONFIRMED',source_age_seconds:45,
    last_provider_read_age_seconds:120,last_persistence_age_seconds:120}
};
const escalation=(overrides={})=>({
  version:1,recovery_policy_version:'ai-ops-recovery-v1',
  recovery_id:'a'.repeat(64),classification:'AUTH_REQUIRED',playbook_id:'OPERATOR_REAUTH',
  reason_code:'YANDEX_LOGIN_REDIRECT',status:'ESCALATED',
  provider_write_authorized:false,no_retry:true,created_at:'2026-09-22T16:59:00Z',...overrides
});

test('Stage19 creates fixed-scope REAUTH ticket with no secret input channel',()=>{
  const t=createOperatorTicket({escalation:escalation(),telemetry,nowMs:now});
  assert.equal(t.policy_version,OPERATOR_FALLBACK_POLICY_VERSION);
  assert.equal(t.fallback_kind,'REAUTH');
  assert.equal(t.state,'ACTION_REQUIRED');
  assert.equal(t.expected_session_revision,6);
  assert.equal(t.operator_secret_input_allowed,false);
  assert.equal(t.provider_write_authorized,false);
  assert.equal(t.no_retry,true);
  assert.match(t.ticket_id,/^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(t),/password|otp|captcha_response|cookie|csrf|token/i);
});

test('Stage19 recognizes challenge/2FA/CAPTCHA only from explicit safe reason codes',()=>{
  for(const [reason,kind] of [['YANDEX_CHALLENGE','CHALLENGE'],
    ['YANDEX_CAPTCHA_REQUIRED','CAPTCHA'],['YANDEX_2FA_REQUIRED','TWO_FACTOR']]){
    const t=createOperatorTicket({escalation:escalation({
      classification:'CHALLENGE_REQUIRED',playbook_id:'ESCALATE_OPERATOR',reason_code:reason,
      recovery_id:(kind==='CAPTCHA'?'b':kind==='TWO_FACTOR'?'c':'d').repeat(64)
    }),telemetry,nowMs:now});
    assert.equal(t.fallback_kind,kind);
  }
});

test('Stage19 refuses contract-drift or invented escalation as operator auth fallback',()=>{
  assert.throws(()=>createOperatorTicket({escalation:escalation({
    classification:'CONTRACT_DRIFT',playbook_id:'CONTRACT_DIAGNOSTIC',reason_code:'SERVER_CSRF_NAVIGATION_FAILED'
  }),telemetry,nowMs:now}),/OPERATOR_FALLBACK_ESCALATION_UNSUPPORTED/);
});

test('Stage19 ACK accepts ticket id only and rejects secret-bearing fields',()=>{
  const t=createOperatorTicket({escalation:escalation(),telemetry,nowMs:now});
  const a=acknowledgeOperatorTicket(t,{version:1,op:'ack',ticket_id:t.ticket_id},{nowMs:now+1000});
  assert.equal(a.state,'OPERATOR_CONFIRMED');
  assert.throws(()=>acknowledgeOperatorTicket(t,{
    version:1,op:'ack',ticket_id:t.ticket_id,otp:'123456'
  },{nowMs:now+1000}),/OPERATOR_FALLBACK_ACK_INVALID/);
});

test('Stage19 revision binding waits, verifies NOT_CONFIGURED, then resolves READY',()=>{
  const t=createOperatorTicket({escalation:escalation(),telemetry,nowMs:now});
  const a=acknowledgeOperatorTicket(t,{version:1,op:'ack',ticket_id:t.ticket_id},{nowMs:now+1000});
  const same=verifyOperatorTicket(a,{state:'READY',revision:6,error_code:null},{nowMs:now+2000});
  assert.equal(same.state,'OPERATOR_CONFIRMED');
  const imported=verifyOperatorTicket(a,{state:'NOT_CONFIGURED',revision:7,error_code:null},{nowMs:now+3000});
  assert.equal(imported.state,'VERIFYING');
  const ready=verifyOperatorTicket(imported,{state:'READY',revision:7,error_code:null},{nowMs:now+4000});
  assert.equal(ready.state,'RESOLVED');
});

test('Stage19 revision drift and ticket expiry fail closed',()=>{
  const t=createOperatorTicket({escalation:escalation(),telemetry,nowMs:now});
  const a=acknowledgeOperatorTicket(t,{version:1,op:'ack',ticket_id:t.ticket_id},{nowMs:now+1000});
  assert.equal(verifyOperatorTicket(a,{state:'READY',revision:8,error_code:null},{nowMs:now+2000}).state,'FAILED');
  assert.equal(verifyOperatorTicket(a,{state:'READY',revision:6,error_code:null},{nowMs:now+3600001}).state,'EXPIRED');
});

test('Stage19 safe operator instructions never request credentials or challenge answers',()=>{
  const t=createOperatorTicket({escalation:escalation(),telemetry,nowMs:now});
  const v=safeOperatorInstructions(t);
  assert.equal(v.instruction_code,'COMPLETE_YANDEX_CHALLENGE_IN_BROWSER_THEN_USE_APPROVED_SESSION_IMPORT');
  assert.deepEqual(v.never_submit_to_slukh,['PASSWORD','OTP','2FA_CODE','CAPTCHA_RESPONSE','COOKIE','CSRF','TOKEN']);
  assert.doesNotMatch(JSON.stringify(v),/54309413522|13f3cb80|9a95f63b/i);
});

test('Stage19 scheduled ingest creates one ticket from Stage18 escalation',async()=>{
  const writes=[];
  const result=await runOperatorFallback('ingest',{
    readJson:(path,{optional=false}={})=>{
      if(path.endsWith('YANDEX_OPERATOR_FALLBACK_STAGE19.json'))return null;
      if(path.endsWith('YANDEX_OPERATOR_ESCALATION_STAGE18.json'))return escalation();
      if(path.endsWith('YANDEX_AI_OPS_INPUT.json'))return telemetry;
      if(optional)return null;throw new Error('unexpected '+path);
    },
    write:(path,value)=>writes.push({path,value}),
    readStatus:async()=>{throw new Error('status must not run');},now:()=>now
  });
  assert.equal(result.state,'ACTION_REQUIRED');
  assert.equal(writes.length,1);
  assert.equal(writes[0].value.operator_secret_input_allowed,false);
});

test('Stage19 scheduled ingest auto-verifies acknowledged ticket but never acknowledges it',async()=>{
  const base=createOperatorTicket({escalation:escalation(),telemetry,nowMs:now});
  const ack=acknowledgeOperatorTicket(base,{version:1,op:'ack',ticket_id:base.ticket_id},{nowMs:now+1000});
  const writes=[];
  const result=await runOperatorFallback('ingest',{
    readJson:path=>path.endsWith('YANDEX_OPERATOR_FALLBACK_STAGE19.json')?ack:null,
    write:(path,value)=>writes.push(value),
    readStatus:async()=>({state:'NOT_CONFIGURED',revision:7,error_code:null}),
    now:()=>now+2000
  });
  assert.equal(result.state,'VERIFYING');
  assert.equal(writes[0].state,'VERIFYING');
});

test('Stage19 service is network-off and manager reads only exact safe DB status fields',()=>{
  const manager=readFileSync(new URL('../tools/yandex-operator-fallback/operator-fallback-manager.mjs',import.meta.url),'utf8');
  const service=readFileSync(new URL('../tools/yandex-operator-fallback/review-yandex-operator-fallback.service',import.meta.url),'utf8');
  const timer=readFileSync(new URL('../tools/yandex-operator-fallback/review-yandex-operator-fallback.timer',import.meta.url),'utf8');
  assert.match(manager,/json_build_object\('state',state,'revision',revision,'error_code',last_error_code\)/);
  assert.doesNotMatch(manager,/password|otp|captcha_response|cookie_value|csrf_token/i);
  assert.match(service,/PrivateNetwork=yes/);
  assert.match(service,/RestrictAddressFamilies=AF_UNIX/);
  assert.match(service,/InaccessiblePaths=.*review-activator-yandex/);
  assert.match(timer,/OnUnitActiveSec=15min/);
  assert.doesNotMatch(service,/RA_YANDEX_REPLY_WRITE_ENABLED=true|review-yandex-writer/);
});
