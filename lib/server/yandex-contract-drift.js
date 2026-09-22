export const CONTRACT_DRIFT_POLICY_VERSION='yandex-contract-drift-v1';

const fail=code=>{throw Object.assign(new Error(code),{code});};
const SAFE_CODE=/^[A-Z0-9_]{1,64}$/;
const PAGE_RESULTS=new Set(['PASS','FAIL','TIMEOUT']);
const API_RESULTS=new Set(['PASS','FAIL']);
const PATH_KINDS=new Set(['EXPECTED_PAGE','SAME_ORG_OTHER','YANDEX_OTHER','PASSPORT','FOREIGN','UNKNOWN']);
const CONTENT_KINDS=new Set(['HTML','JSON','OTHER','UNKNOWN']);
const ACTIONS=new Set(['KEEP_BLOCKED','OPERATOR_REAUTH','OPERATOR_CHALLENGE','CONTRACT_REVIEW','WAIT_AND_RECHECK']);

const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).sort().join()===keys.slice().sort().join();
const int=(v,{nullable=false,max=1000000}={})=>{
  if(nullable&&v===null)return null;
  if(!Number.isSafeInteger(v)||v<0||v>max)fail('CONTRACT_DRIFT_EVIDENCE_INVALID');
  return v;
};
const code=v=>{
  if(v===null)return null;
  if(typeof v!=='string'||!SAFE_CODE.test(v))fail('CONTRACT_DRIFT_EVIDENCE_INVALID');
  return v;
};

export function sanitizeContractDriftEvidence(value){
  if(!exact(value,['version','page','api']))fail('CONTRACT_DRIFT_EVIDENCE_INVALID');
  if(value.version!==1)fail('CONTRACT_DRIFT_EVIDENCE_INVALID');
  const p=value.page,a=value.api;
  if(!exact(p,['result','error_code','http_status','content_type','final_path_kind','same_org_segment',
    'preload_marker','csrf_key_occurrences','csrf_candidate_count','challenge_marker','login_marker',
    'document_requests','blocked_requests','blocked_non_get','reply_endpoint_attempts','body_bytes',
    'session_revision','provider_writes']))fail('CONTRACT_DRIFT_EVIDENCE_INVALID');
  if(!exact(a,['result','error_code','session_revision','provider_requests','provider_writes',
    'page_items','reported_total','list_csrf_present','business_answer_csrf_present_count']))
    fail('CONTRACT_DRIFT_EVIDENCE_INVALID');

  const page=Object.freeze({
    result:PAGE_RESULTS.has(p.result)?p.result:fail('CONTRACT_DRIFT_EVIDENCE_INVALID'),
    error_code:code(p.error_code),
    http_status:int(p.http_status,{nullable:true,max:599}),
    content_type:CONTENT_KINDS.has(p.content_type)?p.content_type:fail('CONTRACT_DRIFT_EVIDENCE_INVALID'),
    final_path_kind:PATH_KINDS.has(p.final_path_kind)?p.final_path_kind:fail('CONTRACT_DRIFT_EVIDENCE_INVALID'),
    same_org_segment:p.same_org_segment===true,
    preload_marker:p.preload_marker===true,
    csrf_key_occurrences:int(p.csrf_key_occurrences),
    csrf_candidate_count:int(p.csrf_candidate_count),
    challenge_marker:p.challenge_marker===true,
    login_marker:p.login_marker===true,
    document_requests:int(p.document_requests,{max:20}),
    blocked_requests:int(p.blocked_requests,{max:500}),
    blocked_non_get:int(p.blocked_non_get,{max:500}),
    reply_endpoint_attempts:int(p.reply_endpoint_attempts,{max:20}),
    body_bytes:int(p.body_bytes,{nullable:true,max:4000000}),
    session_revision:int(p.session_revision,{max:1000000}),
    provider_writes:int(p.provider_writes,{max:20})
  });
  const api=Object.freeze({
    result:API_RESULTS.has(a.result)?a.result:fail('CONTRACT_DRIFT_EVIDENCE_INVALID'),
    error_code:code(a.error_code),
    session_revision:int(a.session_revision,{max:1000000}),
    provider_requests:int(a.provider_requests,{max:20}),
    provider_writes:int(a.provider_writes,{max:20}),
    page_items:int(a.page_items,{nullable:true,max:1000}),
    reported_total:int(a.reported_total,{nullable:true,max:1000000}),
    list_csrf_present:a.list_csrf_present===true,
    business_answer_csrf_present_count:int(a.business_answer_csrf_present_count,{nullable:true,max:1000})
  });
  if(page.provider_writes!==0||api.provider_writes!==0||page.reply_endpoint_attempts!==0)
    fail('CONTRACT_DRIFT_UNSAFE_EVIDENCE');
  if(page.session_revision!==api.session_revision&&api.session_revision!==0)
    fail('CONTRACT_DRIFT_REVISION_MISMATCH');
  return Object.freeze({version:1,page,api});
}

