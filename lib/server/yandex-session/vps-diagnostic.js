// Operation adapter only; fetching/parsing remain in the existing service.
// A failed bounded full read may update health through CAS, never reviews.
import {FAILURE_CODES,fail} from './crypto.js';
const reauth=new Set(['YANDEX_HTTP_401','YANDEX_HTTP_403','YANDEX_LOGIN_REDIRECT','YANDEX_LOGIN_HTML','YANDEX_CHALLENGE','SESSION_COOKIE_INVALID']);
export async function runVpsDiagnostic({service,store,scope,row,operation}) {
  if(operation==='health')return service.run(scope,{mode:'health',pageBase:1});
  if(operation==='mutable-full'){
    if(row?.state!=='ERROR'||Number(row?.revision)!==3)fail('SESSION_CHANGED');
    const result=await service.contractDiagnosticFull(scope,{expectedRevision:3,paginationMode:'MUTABLE_OFFSET'});
    // Diagnostics never force ERROR/READY on failure. Only a fully accepted
    // read permits this one health CAS; no sync timestamp or review write.
    if(!result.ok)return {...result,state:null,stateCas:'NOT_RUN'};
    if(!['STRICT_STABLE_COMPLETE','MUTABLE_TOTAL_COMPLETE'].includes(result.pagination_report?.classification)||
        result.scope_valid!==true||result.contract_valid!==true)fail('YANDEX_PAGINATION_CHANGED');
    try{
      const next=await store.transition(scope,3,{state:'READY',auth_ok:true,sync_ok:false,error_code:null});
      if(next.state!=='READY'||Number(next.revision)!==4)fail('SESSION_CHANGED');
      return {...result,state:next.state,revision:Number(next.revision),stateCas:'SUCCESS',session_mutations:'HEALTH_CAS_ONLY',
        last_session_check_at:next.last_session_check_at??null,last_successful_sync_at:next.last_successful_sync_at??null};
    }catch{return {...result,ok:false,error:'SESSION_STORAGE_FAILED',state:null,revision:null,stateCas:'NOT_CONFIRMED',session_mutations:'UNKNOWN'};}
  }
  if(operation!=='full')fail('SESSION_MODE_INVALID');
  const result=await service.contractDiagnosticFull(scope,{expectedRevision:Number(row.revision)});
  if(result.ok||result.error==='SESSION_CHANGED')return {...result,state:result.ok?row.state:null};
  // Only classify failures for which the existing SQL contract permits a health
  // transition. Schema/crypto/storage uncertainty does not force READY or retry.
  const code=result.error;
  if(!FAILURE_CODES.has(code)||!(/^(YANDEX_|SESSION_COOKIE_INVALID$)/.test(code)))return {...result,state:null};
  try {
    const next=await store.transition(scope,row.revision,{state:reauth.has(code)?'REAUTH_REQUIRED':'ERROR',
      error_code:code,auth_ok:false,sync_ok:false});
    return {...result,state:next.state,revision:Number(next.revision),stateCas:'SUCCESS'};
  }catch{return {...result,state:null,revision:null,stateCas:'NOT_CONFIRMED'};}
}
