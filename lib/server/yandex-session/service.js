import { fetchYandexReviews, parseYandexReviewsPayload, diagnoseYandexReviewsPayload, createYandexPageNumbering, toReviewExternalReview } from '../../providers/yandex.js';
import { planReviewPersistence } from '../review-persistence-plan.js';
import { scopeOf, encryptSession, decryptSession, decryptSessionClassified, serverOnly, fail, FAILURE_CODES } from './crypto.js';
import { createYandexReadTransport } from './transport.js';
import { sendSessionAlert } from './alerts.js';
import { probePagination } from './pagination-probe.js';
import { safeSchemaRule } from './preflight.js';
import { createDryRunReport } from './dry-run-report.js';
import { assertContextScope } from './profile-context.js';
import { compareYandexBoundary } from './pagination-structure.js';

const reauth = new Set(['YANDEX_HTTP_401','YANDEX_HTTP_403','YANDEX_LOGIN_REDIRECT','YANDEX_LOGIN_HTML','YANDEX_CHALLENGE','SESSION_COOKIE_INVALID']);
const metadata = row => ({
  state: row?.state ?? 'NOT_CONFIGURED', revision: Number(row?.revision ?? 0),
  lastSessionCheckAt: row?.last_session_check_at ?? null,
  lastSuccessfulSyncAt: row?.last_successful_sync_at ?? null, errorCode: row?.last_error_code ?? null
});
const requestFor = (scope, page) => ({
  method: 'GET', permanentId: scope.organizationId, page,
  url: `https://yandex.ru/sprav/api/${scope.organizationId}/reviews?ranking=by_time&source=pagination&page=${page}`
});
function observe(payload, evidence) {
  for (const item of payload.list.items) {
    for (const field of ['time_created','public_rating']) {
      const value = item[field], type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
      evidence[field][type] = (evidence[field][type] || 0) + 1;
    }
    const key = item.id == null || item.cmnt_entity_id == null ? 'missing' : String(item.id) === String(item.cmnt_entity_id) ? 'equal' : 'different';
    evidence.idConsistency[key] += 1;
  }
}