export function classifyContractDrift(input){
  const e=sanitizeContractDriftEvidence(input);
  let classification='NO_DRIFT',action_id='KEEP_BLOCKED',reason_code='CONTRACT_OK';

  if(e.page.challenge_marker){
    classification='CHALLENGE_SURFACE';action_id='OPERATOR_CHALLENGE';reason_code='YANDEX_CHALLENGE';
  }else if(e.page.final_path_kind==='PASSPORT'||e.page.login_marker||
           ['YANDEX_LOGIN_REDIRECT','YANDEX_HTTP_401','YANDEX_HTTP_403'].includes(e.api.error_code)){
    classification='AUTH_CONTRACT_DRIFT';action_id='OPERATOR_REAUTH';reason_code=e.api.error_code||'YANDEX_LOGIN_REDIRECT';
  }else if(e.page.result==='TIMEOUT'||e.page.error_code==='SERVER_CSRF_NAVIGATION_FAILED'){
    classification='BROWSER_NAVIGATION_DRIFT';action_id='CONTRACT_REVIEW';reason_code='SERVER_CSRF_NAVIGATION_FAILED';
  }else if(e.page.result==='FAIL'&&e.page.final_path_kind==='SAME_ORG_OTHER'){
    classification='PAGE_PATH_DRIFT';action_id='CONTRACT_REVIEW';reason_code='YANDEX_PAGE_PATH_DRIFT';
  }else if(e.page.result==='PASS'&&!e.page.preload_marker){
    classification='PRELOAD_CONTRACT_DRIFT';action_id='CONTRACT_REVIEW';reason_code='YANDEX_PRELOAD_MISSING';
  }else if(e.page.result==='PASS'&&e.page.preload_marker&&e.page.csrf_key_occurrences===0){
    classification='CSRF_CONTRACT_DRIFT';action_id='CONTRACT_REVIEW';reason_code='YANDEX_CSRF_MARKER_MISSING';
  }else if(e.api.result==='FAIL'){
    classification='API_CONTRACT_DRIFT';action_id='CONTRACT_REVIEW';reason_code=e.api.error_code||'YANDEX_API_READ_FAILED';
  }else if(e.page.result!=='PASS'||e.page.http_status!==200||e.page.content_type!=='HTML'||
           e.page.final_path_kind!=='EXPECTED_PAGE'){
    classification='UNKNOWN_CONTRACT_DRIFT';action_id='KEEP_BLOCKED';reason_code=e.page.error_code||'YANDEX_CONTRACT_UNKNOWN';
  }
  if(!ACTIONS.has(action_id))fail('CONTRACT_DRIFT_CLASSIFIER_INVALID');
  return Object.freeze({
    ok:true,policy_version:CONTRACT_DRIFT_POLICY_VERSION,
    classification,action_id,reason_code,
    contract_change_authorized:false,provider_write_authorized:false,
    endpoint_change_authorized:false,selector_change_authorized:false
  });
}

export const CONTRACT_DRIFT_CLASSIFICATIONS=Object.freeze([
  'NO_DRIFT','CHALLENGE_SURFACE','AUTH_CONTRACT_DRIFT','BROWSER_NAVIGATION_DRIFT',
  'PAGE_PATH_DRIFT','PRELOAD_CONTRACT_DRIFT','CSRF_CONTRACT_DRIFT',
  'API_CONTRACT_DRIFT','UNKNOWN_CONTRACT_DRIFT'
]);
export const CONTRACT_DRIFT_ACTIONS=Object.freeze([...ACTIONS]);
