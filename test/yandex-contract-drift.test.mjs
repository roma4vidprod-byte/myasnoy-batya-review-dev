import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  sanitizeContractDriftEvidence,classifyContractDrift,CONTRACT_DRIFT_POLICY_VERSION
} from '../lib/server/yandex-contract-drift.js';
import {buildContractDriftPrompt,diagnoseContractDrift} from '../lib/ai/yandex-contract-drift.js';
import {pathKind} from '../tools/yandex-contract-drift/browser-contract-probe.mjs';
import {runContractDriftManager} from '../tools/yandex-contract-drift/contract-drift-manager.mjs';

const page=(overrides={})=>({
  result:'PASS',error_code:null,http_status:200,content_type:'HTML',
  final_path_kind:'EXPECTED_PAGE',same_org_segment:true,preload_marker:true,
  csrf_key_occurrences:3,csrf_candidate_count:1,challenge_marker:false,login_marker:false,
  document_requests:1,blocked_requests:10,blocked_non_get:0,reply_endpoint_attempts:0,
  body_bytes:100000,session_revision:6,provider_writes:0,...overrides
});
const api=(overrides={})=>({
  result:'PASS',error_code:null,session_revision:6,provider_requests:1,provider_writes:0,
  page_items:20,reported_total:73,list_csrf_present:true,
  business_answer_csrf_present_count:20,...overrides
});
const evidence=(p={},a={})=>({version:1,page:page(p),api:api(a)});

test('Stage20 evidence schema is safe, fixed and rejects provider writes',()=>{
  const v=sanitizeContractDriftEvidence(evidence());
  assert.equal(v.page.final_path_kind,'EXPECTED_PAGE');
  assert.throws(()=>sanitizeContractDriftEvidence(evidence({provider_writes:1})),/CONTRACT_DRIFT_UNSAFE_EVIDENCE/);
  assert.throws(()=>sanitizeContractDriftEvidence(evidence({reply_endpoint_attempts:1})),/CONTRACT_DRIFT_UNSAFE_EVIDENCE/);
  const extra=evidence();extra.page.url='https://secret.example/';
  assert.throws(()=>sanitizeContractDriftEvidence(extra),/CONTRACT_DRIFT_EVIDENCE_INVALID/);
});

test('Stage20 browser path classification never exports an arbitrary replacement path',()=>{
  assert.equal(pathKind('https://yandex.ru/sprav/54309413522/p/edit/reviews/'),'EXPECTED_PAGE');
  assert.equal(pathKind('https://yandex.ru/sprav/54309413522/edit/reviews'),'SAME_ORG_OTHER');
  assert.equal(pathKind('https://passport.yandex.ru/auth'),'PASSPORT');
  assert.equal(pathKind('https://evil.example/x'),'FOREIGN');
});

test('Stage20 deterministic classifier distinguishes auth/challenge/path/preload/csrf/api drift',()=>{
  const cases=[
    [evidence({challenge_marker:true}),'CHALLENGE_SURFACE','OPERATOR_CHALLENGE'],
    [evidence({final_path_kind:'PASSPORT',same_org_segment:false}),'AUTH_CONTRACT_DRIFT','OPERATOR_REAUTH'],
    [evidence({result:'TIMEOUT',error_code:'SERVER_CSRF_NAVIGATION_FAILED',http_status:null,content_type:'UNKNOWN',final_path_kind:'UNKNOWN',same_org_segment:false,preload_marker:false,csrf_key_occurrences:0,csrf_candidate_count:0,body_bytes:null}),'BROWSER_NAVIGATION_DRIFT','CONTRACT_REVIEW'],
    [evidence({result:'FAIL',error_code:'CONTRACT_DRIFT_HTTP_STATUS',final_path_kind:'SAME_ORG_OTHER'}),'PAGE_PATH_DRIFT','CONTRACT_REVIEW'],
    [evidence({preload_marker:false,csrf_key_occurrences:0,csrf_candidate_count:0}),'PRELOAD_CONTRACT_DRIFT','CONTRACT_REVIEW'],
    [evidence({csrf_key_occurrences:0,csrf_candidate_count:0}),'CSRF_CONTRACT_DRIFT','CONTRACT_REVIEW'],
    [evidence({}, {result:'FAIL',error_code:'BROWSER_PROVIDER_CONTRACT_INVALID',session_revision:0,provider_requests:1,page_items:null,reported_total:null,list_csrf_present:false,business_answer_csrf_present_count:null}),'API_CONTRACT_DRIFT','CONTRACT_REVIEW']
  ];
  for(const [input,classification,action] of cases){
    const out=classifyContractDrift(input);
    assert.equal(out.classification,classification);assert.equal(out.action_id,action);
    assert.equal(out.contract_change_authorized,false);assert.equal(out.provider_write_authorized,false);
  }
});

