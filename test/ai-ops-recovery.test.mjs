import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {sanitizeOpsTelemetry} from '../lib/ai/yandex-ops.js';
import {buildRecoveryPlan,safeRecoveryResult,RECOVERY_POLICY_VERSION} from '../lib/server/ai-ops-recovery.js';
import {runRecoveryCycle} from '../tools/ai-ops-recovery/recovery-cycle.mjs';

const telemetry=sanitizeOpsTelemetry({
  telemetry_version:1,
  lifecycle:{
    lifecycle_state:'MONITORING',auth_state:'NOT_CHECKED',browser_state:'NOT_CHECKED',
    csrf_state:'NOT_CHECKED',read_state:'NOT_CHECKED',rotation_state:'CURRENT',
    freshness_state:'SESSION_CHECK_DUE',session_revision:6,source_age_seconds:30,
    min_cookie_ttl_seconds:1000000,expiring_6h_count:0,expiring_72h_count:0,
    provider_writes:0,queue_claims:0
  },
  sync:{
    result:'FAIL',failure_code:'SYNC_NOT_CONFIRMED',source_age_seconds:45,
    last_provider_read_age_seconds:120,last_persistence_age_seconds:120
  }
});
const telemetryHash=()=>createHash('sha256').update(JSON.stringify(telemetry)).digest('hex');
function decision(overrides={}){
  return {
    ok:true,operation:'ai_yandex_ops_decision',policy_version:'ai-yandex-ops-v1',
    classification:'READINESS_DUE',playbook_id:'RUN_READINESS',reason_code:'SESSION_CHECK_DUE',
    confidence:'HIGH',telemetry_hash:telemetryHash(),
    execution_authorized:false,provider_write_authorized:false,...overrides
  };
}

test('Stage18 fresh allowlisted read-only proposal becomes automatic recovery plan',()=>{
  const plan=buildRecoveryPlan({telemetry,decision:decision(),telemetryAgeSeconds:20,decisionAgeSeconds:10});
  assert.equal(plan.mode,'READ_ONLY_AUTOMATIC');
  assert.equal(plan.playbook_id,'RUN_READINESS');
  assert.equal(plan.provider_write_authorized,false);
  assert.equal(plan.no_retry,true);
  assert.match(plan.recovery_id,/^[0-9a-f]{64}$/);
});

test('Stage18 duplicate EXECUTING fingerprint is never retried',()=>{
  const first=buildRecoveryPlan({telemetry,decision:decision(),telemetryAgeSeconds:20,decisionAgeSeconds:10});
  const second=buildRecoveryPlan({telemetry,decision:decision(),telemetryAgeSeconds:21,decisionAgeSeconds:11,
    previous:{recovery_id:first.recovery_id,status:'EXECUTING'}});
  assert.equal(second.mode,'DEDUPLICATED');
  assert.equal(second.no_retry,true);
});

test('Stage18 RESULT_UNKNOWN is reconciliation request only',()=>{
  const d=decision({classification:'RESULT_UNKNOWN',playbook_id:'REQUEST_RECONCILIATION',
    reason_code:'SERVER_REPLY_RESULT_UNKNOWN'});
  const plan=buildRecoveryPlan({telemetry,decision:d,telemetryAgeSeconds:10,decisionAgeSeconds:5});
  assert.equal(plan.mode,'LOCAL_REQUEST');
  assert.equal(safeRecoveryResult(plan,null).status,'REQUESTED');
});

test('Stage18 session rotation and operator/challenge paths escalate instead of auto-executing',()=>{
  for(const [classification,playbook] of [
    ['SESSION_EXPIRY','ROTATE_SESSION'],['AUTH_REQUIRED','OPERATOR_REAUTH'],
    ['CONTRACT_DRIFT','CONTRACT_DIAGNOSTIC'],['CHALLENGE_REQUIRED','ESCALATE_OPERATOR']
  ]){
    const plan=buildRecoveryPlan({telemetry,decision:decision({classification,playbook_id:playbook,
      reason_code:'SAFE_ESCALATION'}),telemetryAgeSeconds:10,decisionAgeSeconds:5});
    assert.equal(plan.mode,'ESCALATE',playbook);
    assert.equal(safeRecoveryResult(plan,null).status,'ESCALATED');
  }
});

test('Stage18 telemetry hash mismatch and stale evidence fail closed',()=>{
  assert.throws(()=>buildRecoveryPlan({telemetry,decision:decision({telemetry_hash:'0'.repeat(64)}),
    telemetryAgeSeconds:1,decisionAgeSeconds:1}),/RECOVERY_TELEMETRY_MISMATCH/);
  assert.throws(()=>buildRecoveryPlan({telemetry,decision:decision(),
    telemetryAgeSeconds:1801,decisionAgeSeconds:1}),/RECOVERY_STALE_INPUT/);
});

