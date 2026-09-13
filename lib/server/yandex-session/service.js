import { fetchYandexReviews, parseYandexReviewsPayload, diagnoseYandexReviewsPayload, createYandexPageNumbering, toReviewExternalReview } from '../../providers/yandex.js';
import { planReviewPersistence } from '../review-persistence-plan.js';
import { scopeOf, encryptSession, decryptSession, serverOnly, fail, FAILURE_CODES } from './crypto.js';
import { createYandexReadTransport } from './transport.js';
import { sendSessionAlert } from './alerts.js';
import { probePagination } from './pagination-probe.js';
import { createDryRunReport } from './dry-run-report.js';

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

export function createYandexSessionService({ store, keyring, allowRead = false, fetchImpl, notify = sendSessionAlert, now = () => new Date(), persistenceWriter = null }) {
  serverOnly();
  async function get(scope) {
    serverOnly();
    const row = await store.read(scope);
    if (row && (row.company_id !== scope.companyId || row.location_id !== scope.locationId || row.external_org_id !== scope.organizationId)) fail('SESSION_SCOPE_INVALID');
    return row;
  }
  async function run(input, { mode = 'health', pageBase, maxPages = 20, safeReport = false, persistenceExpected = 'any' } = {}) {
    serverOnly();
    const scope = scopeOf(input), numbering = createYandexPageNumbering(pageBase);
    if (!['health','dry_run','probe','pagination_probe','persist'].includes(mode)) fail('SESSION_MODE_INVALID');
    if(typeof safeReport!=='boolean'||(safeReport&&mode!=='dry_run'))fail('SESSION_MODE_INVALID');
    if (!['any','empty','same'].includes(persistenceExpected) || (mode !== 'persist' && persistenceExpected !== 'any')) fail('SESSION_MODE_INVALID');
    const row = await get(scope);
    if (!row || row.state === 'DISABLED') return { ok: false, ...metadata(row), reviewPersistence: 'OFF' };
    if (allowRead !== true) fail('LIVE_READ_NOT_APPROVED');
    let transportCode, paginationProbe, dryRunReport, persistenceResult, pagesFetched = 0;
    const audit=safeReport?createDryRunReport(now()):null;
    const evidence = { time_created: {}, public_rating: {}, idConsistency: { equal: 0, different: 0, missing: 0 } };
    try {
      const session = decryptSession(scope, row, keyring, now().getTime());
      const http = createYandexReadTransport({ scope, session, allowRead, fetchImpl });
      const read = async request => {
        // Replacement/disable invalidates in-flight results, and stops subsequent pages.
        const current = await get(scope);
        if (!current || current.revision !== row.revision || current.state === 'DISABLED') fail('SESSION_CHANGED');
        try { return await http(request); }
        catch (error) { transportCode = error.code; throw error; }
      };
      const transport = async request => {
        try {
          const payload = await read(request);
          // Existing parser is also the health/contract gate, not a second normalizer.
          parseYandexReviewsPayload(payload, scope.organizationId);
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
      const next = await store.transition(scope, row.revision, { state: 'READY', auth_ok: true, sync_ok: mode === 'dry_run' || mode === 'persist', error_code: null });
      return { ok: true, ...metadata(next), mode, seen, newCount, pagesFetched, evidence, pageEvidence,
        ...(persistenceResult ? { persistenceResult } : {}),
        ...(paginationProbe ? { paginationProbe } : {}),
        ...(dryRunReport ? { dryRunReport } : {}),
        pageBaseStatus: dryRunReport ? 'PAGE BASE VALIDATED BY FULL DRY-RUN' :
          paginationProbe?.confirmed ? 'PAGE BASE CONFIRMED BY LIMITED PROBE' : numbering.status,
        reviewPersistence: mode === 'persist' ? 'ON' : 'OFF' };
    } catch (error) {
      if (error.code === 'SESSION_CHANGED' || transportCode === 'SESSION_CHANGED') fail('SESSION_CHANGED');
      const code = FAILURE_CODES.has(transportCode) ? transportCode : FAILURE_CODES.has(error.code) ? error.code : 'SESSION_OPERATION_FAILED';
      const next = await store.transition(scope, row.revision, { state: reauth.has(code) ? 'REAUTH_REQUIRED' : 'ERROR', error_code: code, auth_ok: false, sync_ok: false });
      const claim = await store.claimAlert(scope, next.revision);
      let alert = 'DEDUPLICATED';
      if (claim.claimed) {
        try { alert = await notify({ scope, state: next.state, category: code, timestamp: now().toISOString(), incidentId: claim.incident_id }); }
        catch { alert = 'FAILED'; }
      }
      return { ok: false, ...metadata(next), alert, reviewPersistence: 'OFF',
        ...(safeReport ? { dryRunFailure: {
          collision: code === 'REVIEW_SCOPE_COLLISION' ? 'DETECTED' : 'NOT_CONFIRMED',
          scopeFailure: ['REVIEW_SCOPE_REQUIRED','YANDEX_COMPANY_SCOPE_REQUIRED','YANDEX_LOCATION_SCOPE_REQUIRED'].includes(error.code) ? 'DETECTED' : 'NOT_CONFIRMED',
          partialSuccess: false
        } } : {}),
        ...(paginationProbe ? { paginationProbe, evidence } : {}) }; // Only completed, safe diagnostic aggregates; never partial reviews.
    }
  }
  return {
    status: async input => metadata(await get(scopeOf(input))),
    contractDiagnostic: async input => {
      serverOnly();
      const scope = scopeOf(input);
      const numbering = createYandexPageNumbering(1);
      const row = await get(scope);
      const base = {
        ok: false, operation: 'contract_diagnostic', page: numbering.pageAt(0),
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
      try {
        session = decryptSession(scope, row, keyring, now().getTime());
        const http = createYandexReadTransport({
          scope, session, allowRead,
          fetchImpl: async (...args) => {
            requests += 1;
            const response = await (fetchImpl ?? globalThis.fetch)(...args);
            httpStatus = Number.isSafeInteger(response?.status) ? response.status : null;
            const header = response?.headers?.get?.('content-type');
            contentType = typeof header === 'string' && header.length <= 120 ? header : null;
            return response;
          }
        });
        const payload = await http(requestFor(scope, numbering.pageAt(0)));
        const diagnostic = diagnoseYandexReviewsPayload(payload, scope.organizationId);
        return {
          ...base,
          ok: diagnostic.ok,
          error: diagnostic.ok ? null : diagnostic.parser.code,
          http_status: httpStatus,
          content_type: contentType,
          yandex_requests: requests,
          parser: diagnostic.parser,
          schema: diagnostic.schema,
          pagination: diagnostic.pagination
        };
      } catch (error) {
        return {
          ...base,
          error: FAILURE_CODES.has(error?.code) ? error.code : 'SESSION_OPERATION_FAILED',
          http_status: httpStatus ?? (Number.isSafeInteger(error?.httpStatus) ? error.httpStatus : null),
          content_type: contentType,
          yandex_requests: requests
        };
      } finally {
        if (session?.cookies) for (const cookie of session.cookies) if (cookie) cookie.value = '';
      }
    },
    importSession: async (input, material, expectedRevision) => {
      serverOnly(); const scope = scopeOf(input);
      const encrypted = encryptSession(scope, material, keyring, now().getTime());
      return metadata(await store.replace(scope, expectedRevision, encrypted));
    },
    rotateKey: async (input, expectedRevision) => {
      const scope = scopeOf(input), row = await get(scope);
      if (!row || row.revision !== expectedRevision || row.state === 'DISABLED') fail('SESSION_CHANGED');
      const encrypted = encryptSession(scope, decryptSession(scope, row, keyring, now().getTime()), keyring, now().getTime());
      return metadata(await store.replace(scope, expectedRevision, encrypted));
    },
    disable: async (input, expectedRevision) => {
      const scope = scopeOf(input), row = await get(scope);
      if (!row || row.state === 'DISABLED') return metadata(row);
      return metadata(await store.transition(scope, expectedRevision, { state: 'DISABLED', error_code: null, auth_ok: false, sync_ok: false }));
    },
    run
  };
}
