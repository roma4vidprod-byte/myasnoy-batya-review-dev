// Private server entrypoint: never the HTTP/default queue worker. No env file
// discovery, secret arguments, provider retries or notifications. VPS09 manual
// modes explicitly opt into the existing atomic writer after complete read only.
import {openSync,closeSync,fstatSync,readFileSync,constants} from 'node:fs';
import {userInfo} from 'node:os';
import {createVpsSessionContext,VPS_SESSION_SCOPE as scope} from '../../lib/server/yandex-session/profile-context.js';
import {fail,decryptSessionForRequest} from '../../lib/server/yandex-session/crypto.js';
import {createSessionStore} from '../../lib/server/yandex-session/store.js';
import {createYandexSessionService} from '../../lib/server/yandex-session/service.js';
import {prepareVpsImport} from '../../lib/server/yandex-session/vps-import.js';
import {runVpsDiagnostic} from '../../lib/server/yandex-session/vps-diagnostic.js';
import {createVpsRpc} from './pg.mjs';
import {createReviewPersistenceWriter} from '../../lib/server/review-persistence-writer.js';

const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
const safeCodes=new Set(['SESSION_CHANGED','SESSION_SCOPE_INVALID','SESSION_ROLE_DENIED','SESSION_STORAGE_FAILED','SESSION_PROFILE_INVALID',
  'SESSION_IMPORT_DENIED','SESSION_IMPORT_EXPIRED','SESSION_IMPORT_REPLAY','SESSION_IMPORT_NOT_CONFIRMED','SESSION_COOKIE_EXPIRED',
  'SESSION_PLAINTEXT_SCHEMA_INVALID','SESSION_AES_GCM_AUTH_FAILED','SESSION_KEY_NOT_CONFIGURED','SESSION_NOT_READY']);
