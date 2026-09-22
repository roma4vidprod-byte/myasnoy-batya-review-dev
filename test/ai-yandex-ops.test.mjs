import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import http from 'node:http';
import {sanitizeOpsTelemetry,buildYandexOpsPrompt,classifyYandexOps,PLAYBOOKS,CLASSIFICATIONS} from '../lib/ai/yandex-ops.js';
import {buildOpsTelemetry} from '../tools/ai-ops/ops-telemetry-collector.mjs';
import {createAiOpsServer} from '../tools/ai-ops/ai-ops-service.mjs';

const now=Date.parse('2026-09-22T15:00:00Z');
const lifecycle={
  ok:true,operation:'yandex_session_lifecycle',telemetry_version:1,mode:'snapshot',
  state:'MONITORING',ready:null,organization_id:'54309413522',session_revision:6,
  chain:{auth:'NOT_CHECKED',session:'SESSION_READY',csrf:'NOT_CHECKED',read:'NOT_CHECKED'},
  rotation_state:'CURRENT',freshness_state:'SESSION_CHECK_DUE',
  last_readiness_at:'2026-09-22T14:59:00Z',last_readiness_age_seconds:60,
  cookie_count:19,persistent_cookie_count:19,session_cookie_count:0,
  min_cookie_ttl_seconds:1000000,max_cookie_ttl_seconds:30000000,
  expiring_within_6h:0,expiring_within_72h:0,
  last_session_check_age_seconds:1000,last_successful_sync_age_seconds:null,
  provider_requests:0,provider_writes:0,queue_claims:0,allowed_action_ids:[]
};
const sync={last_sync_result:'FAIL',real_review_count:73,sync_failure:'SYNC_NOT_CONFIRMED',
  last_successful_provider_read:'2026-09-22T14:58:00Z',
  last_successful_persistence:'2026-09-22T14:58:00Z'};

function telemetry(){
  return buildOpsTelemetry({lifecycle,lifecycleMtimeMs:now-30000,sync,syncMtimeMs:now-45000,nowMs:now});
}

test('Stage17 collector emits only sanitized lifecycle/browser/sync telemetry',()=>{
  const value=telemetry();
  assert.equal(value.telemetry_version,1);
  assert.equal(value.lifecycle.source_age_seconds,30);
  assert.equal(value.sync.source_age_seconds,45);
  assert.equal(value.sync.last_provider_read_age_seconds,120);
  assert.equal(value.sync.failure_code,'SYNC_NOT_CONFIRMED');
  const raw=JSON.stringify(value);
  assert.doesNotMatch(raw,/54309413522|cookie_count|credential|envelope|ciphertext|password|csrf_token|session_key/i);
});

test('Stage17 strict telemetry schema rejects secret-bearing or extra fields',()=>{
  const value=structuredClone(telemetry());
  value.lifecycle.cookie_value='secret';
  assert.throws(()=>sanitizeOpsTelemetry(value),/AI_OPS_INPUT_INVALID/);
  const extra=structuredClone(telemetry());extra.sync.raw_error='secret';
  assert.throws(()=>sanitizeOpsTelemetry(extra),/AI_OPS_INPUT_INVALID/);
});

test('Stage17 AI prompt exposes only safe telemetry and allowlisted IDs',()=>{
  const prompt=buildYandexOpsPrompt(telemetry());
  assert.match(prompt.system,/не выполняешь действий/i);
  assert.match(prompt.system,/RESULT_UNKNOWN/);
  assert.match(prompt.user,/allowed_playbooks/);
  assert.doesNotMatch(prompt.user,/54309413522|password|cookie_value|csrf_token|session_key/i);
});

test('Stage17 provider-independent classifier returns proposal only',async()=>{
  const out=await classifyYandexOps(telemetry(),async()=>JSON.stringify({
    classification:'SYNC_DEGRADED',playbook_id:'REQUEST_RECONCILIATION',
    reason_code:'SYNC_NOT_CONFIRMED',confidence:'HIGH'
  }));
  assert.equal(out.classification,'SYNC_DEGRADED');
  assert.equal(out.playbook_id,'REQUEST_RECONCILIATION');
  assert.equal(out.execution_authorized,false);
  assert.equal(out.provider_write_authorized,false);
});
test('Stage17 invalid or invented playbook is rejected',async()=>{
  await assert.rejects(()=>classifyYandexOps(telemetry(),async()=>JSON.stringify({
    classification:'SYNC_DEGRADED',playbook_id:'RETRY_PROVIDER_POST',
    reason_code:'SYNC_NOT_CONFIRMED',confidence:'HIGH'
  })),/AI_OPS_OUTPUT_INVALID/);
});

