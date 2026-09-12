import { fetchYandexReviews, parseYandexReviewsPayload, createYandexPageNumbering, toReviewExternalReview } from '../../providers/yandex.js';
import { planReviewPersistence } from '../review-persistence-plan.js';
import { scopeOf, encryptSession, decryptSession, serverOnly, fail, FAILURE_CODES } from './crypto.js';
import { createYandexReadTransport } from './transport.js';
import { sendSessionAlert } from './alerts.js';

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

export function createYandexSessionService({ store, keyring, allowRead = false, fetchImpl, notify = sendSessionAlert, now = () => new Date() }) {
  serverOnly();
  async function get(scope) {
    serverOnly();
    const row = await store.read(scope);
    if (row && (row.company_id !== scope.companyId || row.location_id !== scope.locationId || row.external_org_id !== scope.organizationId)) fail('SESSION_SCOPE_INVALID');
    return row;
  }
  async function run(input, { mode = 'health', pageBase, maxPages = 20 } = {}) {
    serverOnly();
    const scope = scopeOf(input), numbering = createYandexPageNumbering(pageBase);
    if (!['health','dry_run','probe'].includes(mode)) fail('SESSION_MODE_INVALID');
    const row = await get(scope);
    if (!row || row.state === 'DISABLED') return { ok: false, ...metadata(row), reviewPersistence: 'OFF' };
    if (allowRead !== true) fail('LIVE_READ_NOT_APPROVED');
    let transportCode;
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
          observe(payload, evidence); return payload;
        } catch (error) { transportCode = error.code; throw error; }
      };
      let seen = 0, newCount = null, pageEvidence;
      if (mode === 'probe') {
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
        const existing = await store.snapshot(scope, reviews.map(r => r.externalReviewId));
        const projected = reviews.map(r => toReviewExternalReview(r, { companyId: scope.companyId, locationId: scope.locationId, observedAt: now().toISOString() }));
        const plan = planReviewPersistence(projected, existing);
        seen = reviews.length; newCount = plan.operations.filter(op => op.kind === 'insert').length;
      }
      const next = await store.transition(scope, row.revision, { state: 'READY', auth_ok: true, sync_ok: mode === 'dry_run', error_code: null });
      return { ok: true, ...metadata(next), mode, seen, newCount, evidence, pageEvidence, pageBaseStatus: numbering.status, reviewPersistence: 'OFF' };
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
      return { ok: false, ...metadata(next), alert, reviewPersistence: 'OFF' }; // No partial reviews/counts.
    }
  }
  return {
    status: async input => metadata(await get(scopeOf(input))),
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