test('Stage18 read-only verification cannot report provider writes',()=>{
  const plan=buildRecoveryPlan({telemetry,decision:decision(),telemetryAgeSeconds:10,decisionAgeSeconds:5});
  assert.equal(safeRecoveryResult(plan,{ok:true,state:'READY',provider_requests:2,provider_writes:0,queue_claims:0}).status,'SUCCESS');
  const bad=safeRecoveryResult(plan,{ok:true,state:'READY',provider_requests:2,provider_writes:1,queue_claims:0});
  assert.equal(bad.status,'FAILED');
  assert.equal(bad.error,'RECOVERY_VERIFICATION_FAILED');
});

test('Stage18 cycle waits safely for AI configuration when no fresh decision exists',async()=>{
  const calls=[];
  const result=await runRecoveryCycle({
    startUnit:args=>{calls.push(args.join(' '));return {ok:true};},
    getHash:()=>telemetryHash(),hasKey:()=>false,hasFreshDecision:()=>false,
    recover:async()=>{throw new Error('must not run');}
  });
  assert.equal(result.state,'WAITING_AI_CONFIGURATION');
  assert.equal(result.classification_run,false);
  assert.equal(result.recovery_run,false);
  assert.equal(result.provider_writes,0);
  assert.deepEqual(calls,['start review-ai-ops-collect.service']);
});

test('Stage18 cycle reuses fresh decision without a new AI provider call',async()=>{
  const calls=[];
  const result=await runRecoveryCycle({
    startUnit:args=>{calls.push(args.join(' '));return {ok:true};},
    getHash:()=>telemetryHash(),hasKey:()=>true,hasFreshDecision:()=>true,
    recover:async()=>({ok:true,status:'SUCCESS',playbook_id:'RUN_READINESS',recovery_id:'a'.repeat(64)})
  });
  assert.equal(result.classification_run,false);
  assert.equal(result.recovery_run,true);
  assert.equal(result.provider_writes,0);
  assert.deepEqual(calls,['start review-ai-ops-collect.service']);
});

test('Stage18 cycle starts isolated AI classification only when telemetry has no fresh decision',async()=>{
  const calls=[];let checks=0;
  const result=await runRecoveryCycle({
    startUnit:args=>{calls.push(args.join(' '));return {ok:true};},
    getHash:()=>telemetryHash(),hasKey:()=>true,
    hasFreshDecision:()=>++checks>1,
    recover:async()=>({ok:true,status:'REQUESTED',playbook_id:'REQUEST_RECONCILIATION',recovery_id:'b'.repeat(64)})
  });
  assert.equal(result.classification_run,true);
  assert.deepEqual(calls,[
    'start review-ai-ops-collect.service','start review-ai-ops.service','start review-ai-ops-once.service'
  ]);
});

test('Stage18 source and systemd boundaries contain no reply write path',()=>{
  const orchestrator=readFileSync(new URL('../tools/ai-ops-recovery/recovery-orchestrator.mjs',import.meta.url),'utf8');
  const cycle=readFileSync(new URL('../tools/ai-ops-recovery/recovery-cycle.mjs',import.meta.url),'utf8');
  const service=readFileSync(new URL('../tools/ai-ops-recovery/review-ai-ops-recovery.service',import.meta.url),'utf8');
  const timer=readFileSync(new URL('../tools/ai-ops-recovery/review-ai-ops-recovery.timer',import.meta.url),'utf8');
  assert.match(orchestrator,/RA_YANDEX_REPLY_WRITE_ENABLED=false/);
  assert.doesNotMatch(orchestrator,/RA_YANDEX_REPLY_WRITE_ENABLED=true|business-answer|mode.?execute/i);
  assert.doesNotMatch(cycle,/https?:\/\//);
  assert.match(service,/PrivateNetwork=yes/);
  assert.match(service,/RestrictAddressFamilies=AF_UNIX/);
  assert.match(service,/ReadWritePaths=\/var\/lib\/review-activator-ops/);
  assert.match(timer,/OnUnitActiveSec=15min/);
  assert.doesNotMatch(service,/review-yandex-writer/);
});

test('Stage18 recovery policy version is fixed and separate from AI policy',()=>{
  assert.equal(RECOVERY_POLICY_VERSION,'ai-ops-recovery-v1');
});