test('Stage17 RESULT_UNKNOWN can select reconciliation only',async()=>{
  const value=telemetry();
  const ok=await classifyYandexOps(value,async()=>JSON.stringify({
    classification:'RESULT_UNKNOWN',playbook_id:'REQUEST_RECONCILIATION',
    reason_code:'SERVER_REPLY_RESULT_UNKNOWN',confidence:'HIGH'
  }));
  assert.equal(ok.playbook_id,'REQUEST_RECONCILIATION');
  await assert.rejects(()=>classifyYandexOps(value,async()=>JSON.stringify({
    classification:'RESULT_UNKNOWN',playbook_id:'RUN_READINESS',
    reason_code:'SERVER_REPLY_RESULT_UNKNOWN',confidence:'HIGH'
  })),/AI_OPS_OUTPUT_INVALID/);
});

test('Stage17 action catalog cannot authorize execution or provider writes',()=>{
  for(const [id,value] of Object.entries(PLAYBOOKS)){
    assert.equal(value.automatic,false,id);
    assert.equal(value.providerWrite,false,id);
  }
  assert.deepEqual(CLASSIFICATIONS.RESULT_UNKNOWN,['REQUEST_RECONCILIATION']);
});

test('Stage17 AI Ops HTTP boundary fails closed without configuration',async()=>{
  const server=createAiOpsServer({env:{RA_AI_OPS_MODEL:''},fetchImpl:async()=>{throw new Error('network should not run');}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  try{
    const body=JSON.stringify(telemetry());
    const result=await new Promise((resolve,reject)=>{
      const req=http.request({host:'127.0.0.1',port,path:'/classify',method:'POST',
        headers:{'content-type':'application/json','content-length':Buffer.byteLength(body)}},res=>{
        const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({
          status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))
        }));
      });req.on('error',reject);req.end(body);
    });
    assert.equal(result.status,503);
    assert.deepEqual(result.body,{ok:false,error:'AI_OPS_NOT_CONFIGURED',execution_authorized:false,provider_write_authorized:false});
  }finally{await new Promise(resolve=>server.close(resolve));}
});
test('Stage17 sources and systemd units isolate AI from Yandex secrets and execution',()=>{
  const collector=readFileSync(new URL('../tools/ai-ops/ops-telemetry-collector.mjs',import.meta.url),'utf8');
  const service=readFileSync(new URL('../tools/ai-ops/review-ai-ops.service',import.meta.url),'utf8');
  const collectUnit=readFileSync(new URL('../tools/ai-ops/review-ai-ops-collect.service',import.meta.url),'utf8');
  const once=readFileSync(new URL('../tools/ai-ops/review-ai-ops-once.service',import.meta.url),'utf8');
  const agent=readFileSync(new URL('../tools/ai-ops/ops-agent-once.mjs',import.meta.url),'utf8');
  assert.match(collector,/VPS09_LAST_SYNC\.json/);
  assert.match(collector,/YANDEX_LIFECYCLE_STAGE16\.json/);
  assert.doesNotMatch(collector,/https?:\/\//);
  assert.match(service,/User=review-ai-ops/);
  assert.match(service,/LoadCredential=openai-api-key/);
  assert.match(service,/InaccessiblePaths=.*review-activator-yandex/);
  assert.match(service,/InaccessiblePaths=.*review-activator-ops/);
  assert.match(collectUnit,/PrivateNetwork=yes/);
  assert.match(once,/PrivateNetwork=yes/);
  assert.match(once,/RestrictAddressFamilies=AF_UNIX/);
  assert.doesNotMatch(agent,/business-answer|RA_YANDEX_REPLY_WRITE_ENABLED=true|mode.?execute/i);
});

test('Stage17 AI Ops HTTP boundary accepts only validated mocked provider decision',async()=>{
  const providerOutput=JSON.stringify({
    classification:'SYNC_DEGRADED',playbook_id:'REQUEST_RECONCILIATION',
    reason_code:'SYNC_NOT_CONFIRMED',confidence:'HIGH'
  });
  const server=createAiOpsServer({
    env:{RA_AI_OPS_MODEL:'mock-model'},
    loadKey:()=> 'sk-'+'A'.repeat(30),
    fetchImpl:async()=>({ok:true,text:async()=>JSON.stringify({output_text:providerOutput})})
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  try{
    const body=JSON.stringify(telemetry());
    const result=await new Promise((resolve,reject)=>{
      const req=http.request({host:'127.0.0.1',port,path:'/classify',method:'POST',
        headers:{'content-type':'application/json','content-length':Buffer.byteLength(body)}},res=>{
        const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({
          status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))
        }));
      });req.on('error',reject);req.end(body);
    });
    assert.equal(result.status,200);
    assert.equal(result.body.classification,'SYNC_DEGRADED');
    assert.equal(result.body.playbook_id,'REQUEST_RECONCILIATION');
    assert.equal(result.body.execution_authorized,false);
    assert.equal(result.body.provider_write_authorized,false);
    assert.match(result.body.telemetry_hash,/^[0-9a-f]{64}$/);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