let ring,importer;
let attempted=0,completed=0;const statuses=[];
try {
  const operation=process.argv[2];
  if(process.argv.length!==3||!['status','import','health','full','page4','boundary34','mutable-full','manual-first','manual-replay'].includes(operation))fail('SESSION_MODE_INVALID');
  const manual=['manual-first','manual-replay'].includes(operation);
  const context=createVpsSessionContext(),role=userInfo().username;
  if(operation==='import'?role!=='review-yandex-import':role!=='review-yandex-reader')fail('SESSION_ROLE_DENIED');
  const rpc=createVpsRpc(),store=createSessionStore({rpc,context});
  const status=()=>rpc('review_yandex_session_store',{p_company_id:scope.companyId,p_location_id:scope.locationId,p_org_id:scope.organizationId,p_action:'status',p_expected_revision:null,p_data:{}});
  if(operation==='status'){emit({ok:true,session:await status()});}
  else {
    const fd=openSync('/etc/review-activator-yandex/session-key.json',constants.O_RDONLY|constants.O_NOFOLLOW);
    try{
      const s=fstatSync(fd);
      if(!s.isFile()||s.uid!==0||s.gid!==process.getgid()||(s.mode&0o777)!==0o640||s.nlink!==1||s.size>1024)fail('SESSION_KEY_NOT_CONFIGURED');
      const raw=readFileSync(fd);
      try{
        const value=JSON.parse(raw.toString('utf8'));
        if(Object.keys(value).sort().join()!=='key,kid'||!/^vps-yandex-[a-f0-9]{16}$/.test(value.kid)||! /^[A-Za-z0-9+/]{43}=$/.test(value.key))fail('SESSION_KEY_NOT_CONFIGURED');
        ring={currentKid:value.kid,keys:{[value.kid]:Buffer.from(value.key,'base64')}};value.key='';
      }finally{raw.fill(0);}
    }finally{closeSync(fd);}
    if(operation==='import'){
      const before=await status();
      // This acceptance allows the first VPS import only; no accidental replace.
      if(before!==null)fail('SESSION_CHANGED');
      importer=prepareVpsImport({context,keyring:ring,store,expectedRevision:0});
      emit({ok:true,operation:'import_prepare',...importer.challenge});
      const chunks=[];let size=0;
      const timer=setTimeout(()=>process.stdin.destroy(Error('SESSION_IMPORT_EXPIRED')),120000);
      try{
        for await(const chunk of process.stdin){size+=chunk.length;if(size>65002){chunk.fill(0);fail('SESSION_INPUT_INVALID');}chunks.push(chunk);}
        const bytes=Buffer.concat(chunks);
        try{emit(await importer.submit(JSON.parse(bytes.toString('utf8'))));}
        finally{bytes.fill(0);}
      }finally{clearTimeout(timer);for(const chunk of chunks)chunk.fill(0);process.stdin.destroy();}
    }else{
      const row=await store.read(scope);
      if(!row)fail('SESSION_NOT_READY');
      const validated=decryptSessionForRequest(scope,row,ring,Date.now(),context);
      for(const c of validated.cookies)c.value='';
      const persistenceRpc=manual?createVpsRpc({
        persistencePhase:operation.slice(7),persistenceRevision:Number(row.revision)
      }):null;
      const service=createYandexSessionService({store,keyring:ring,context,allowRead:true,
        allowManualPersistence:manual,persistenceWriter:manual?createReviewPersistenceWriter({rpc:persistenceRpc}):null,
        fetchImpl:async(url,options)=>{attempted++;const response=await fetch(url,options);completed++;statuses.push(response.status);return response;}});
      const result=manual?await service.persistManual(scope,{expectedRevision:Number(row.revision)}):operation==='boundary34'
        ? await service.boundaryDiagnostic(scope,{expectedRevision:3})
        : operation==='page4'
        ? await service.contractDiagnostic(scope,{page:4,expectedRevision:3})
        : await runVpsDiagnostic({service,store,scope,row,operation});
      emit({ok:result.ok,operation,state_before:row.state,revision_before:Number(row.revision),
        state:result.state??null,revision:result.revision??null,error:result.errorCode??result.error??null,
        pages:result.pagesFetched??result.pages_fetched,received:result.seen??result.received_count,
        unique:result.unique_count??null,pager_total:result.pagination?.total??null,
        completeness:result.completeness??null,attempted,completed,http_statuses:statuses,
        review_persistence:'OFF',notifications:'OFF',state_cas:result.stateCas??'NOT_RUN',
        ...(manual?{review_persistence:result.review_persistence,persistence_result:result.persistence_result,
          pagination_report:result.pagination_report,scope_valid:result.scope_valid??null,contract_valid:result.contract_valid??null,
          session_mutations:'OFF',parser:result.parser??null,network_diagnostic:result.network_diagnostic??null}:{}),
        ...(operation==='page4'?{state:result.state_after,revision:result.revision,page:result.page,
          http_status:result.http_status,content_type:result.content_type,response_bytes:result.response_bytes,
          parser:result.parser??null,contract_failure:result.contract_failure??null,
          schema:result.schema??null,pagination:result.pagination??null}:{}),
        failure_stage:result.failure_stage??null,failed_page:result.failed_page??null,
        ...(operation==='full'?{parser:result.parser??null}:{}),
        ...(operation==='mutable-full'?{pagination_report:result.pagination_report??null,
          scope_valid:result.scope_valid??null,contract_valid:result.contract_valid??null,
          last_session_check_at:result.last_session_check_at??null,last_successful_sync_at:result.last_successful_sync_at??null,
          parser:result.parser??null,session_mutations:result.session_mutations??'UNKNOWN'}:{}),
        ...(operation==='boundary34'?{diagnostic:result.diagnostic??null,pages:result.pages??[],session_mutations:'OFF'}:{})});
      if(!result.ok)process.exitCode=1;
    }
  }
}catch(error){emit({ok:false,error:safeCodes.has(error?.code)?error.code:'SESSION_OPERATION_FAILED',attempted,completed,http_statuses:statuses});process.exitCode=1;}
finally{importer?.cancel();if(ring)for(const key of Object.values(ring.keys))key.fill(0);}