export function createYandexSessionService({ store, keyring, allowRead = false, fetchImpl, notify = sendSessionAlert, now = () => new Date(), persistenceWriter = null, context }) {
  serverOnly(context);
  if (context && persistenceWriter) fail('SESSION_MODE_INVALID');
  async function get(scope) {
    serverOnly(context);
    if (context) assertContextScope(context, scope);
    const row = await store.read(scope);
    if (row && (row.company_id !== scope.companyId || row.location_id !== scope.locationId || row.external_org_id !== scope.organizationId)) fail('SESSION_SCOPE_INVALID');
    return row;
  }
  async function run(input, { mode = 'health', pageBase, maxPages = 20, safeReport = false, persistenceExpected = 'any' } = {}) {
    serverOnly(context);
    if (context && (mode !== 'health' || pageBase !== 1)) fail('SESSION_MODE_INVALID');
    const scope = scopeOf(input), numbering = createYandexPageNumbering(pageBase);
    if (!['health','dry_run','probe','pagination_probe','persist'].includes(mode)) fail('SESSION_MODE_INVALID');
    if(typeof safeReport!=='boolean'||(safeReport&&mode!=='dry_run'))fail('SESSION_MODE_INVALID');
    if (!['any','empty','same'].includes(persistenceExpected) || (mode !== 'persist' && persistenceExpected !== 'any')) fail('SESSION_MODE_INVALID');
    if (allowRead !== true) fail('LIVE_READ_NOT_APPROVED');
    let row = null, transportCode, paginationProbe, dryRunReport, persistenceResult, pagesFetched = 0;
    let vpsMaterial;
    let stage = 'SESSION_READ', lastCompletedStage = 'NONE', stateCas = 'NOT_ATTEMPTED';
    const audit=safeReport?createDryRunReport(now()):null;
    const evidence = { time_created: {}, public_rating: {}, idConsistency: { equal: 0, different: 0, missing: 0 } };
    try {
      row = await get(scope);
      lastCompletedStage = 'SESSION_READ';
      if (!row || row.state === 'DISABLED') return { ok: false, ...metadata(row), errorCode: 'SESSION_NOT_CONFIGURED', failureStage: 'SESSION_GUARD', stateCas };
      stage = 'SESSION_GUARD';
      lastCompletedStage = 'SESSION_GUARD';
      stage = 'SESSION_DECRYPT';
      const session = decryptSession(scope, row, keyring, now().getTime(), context);
      if (context) vpsMaterial=session;
      lastCompletedStage = 'SESSION_DECRYPT';
      stage = 'REQUEST_PREPARE';
      const http = createYandexReadTransport({ scope, session, allowRead, fetchImpl, context });
      const read = async request => {
        // Replacement/disable invalidates in-flight results, and stops subsequent pages.
        stage = 'SESSION_RECHECK';
        const current = await get(scope);
        if (!current || current.revision !== row.revision || current.state === 'DISABLED') fail('SESSION_CHANGED');
        lastCompletedStage = 'SESSION_RECHECK';
        stage = 'TRANSPORT';
        try { return await http(request); }
        catch (error) { transportCode = error.code; throw error; }
      };
      const transport = async request => {
        try {
          const payload = await read(request);
          // Existing parser is also the health/contract gate, not a second normalizer.
          stage = 'PARSER';
          parseYandexReviewsPayload(payload, scope.organizationId);
          lastCompletedStage = 'PARSER';
          observe(payload, evidence); audit?.observe(payload,request.page); pagesFetched += 1; return payload;
        } catch (error) { transportCode = error.code; throw error; }
      };
      let seen = 0, newCount = null, pageEvidence, plan;
      if (mode === 'pagination_probe') {
        paginationProbe = await probePagination(page => transport(requestFor(scope, page)), scope.organizationId);
        if (!paginationProbe.confirmed) fail('PAGE_BASE_AMBIGUOUS');
        seen = paginationProbe.pages[0].items;
      } else if (mode === 'probe') {
        let zero;
        try { zero = parseYandexReviewsPayload(await transport(requestFor(scope, 0)), scope.organizationId); }
        catch (error) {
          if (error.code !== 'YANDEX_HTTP_ERROR' || ![400,404].includes(error.httpStatus)) throw error;
          transportCode = undefined; // Page 0 explicitly unsupported; page 1 must independently validate.
        }
        const one = parseYandexReviewsPayload(await transport(requestFor(scope, 1)), scope.organizationId);
        pageEvidence = { page0: zero?.pagination ?? 'UNSUPPORTED', page1: one.pagination };
        if (zero && (zero.pagination.total !== one.pagination.total || zero.pagination.limit !== one.pagination.limit)) fail('YANDEX_PAGINATION_CHANGED');
        // Both returning offset=0 is ambiguous (possible aliases). Do not invent a base.
        if (zero?.pagination.offset === 0 && one.pagination.offset === 0) fail('PAGE_BASE_AMBIGUOUS');
        const inferred = !zero && one.pagination.offset === 0 ? 1 :
          zero?.pagination.offset === 0 && one.pagination.offset === zero.pagination.limit ? 0 : null;
        if (inferred === null || inferred !== numbering.pageBase) fail('PAGE_BASE_MISMATCH');
        seen = (zero ?? one).reviews.length;
      } else if (mode === 'health') {
        const parsed = parseYandexReviewsPayload(await transport(requestFor(scope, numbering.pageAt(0))), scope.organizationId);
        if (parsed.pagination.offset !== 0) fail('PAGE_BASE_MISMATCH');
        seen = parsed.reviews.length;
      } else {
        stage = 'PERSISTENCE';
        const reviews = await fetchYandexReviews({ permanentId: scope.organizationId, transport, pageBase: numbering.pageBase, maxPages });
        const projected = reviews.map(r => toReviewExternalReview(r, { companyId: scope.companyId, locationId: scope.locationId, observedAt: now().toISOString() }));
        if (mode === 'persist') {
          if (!persistenceWriter || typeof persistenceWriter.persistNormalizedReviews !== 'function') fail('PERSISTENCE_NOT_CONFIGURED');
          const existing = await store.snapshot(scope, reviews.map(r => r.externalReviewId));
          const sameScope = existing.filter(row => row.company_id === scope.companyId && row.location_id === scope.locationId && row.provider === 'yandex');
          if (persistenceExpected === 'empty' && sameScope.length !== 0) fail('REVIEW_PREFLIGHT_NOT_EMPTY');
          if (persistenceExpected === 'same' && sameScope.length !== reviews.length) fail('REVIEW_REPLAY_SCOPE_MISMATCH');
          persistenceResult = await persistenceWriter.persistNormalizedReviews({
            companyId: scope.companyId, locationId: scope.locationId, provider: 'yandex',
            externalLocationId: scope.organizationId, reviews: projected
          });
          if (persistenceResult.seen !== reviews.length) fail('REVIEW_PERSISTENCE_RESULT_MISMATCH');
          persistenceResult = { ...persistenceResult, preexistingSameScope: sameScope.length };
        } else {
          const existing = await store.snapshot(scope, reviews.map(r => r.externalReviewId));
          plan = planReviewPersistence(projected, existing);
          if(audit)dryRunReport=audit.finish(reviews,plan);
        }
        seen = reviews.length; newCount = mode === 'persist' ? persistenceResult.inserted : plan.operations.filter(op => op.kind === 'insert').length;
      }
      stage = 'HEALTH_CAS';
      stateCas = 'ATTEMPTED';
      const next = await store.transition(scope, row.revision, { state: 'READY', auth_ok: true, sync_ok: mode === 'dry_run' || mode === 'persist', error_code: null });
      stateCas = 'SUCCESS';
      lastCompletedStage = 'HEALTH_CAS';
      return { ok: true, ...metadata(next), mode, seen, newCount, pagesFetched, evidence, pageEvidence,
        ...(persistenceResult ? { persistenceResult } : {}),
        ...(paginationProbe ? { paginationProbe } : {}),
        ...(dryRunReport ? { dryRunReport } : {}),
        pageBaseStatus: dryRunReport ? 'PAGE BASE VALIDATED BY FULL DRY-RUN' :
          paginationProbe?.confirmed ? 'PAGE BASE CONFIRMED BY LIMITED PROBE' : numbering.status,
        failureStage: null, lastCompletedStage, stateCas,
        reviewPersistence: mode === 'persist' ? 'ON' : 'OFF' };
    } catch (error) {
      const failedStage = stage;
      if (error.code === 'SESSION_CHANGED' || transportCode === 'SESSION_CHANGED') {
        throw Object.assign(new Error('SESSION_CHANGED'), {
          code: 'SESSION_CHANGED', failureStage: failedStage,
          lastCompletedStage, stateCas: 'CONFLICT'
        });
      }
      const code = FAILURE_CODES.has(transportCode) ? transportCode : FAILURE_CODES.has(error.code) ? error.code : 'SESSION_OPERATION_FAILED';
      let next = null;
      if (stateCas === 'ATTEMPTED') {
        if (error.code === 'SESSION_CHANGED' && mode !== 'health') fail('SESSION_CHANGED');
        stateCas = error.code === 'SESSION_CHANGED' ? 'CONFLICT' : 'FAILED';
      } else if (row) {
        stage = 'HEALTH_CAS';
        stateCas = 'ATTEMPTED';
        try {
          next = await store.transition(scope, row.revision, { state: reauth.has(code) ? 'REAUTH_REQUIRED' : 'ERROR', error_code: code, auth_ok: false, sync_ok: false });
          stateCas = 'SUCCESS';
        } catch { stateCas = 'FAILED'; }
      }
      if (!next) return {
        ok: false, state: null, revision: null, lastSessionCheckAt: null, lastSuccessfulSyncAt: null,
        errorCode: code, failureStage: failedStage, lastCompletedStage, stateCas, reviewPersistence: 'OFF',
        ...(safeReport ? { dryRunFailure: { collision: 'NOT_CONFIRMED', scopeFailure: 'NOT_CONFIRMED', partialSuccess: false } } : {})
      };
      let claim = { claimed: false };
      if (!context) { try { claim = await store.claimAlert(scope, next.revision); } catch { claim = { claimed: false }; } }
      let alert = 'DEDUPLICATED';
      if (claim.claimed) {
        try { alert = await notify({ scope, state: next.state, category: code, timestamp: now().toISOString(), incidentId: claim.incident_id }); }
        catch { alert = 'FAILED'; }
      }
      return { ok: false, ...metadata(next), alert, failureStage: failedStage, lastCompletedStage, stateCas, reviewPersistence: 'OFF',
        ...(safeReport ? { dryRunFailure: {
          collision: code === 'REVIEW_SCOPE_COLLISION' ? 'DETECTED' : 'NOT_CONFIRMED',
          scopeFailure: ['REVIEW_SCOPE_REQUIRED','YANDEX_COMPANY_SCOPE_REQUIRED','YANDEX_LOCATION_SCOPE_REQUIRED'].includes(error.code) ? 'DETECTED' : 'NOT_CONFIRMED',
          partialSuccess: false
        } } : {}),
        ...(paginationProbe ? { paginationProbe, evidence } : {}) }; // Only completed, safe diagnostic aggregates; never partial reviews.
    } finally {
      if (vpsMaterial?.cookies) for (const cookie of vpsMaterial.cookies) cookie.value='';
    }
  }
  // Uses the SAME transport/parser/pagination engine; unlike legacy dry_run,
  // this operation does not snapshot reviews, transition state or claim alerts.
  async function contractDiagnosticFull(input, { expectedRevision, paginationMode = 'STRICT_LEGACY' } = {}) {
    serverOnly(context);
    const scope = scopeOf(input);
    const mutable = paginationMode === 'MUTABLE_OFFSET';
    const maxPages = mutable ? 10 : 5;
    const requiredState = mutable ? 'ERROR' : 'READY';
    const deadline = AbortSignal.timeout(30000);
    let row, session, attempted = 0, completed = 0, parsedPages = 0, received = 0;
    let currentPage = null, firstPager = null, parserFailure = null, transportError = null, paginationReport = null;
    let stage = 'SESSION_READ', providerStatus = null, decrypt = 'NOT_RUN', validation = 'NOT_RUN';
    const noEffects = {review_persistence:'OFF', session_mutations:'OFF', connection_mutations:'OFF',
      queue_mutations:'OFF', notifications:'OFF'};
    const summary = () => ({operation:'contract_diagnostic_full', ...noEffects,
      revision:row ? Number(row.revision) : null, expected_revision:Number.isSafeInteger(expectedRevision)?expectedRevision:null,
      max_pages:maxPages, page_base:1, deadline_ms:30000,
      yandex_requests:attempted, transport_attempted:attempted, transport_completed:completed,
      pages_fetched:parsedPages, received_count:received, provider_http_status:providerStatus,
      decrypt,validation,...(mutable?{pagination_report:paginationReport}: {})});
    try {
      if (!['STRICT_LEGACY','MUTABLE_OFFSET'].includes(paginationMode) ||
          (mutable && (!context || expectedRevision !== 3))) fail('SESSION_MODE_INVALID');
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail('SESSION_REQUEST_INVALID');
      if (allowRead !== true) fail('LIVE_READ_NOT_APPROVED');
      row = await get(scope);
      stage = 'SESSION_GUARD';
      if (!row || Number(row.revision) !== expectedRevision) fail('SESSION_CHANGED');
      if (row.state !== requiredState) fail('SESSION_NOT_READY');
      stage = 'SESSION_DECRYPT';
      session = decryptSessionClassified(scope,row,keyring,now().getTime(),context);
      decrypt = 'PASS';validation = 'PASS';
      const http = createYandexReadTransport({scope,session,allowRead,signal:deadline,context,
        fetchImpl:async (...args) => {
          attempted += 1;
          const response = await (fetchImpl ?? globalThis.fetch)(...args);
          if (Number.isSafeInteger(response?.status)) {completed += 1;providerStatus=response.status;}
          return response;
        }});
      const recheck = async () => {
        const latest = await get(scope);
        if (!latest || latest.revision !== row.revision || latest.state !== requiredState) fail('SESSION_CHANGED');
      };
      const transport = async request => {
        currentPage=request.page;
        try {
          stage='SESSION_RECHECK';await recheck();
          if(deadline.aborted)fail('YANDEX_NETWORK_ERROR');
          stage='TRANSPORT';const payload=await http(request);
          stage='PARSER';const diagnostic=diagnoseYandexReviewsPayload(payload,scope.organizationId,
            {paginationMode,expectedOffset:(request.page-1)*20,expectedLimit:20});
          if(!diagnostic.ok){
            parserFailure={page:currentPage,code:diagnostic.parser.code,
              failure_point:diagnostic.parser.failure_point,
              contract_failure:diagnostic.contract_failure??null,
              field_stats:diagnostic.schema.fields[diagnostic.parser.failure_point] ?? null};
            fail(diagnostic.parser.code);
          }
          firstPager ??= diagnostic.pagination;
          parsedPages+=1;received+=diagnostic.schema.item_count;
          return payload;
        }catch(error){transportError=error;throw error;}
      };
      const reviews=await fetchYandexReviews({permanentId:scope.organizationId,transport,pageBase:1,maxPages,
        paginationMode,onPaginationReport:report=>{paginationReport=report;}});
      stage='PAGINATION';
      // Strict completeness for this diagnostic: a duplicate is not silently
      // accepted as a complete stable snapshot even though legacy fetch dedupes.
      if(!mutable && (reviews.length!==firstPager.total || received!==reviews.length))fail('YANDEX_PAGINATION_CHANGED');
      stage='SESSION_RECHECK';await recheck();
      return {ok:true,...summary(),validation:'PASS',failure_stage:null,parser:{code:null,failure_point:null},
        pagination:{...firstPager,hasMore:false},unique_count:reviews.length,completeness:'PASS',
        ...(mutable?{scope_valid:true,contract_valid:true}: {})};
    }catch(error){
      const cause=transportError ?? error;
      const extra=['SESSION_REQUEST_INVALID','LIVE_READ_NOT_APPROVED','SESSION_NOT_READY'];
      if(!transportError && ['YANDEX_PAGINATION_CHANGED','YANDEX_PAGINATION_LIMIT_EXCEEDED'].includes(cause?.code))stage='PAGINATION';
      const code=FAILURE_CODES.has(cause?.code)||extra.includes(cause?.code)?cause.code:'SESSION_OPERATION_FAILED';
      if(stage==='SESSION_DECRYPT'){
        decrypt=['SESSION_PLAINTEXT_INVALID_ENCODING','SESSION_PLAINTEXT_INVALID_JSON','SESSION_PLAINTEXT_SCHEMA_INVALID'].includes(code)?'PASS':
          code==='SESSION_AES_GCM_AUTH_FAILED'?'FAIL':'NOT_RUN';
        validation='FAIL';
      }
      return {ok:false,...summary(),error:code,failure_stage:stage,failed_page:currentPage,
        parser:parserFailure,completeness:'NOT_CONFIRMED',
        schema_rule:code==='SESSION_PLAINTEXT_SCHEMA_INVALID'?safeSchemaRule(cause):null};
    }finally{
      if(session?.cookies)for(const cookie of session.cookies)if(cookie)cookie.value='';
    }
  }
  return {
    contractDiagnosticFull,
    // VPS08C: fixed pair only. Never routes through run()/health/failure CAS.
    boundaryDiagnostic: async (input,{expectedRevision}={}) => {
      serverOnly(context);
      if(!context||expectedRevision!==3)fail('SESSION_MODE_INVALID');
      if(allowRead!==true)fail('LIVE_READ_NOT_APPROVED');
      const scope=scopeOf(input),row=await get(scope);
      const validRow=current=>current&&Number(current.revision)===3&&current.state==='ERROR';
      if(!validRow(row))fail('SESSION_CHANGED');
      let session,attempted=0,completed=0,currentPage=null;
      const payloads=[],pages=[];
      const base=()=>({operation:'boundary_diagnostic',state:row.state,revision:Number(row.revision),
        yandex_requests:attempted,transport_attempted:attempted,transport_completed:completed,
        pages,session_mutations:'OFF',review_persistence:'OFF',notifications:'OFF',state_cas:'NOT_RUN'});
      try{
        session=decryptSessionClassified(scope,row,keyring,now().getTime(),context);
        const recheck=async()=>{if(!validRow(await get(scope)))fail('SESSION_CHANGED');};
        const http=createYandexReadTransport({scope,session,allowRead,context,
          observeSize:size=>{pages.at(-1).response_bytes=size;},
          fetchImpl:async(...args)=>{
            attempted++;const response=await(fetchImpl??globalThis.fetch)(...args);completed++;
            const header=response?.headers?.get?.('content-type')??'';
            pages.push({page:currentPage,http_status:Number.isSafeInteger(response?.status)?response.status:null,
              content_type:/^application\/(?:[a-z0-9.-]+\+)?json(?:;|$)/i.test(header)?'application/json':'NON_JSON',response_bytes:null});
            return response;
          }});
        for(const page of [3,4]){
          currentPage=page;await recheck();
          const payload=await http(requestFor(scope,page));
          // Page 3 must be the known full offset40/limit20 page before page 4.
          if(page===3){const parsed=parseYandexReviewsPayload(payload,scope.organizationId);
            if(parsed.pagination.limit!==20||parsed.pagination.offset!==40)fail('YANDEX_PAGINATION_CHANGED');}
          payloads.push(payload);
        }
        await recheck();
        const diagnostic=compareYandexBoundary(payloads[0],payloads[1],scope.organizationId);
        return {ok:true,...base(),diagnostic};
      }catch(error){return {ok:false,...base(),failed_page:currentPage,
        error:FAILURE_CODES.has(error?.code)?error.code:'SESSION_OPERATION_FAILED'};}
      finally{
        payloads.fill(null);
        if(session?.cookies)for(const cookie of session.cookies)cookie.value='';
      }
    },
    status: async input => metadata(await get(scopeOf(input))),
    contractDiagnostic: async (input, { page = 1, expectedRevision } = {}) => {
      serverOnly(context);
      // VPS08B: one specifically approved page, exact failed snapshot, no CAS.
      // Cloud callers retain their existing contract and cannot opt into VPS.
      if (context && (page !== 4 || expectedRevision !== 3)) fail('SESSION_MODE_INVALID');
      const scope = scopeOf(input);
      if (!Number.isSafeInteger(page) || page < 1 || page > 4) fail('SESSION_REQUEST_INVALID');
      const numbering = createYandexPageNumbering(1);
      const row = await get(scope);
      if (context && (!row || Number(row.revision)!==expectedRevision || row.state!=='ERROR')) fail('SESSION_CHANGED');
      const base = {
        ok: false, operation: 'contract_diagnostic', page,
        state_before: row?.state ?? 'NOT_CONFIGURED', state_after: row?.state ?? 'NOT_CONFIGURED',
        revision: Number(row?.revision ?? 0), yandex_requests: 0,
        review_persistence: 'OFF'
      };
      if (!row || row.state === 'DISABLED') return { ...base, error: 'SESSION_STORAGE_FAILED' };
      if (allowRead !== true) fail('LIVE_READ_NOT_APPROVED');
      let session;
      let requests = 0;
      let httpStatus = null;
      let contentType = null;
      let responseBytes = null;
      try {
        session = decryptSession(scope, row, keyring, now().getTime(), context);
        const recheck = async () => {
          if (!context) return;
          const current=await get(scope);
          if(!current || current.revision!==row.revision || current.state!==row.state) fail('SESSION_CHANGED');
        };
        const http = createYandexReadTransport({
          scope, session, allowRead, context, observeSize:size=>{responseBytes=size;},
          fetchImpl: async (...args) => {
            requests += 1;
            const response = await (fetchImpl ?? globalThis.fetch)(...args);
            httpStatus = Number.isSafeInteger(response?.status) ? response.status : null;
            const header = response?.headers?.get?.('content-type');
            contentType = typeof header === 'string' ? (/^application\/(?:[a-z0-9.-]+\+)?json(?:;|$)/i.test(header) ? 'application/json' : 'NON_JSON') : null;
            return response;
          }
        });
        await recheck();
        const payload = await http(requestFor(scope, page));
        const diagnostic = diagnoseYandexReviewsPayload(payload, scope.organizationId);
        await recheck();
        return {
          ...base,
          ok: diagnostic.ok,
          error: diagnostic.ok ? null : diagnostic.parser.code,
          http_status: httpStatus,
          content_type: contentType,
          response_bytes: responseBytes,
          yandex_requests: requests,
          parser: diagnostic.parser,
          contract_failure: diagnostic.contract_failure ? {...diagnostic.contract_failure,page_number:page} : null,
          schema: diagnostic.schema,
          pagination: diagnostic.pagination
        };
      } catch (error) {
        return {
          ...base,
          error: FAILURE_CODES.has(error?.code) ? error.code : 'SESSION_OPERATION_FAILED',
          http_status: httpStatus ?? (Number.isSafeInteger(error?.httpStatus) ? error.httpStatus : null),
          content_type: contentType,
          response_bytes: responseBytes,
          yandex_requests: requests
        };
      } finally {
        if (session?.cookies) for (const cookie of session.cookies) if (cookie) cookie.value = '';
      }
    },
    importSession: async (input, material, expectedRevision) => {
      serverOnly(context); const scope = scopeOf(input);
      const encrypted = encryptSession(scope, material, keyring, now().getTime(), context);
      return metadata(await store.replace(scope, expectedRevision, encrypted));
    },
    rotateKey: async (input, expectedRevision) => {
      if (context) fail('SESSION_MODE_INVALID');
      const scope = scopeOf(input), row = await get(scope);
      if (!row || row.revision !== expectedRevision || row.state === 'DISABLED') fail('SESSION_CHANGED');
      const encrypted = encryptSession(scope, decryptSession(scope, row, keyring, now().getTime()), keyring, now().getTime());
      return metadata(await store.replace(scope, expectedRevision, encrypted));
    },
    disable: async (input, expectedRevision) => {
      if (context) fail('SESSION_MODE_INVALID');
      const scope = scopeOf(input), row = await get(scope);
      if (!row || row.state === 'DISABLED') return metadata(row);
      return metadata(await store.transition(scope, expectedRevision, { state: 'DISABLED', error_code: null, auth_ok: false, sync_ok: false }));
    },
    run
  };
}