test('Stage20 NO_DRIFT still does not authorize contract changes',()=>{
  const out=classifyContractDrift(evidence());
  assert.equal(out.classification,'NO_DRIFT');
  assert.equal(out.action_id,'KEEP_BLOCKED');
  assert.equal(out.policy_version,CONTRACT_DRIFT_POLICY_VERSION);
  assert.equal(out.endpoint_change_authorized,false);
  assert.equal(out.selector_change_authorized,false);
});

test('Stage20 AI prompt contains sanitized evidence only and forbids contract invention',()=>{
  const prompt=buildContractDriftPrompt(evidence());
  assert.match(prompt.system,/не предлагаешь новый URL/i);
  assert.match(prompt.system,/не выполняешь действий/i);
  assert.doesNotMatch(prompt.user,/https:\/\/|selector|cookie_value|csrf_token|password/i);
});

test('Stage20 AI diagnosis accepts only allowlisted diagnosis and never authorizes patching',async()=>{
  const out=await diagnoseContractDrift(evidence({result:'TIMEOUT',error_code:'SERVER_CSRF_NAVIGATION_FAILED',
    http_status:null,content_type:'UNKNOWN',final_path_kind:'UNKNOWN',same_org_segment:false,
    preload_marker:false,csrf_key_occurrences:0,csrf_candidate_count:0,body_bytes:null}),
    async()=>JSON.stringify({classification:'BROWSER_NAVIGATION_DRIFT',action_id:'CONTRACT_REVIEW',
      reason_code:'SERVER_CSRF_NAVIGATION_FAILED',confidence:'HIGH',summary_code:'NAVIGATION_CONTRACT_REVIEW'}));
  assert.equal(out.action_id,'CONTRACT_REVIEW');
  assert.equal(out.contract_change_authorized,false);
  assert.equal(out.endpoint_change_authorized,false);
  assert.equal(out.selector_change_authorized,false);
});

test('Stage20 AI rejects invented endpoint-repair actions',async()=>{
  await assert.rejects(()=>diagnoseContractDrift(evidence(),async()=>JSON.stringify({
    classification:'PAGE_PATH_DRIFT',action_id:'REPLACE_ENDPOINT',
    reason_code:'PATH_CHANGED',confidence:'HIGH',summary_code:'AUTO_FIX'
  })),/AI_CONTRACT_DRIFT_OUTPUT_INVALID/);
});

test('Stage20 manager persists deterministic diagnosis over injected safe probes',async()=>{
  const writes=[];
  const result=await runContractDriftManager({
    pageProbe:async()=>page({result:'TIMEOUT',error_code:'SERVER_CSRF_NAVIGATION_FAILED',
      http_status:null,content_type:'UNKNOWN',final_path_kind:'UNKNOWN',same_org_segment:false,
      preload_marker:false,csrf_key_occurrences:0,csrf_candidate_count:0,body_bytes:null}),
    apiProbe:async()=>({ok:true,operation:'server_browser_read',session_revision:6,provider_requests:1,
      provider_writes:0,page_items:20,reported_total:73,list_csrf_present:true,business_answer_csrf_present_count:20}),
    now:()=>new Date('2026-09-22T18:00:00Z'),persistFn:v=>writes.push(v)
  });
  assert.equal(result.diagnosis.classification,'BROWSER_NAVIGATION_DRIFT');
  assert.equal(writes.length,1);
  assert.equal(writes[0].provider_writes,0);
});

test('Stage20 browser probe is GET/HEAD document-only with JS disabled and reply endpoint blocked',()=>{
  const src=readFileSync(new URL('../tools/yandex-contract-drift/browser-contract-probe.mjs',import.meta.url),'utf8');
  assert.match(src,/setScriptExecutionDisabled/);
  assert.match(src,/resourceType==='Document'/);
  assert.match(src,/\['GET','HEAD'\]/);
  assert.match(src,/business-answer/);
  assert.doesNotMatch(src,/method:'POST'/);
});

test('Stage20 systemd boundaries keep root manager network-off and AI isolated from evidence files',()=>{
  const service=readFileSync(new URL('../tools/yandex-contract-drift/review-yandex-contract-drift.service',import.meta.url),'utf8');
  const ai=readFileSync(new URL('../tools/yandex-contract-drift/review-ai-contract-drift.service',import.meta.url),'utf8');
  const timer=readFileSync(new URL('../tools/yandex-contract-drift/review-yandex-contract-drift.timer',import.meta.url),'utf8');
  assert.match(service,/PrivateNetwork=yes/);
  assert.match(service,/RestrictAddressFamilies=AF_UNIX/);
  assert.match(ai,/User=review-ai-ops/);
  assert.match(ai,/InaccessiblePaths=.*review-activator-ops/);
  assert.match(ai,/LoadCredential=openai-api-key/);
  assert.match(timer,/OnUnitActiveSec=1h/);
  assert.doesNotMatch(service,/RA_YANDEX_REPLY_WRITE_ENABLED=true/);
});
