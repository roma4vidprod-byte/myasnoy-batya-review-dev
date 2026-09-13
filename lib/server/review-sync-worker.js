import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createYandexSessionService } from './yandex-session/service.js';
import { createSessionStore } from './yandex-session/store.js';
import { keyringFromEnv, serverOnly, fail, FAILURE_CODES } from './yandex-session/crypto.js';
import { createReviewPersistenceWriter } from './review-persistence-writer.js';
import { requestDevServiceRpc } from './review-sync.js';
import { createYandexSessionRuntimeStatus } from './yandex-session/runtime-status.js';
import { runYandexHealthPreflight } from './yandex-session/preflight.js';

export const ASBEST_SYNC_SCOPE = Object.freeze({
  organizationId: '54309413522',
  companyId: '13f3cb80-487a-4a19-96a1-fb3103200230',
  locationId: '9a95f63b-18e6-447b-a449-8530b67ddbae'
});
export const ASBEST_SYNC_ACCOUNT = 'myasnoibatya-zakaz';
export const ASBEST_PAGE_BASE = 1;
export const ASBEST_READ_APPROVAL = 'asbest-read-only-v1';
export const ASBEST_IMPORT_TTL_MS = 120000;

const reauthCodes = new Set([
  'YANDEX_HTTP_401', 'YANDEX_HTTP_403', 'YANDEX_LOGIN_REDIRECT',
  'YANDEX_LOGIN_HTML', 'YANDEX_CHALLENGE', 'SESSION_COOKIE_INVALID'
]);
const safeFailureCodes = new Set([...FAILURE_CODES, 'REVIEW_WRITER_CONTRACT_DRIFT', 'SYNC_OPERATION_FAILED']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const safeCode = value => typeof value === 'string' && safeFailureCodes.has(value) ? value : 'SYNC_OPERATION_FAILED';
const integer = value => Number.isSafeInteger(value) && value >= 0;

function validateClaim(claim) {
  if (!claim || claim.claimed !== true || claim.provider !== 'yandex' ||
      claim.company_id !== ASBEST_SYNC_SCOPE.companyId ||
      claim.config?.location_id !== ASBEST_SYNC_SCOPE.locationId ||
      claim.config?.external_org_id !== ASBEST_SYNC_SCOPE.organizationId ||
      claim.external_account_id !== ASBEST_SYNC_ACCOUNT ||
      typeof claim.run_id !== 'string' || !uuid.test(claim.run_id)) {
    fail('SYNC_SCOPE_INVALID');
  }
  return claim;
}

function safeResult(result) {
  const persistence = result?.persistenceResult;
  if (!result?.ok || !persistence || !integer(result.seen) || !integer(result.pagesFetched) ||
      !integer(persistence.inserted) || !integer(persistence.updated) ||
      !integer(persistence.unchanged) || !integer(persistence.seen) ||
      persistence.seen !== result.seen ||
      persistence.inserted + persistence.updated + persistence.unchanged !== result.seen) {
    fail('REVIEW_WRITER_CONTRACT_DRIFT');
  }
  return {
    pages_fetched: result.pagesFetched,
    fetched_count: result.seen,
    inserted: persistence.inserted,
    updated: persistence.updated,
    unchanged: persistence.unchanged,
    seen: persistence.seen
  };
}

function clearKeyring(keyring) {
  if (keyring?.keys) for (const key of Object.values(keyring.keys)) key.fill(0);
}

const workerSecret = value => {
  if (typeof value !== 'string' || !value || value !== value.trim()) fail('WORKER_NOT_CONFIGURED');
  return value;
};
const encodeCapability = value => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
const signCapability = (payload, secret) => createHmac('sha256', secret).update(payload).digest('base64url');

function verifyImportCapability(capability, nonce, secret, now) {
  if (typeof capability !== 'string' || typeof nonce !== 'string') fail('SESSION_IMPORT_INVALID');
  const parts = capability.split('.');
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) {
    fail('SESSION_IMPORT_INVALID');
  }
  const expected = Buffer.from(signCapability(parts[0], secret));
  const actual = Buffer.from(parts[1]);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) fail('SESSION_IMPORT_INVALID');
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { fail('SESSION_IMPORT_INVALID'); }
  if (!payload || payload.v !== 1 || payload.account !== ASBEST_SYNC_ACCOUNT ||
      payload.companyId !== ASBEST_SYNC_SCOPE.companyId || payload.locationId !== ASBEST_SYNC_SCOPE.locationId ||
      payload.organizationId !== ASBEST_SYNC_SCOPE.organizationId || payload.nonce !== nonce ||
      !Number.isSafeInteger(payload.expiresAt) || payload.expiresAt <= now ||
      payload.expiresAt > now + ASBEST_IMPORT_TTL_MS ||
      !Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0) {
    fail('SESSION_IMPORT_INVALID');
  }
  return payload;
}

export function createYandexSessionImportPrepare({
  getSecret = () => process.env.REVIEW_WORKER_SECRET,
  serviceFactory = createYandexSessionService,
  storeFactory = () => createSessionStore(),
  now = () => Date.now()
} = {}) {
  serverOnly();
  return async function prepare() {
    const secret = workerSecret(getSecret());
    const service = serviceFactory({ store: storeFactory(), keyring: null, allowRead: false });
    const status = await service.status(ASBEST_SYNC_SCOPE);
    const expectedRevision = status.revision;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || status.state === 'DISABLED') {
      fail('SESSION_IMPORT_NOT_READY');
    }
    const expiresAt = now() + ASBEST_IMPORT_TTL_MS;
    const nonce = randomBytes(32).toString('base64');
    const payload = {
      v: 1, account: ASBEST_SYNC_ACCOUNT, companyId: ASBEST_SYNC_SCOPE.companyId,
      locationId: ASBEST_SYNC_SCOPE.locationId, organizationId: ASBEST_SYNC_SCOPE.organizationId,
      nonce, expiresAt, expectedRevision
    };
    const encoded = encodeCapability(payload);
    return { ok: true, operation: 'import_prepare', nonce, expiresAt, expectedRevision,
      capability: `${encoded}.${signCapability(encoded, secret)}` };
  };
}

export function createYandexSessionImport({
  getSecret = () => process.env.REVIEW_WORKER_SECRET,
  keyringFactory = keyringFromEnv,
  serviceFactory = createYandexSessionService,
  storeFactory = () => createSessionStore(),
  now = () => Date.now()
} = {}) {
  serverOnly();
  return async function importSession({ capability, nonce, session }) {
    const secret = workerSecret(getSecret());
    const payload = verifyImportCapability(capability, nonce, secret, now());
    let keyring;
    try {
      keyring = keyringFactory();
      const service = serviceFactory({ store: storeFactory(), keyring, allowRead: false, now: () => new Date(now()) });
      const result = await service.importSession(ASBEST_SYNC_SCOPE, session, payload.expectedRevision);
      if (result?.state !== 'NOT_CONFIGURED' || !Number.isSafeInteger(result.revision) ||
          result.revision !== payload.expectedRevision + 1) fail('SESSION_IMPORT_FAILED');
      return { ok: true, operation: 'import', state: 'NOT_CONFIGURED', revision: result.revision };
    } catch (error) {
      if (error?.code === 'SESSION_IMPORT_FAILED') throw error;
      fail('SESSION_IMPORT_FAILED');
    } finally { clearKeyring(keyring); }
  };
}

function safePreflightResult(result, operation = 'preflight') {
  return {
    ok: result.pretransport === 'PASS', operation,
    pretransport: result.pretransport,
    decrypt: result.session_decrypt,
    validation: result.session_decrypt === 'PASS' ? 'PASS' : 'FAIL',
    scope: result.scope, mode: result.mode, page_base: result.page_base,
    endpoint: result.endpoint, keyring: result.keyring_parse,
    active_kid: result.active_kid, env_present: result.env_present,
    runtime_location: result.runtime_location,
    session_state: result.session_state, revision: result.revision,
    yandex_requests: 0,
    ...(result.error ? { error: result.error } : {})
  };
}

export function createReviewSyncHealth({
  preflight = runYandexHealthPreflight,
  keyringFactory = keyringFromEnv,
  serviceFactory = createYandexSessionService,
  storeFactory = () => createSessionStore(),
  now = () => new Date()
} = {}) {
  serverOnly();
  return async function runHealth() {
    const before = await preflight();
    const base = safePreflightResult(before, 'health');
    if (!base.ok) return base;
    let keyring;
    let yandexRequests = 0;
    try {
      keyring = keyringFactory();
      const service = serviceFactory({
        store: storeFactory(), keyring, allowRead: true,
        notify: async () => 'MOCKED_NO_DELIVERY',
        fetchImpl: (...args) => { yandexRequests += 1; return globalThis.fetch(...args); }, now
      });
      const result = await service.run(ASBEST_SYNC_SCOPE, { mode: 'health', pageBase: ASBEST_PAGE_BASE });
      const response = {
        ok: result.ok === true, operation: 'health', pretransport: 'PASS',
        decrypt: 'PASS', validation: 'PASS', health_get: result.ok === true ? 'PASS' : 'FAIL',
        state_before: before.session_state, revision_before: before.revision,
        state_after: result.state ?? null, revision_after: result.revision ?? null,
        last_session_check_at: result.lastSessionCheckAt ?? null,
        last_successful_sync_at: result.lastSuccessfulSyncAt ?? null,
        seen: result.ok === true ? result.seen : 0,
        pages_fetched: result.ok === true ? result.pagesFetched : 0,
        yandex_requests: yandexRequests, review_persistence: 'OFF',
        ...(result.ok === true ? {} : { error: safeCode(result.errorCode) })
      };
      return response;
    } catch (error) {
      return {
        ok: false, operation: 'health', pretransport: 'PASS', decrypt: 'PASS', validation: 'PASS',
        health_get: yandexRequests > 0 ? 'FAIL' : 'NOT_STARTED',
        state_before: before.session_state, revision_before: before.revision,
        state_after: null, revision_after: null, last_session_check_at: null,
        last_successful_sync_at: null, seen: 0, pages_fetched: 0,
        yandex_requests: yandexRequests, review_persistence: 'OFF',
        error: safeCode(error?.code)
      };
    } finally {
      clearKeyring(keyring);
    }
  };
}

export function createReviewSyncWorker({
  rpc = requestDevServiceRpc,
  keyringFactory = keyringFromEnv,
  serviceFactory = createYandexSessionService,
  notify,
  allowRead = () => process.env.YANDEX_LIVE_READ_APPROVAL === ASBEST_READ_APPROVAL,
  now = () => new Date()
} = {}) {
  serverOnly();
  return async function runOne() {
    serverOnly();
    if (allowRead() !== true) fail('WORKER_READ_NOT_APPROVED');
    const keyring = keyringFactory();
    const claim = await rpc('review_claim_next_sync_run', { p_company_id: ASBEST_SYNC_SCOPE.companyId });
    if (!claim || claim.claimed === false) return { ok: true, claimed: false, queue: 'EMPTY' };
    let claimed = claim;
    let service;
    let result;
    try {
      claimed = validateClaim(claim);
      const store = createSessionStore({ rpc });
      service = serviceFactory({
        store,
        keyring,
        allowRead: true,
        notify,
        persistenceWriter: createReviewPersistenceWriter({ rpc }),
        now
      });
      result = await service.run(ASBEST_SYNC_SCOPE, {
        mode: 'persist', pageBase: ASBEST_PAGE_BASE, maxPages: 20, persistenceExpected: 'any'
      });
    } catch (error) {
      const code = safeCode(error?.code);
      if (claimed?.run_id) await rpc('review_fail_sync_run', {
          p_company_id: ASBEST_SYNC_SCOPE.companyId,
          p_run_id: claimed.run_id,
          p_error_code: code
        });
      return { ok: false, claimed: true, state: reauthCodes.has(code) ? 'REAUTH_REQUIRED' : 'ERROR', errorCode: code };
    }
    if (!result?.ok) {
      const code = safeCode(result.errorCode);
      await rpc('review_fail_sync_run', {
        p_company_id: ASBEST_SYNC_SCOPE.companyId,
        p_run_id: claimed.run_id,
        p_error_code: code
      });
      return { ok: false, claimed: true, state: result.state, errorCode: code };
    }
    const summary = safeResult(result);
    let completed;
    try {
      completed = await rpc('review_complete_sync_run', {
        p_company_id: ASBEST_SYNC_SCOPE.companyId,
        p_run_id: claimed.run_id,
        p_result: summary
      });
    } catch {
      await rpc('review_fail_sync_run', {
        p_company_id: ASBEST_SYNC_SCOPE.companyId,
        p_run_id: claimed.run_id,
        p_error_code: 'SYNC_OPERATION_FAILED'
      });
      return { ok: false, claimed: true, state: 'ERROR', errorCode: 'SYNC_OPERATION_FAILED' };
    }
    if (!completed || completed.status !== 'SUCCEEDED') fail('SYNC_OPERATION_FAILED');
    return { ok: true, claimed: true, state: 'READY', mode: 'persist', ...summary };
  };
}

export function authorizedWorkerRequest(req, secret) {
  if (typeof secret !== 'string' || !secret || secret !== secret.trim()) return false;
  const authorization = req?.headers?.authorization;
  if (typeof authorization !== 'string') return false;
  const actual = Buffer.from(authorization);
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createReviewSyncWorkerHandler({
  run = createReviewSyncWorker(),
  getSecret = () => process.env.REVIEW_WORKER_SECRET,
  diagnose = createYandexSessionRuntimeStatus(),
  preflight = runYandexHealthPreflight,
  health = createReviewSyncHealth(),
  importPrepare,
  importSession
} = {}) {
  const prepareImport = importPrepare ?? createYandexSessionImportPrepare({ getSecret });
  const importRemoteSession = importSession ?? createYandexSessionImport({ getSecret });
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
    }
    if (!authorizedWorkerRequest(req, getSecret())) {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
    }
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'operation')) {
      const keys = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? Object.keys(req.body) : [];
      const operation = req.body.operation;
      const allowedKeys = operation === 'import_prepare' ? ['operation'] :
        operation === 'import' ? ['operation', 'capability', 'nonce', 'session'] : ['operation'];
      if (!['preflight', 'health', 'import_prepare', 'import'].includes(operation) ||
          keys.length !== allowedKeys.length || keys.some(key => !allowedKeys.includes(key))) {
        return res.status(400).json({ ok: false, error: 'INVALID_OPERATION' });
      }
      if (operation === 'import' && Buffer.byteLength(JSON.stringify(req.body), 'utf8') > 70000) {
        return res.status(413).json({ ok: false, operation, error: 'SESSION_IMPORT_TOO_LARGE' });
      }
      try {
        const result = operation === 'preflight' ? safePreflightResult(await preflight()) :
          operation === 'health' ? await health() : operation === 'import_prepare' ?
            await prepareImport() : await importRemoteSession(req.body);
        return res.status(result.ok ? 200 : 503).json(result);
      } catch {
        return res.status(503).json({ ok: false, operation,
          ...(operation === 'import' || operation === 'import_prepare' ? { error: 'SESSION_IMPORT_FAILED' } :
            { pretransport: 'FAIL', decrypt: 'FAIL', validation: 'FAIL', error: 'SESSION_STORAGE_FAILED', yandex_requests: 0,
              review_persistence: 'OFF' }) });
      }
    }
    if (req.body?.diagnostic_only === true) {
      try {
        const result = await diagnose();
        return res.status(result.ok ? 200 : 503).json(result);
      } catch {
        return res.status(503).json({ ok: false, decrypt: 'FAIL', error: 'SESSION_STORAGE_FAILED', yandex_requests: 0, review_persistence: 'OFF' });
      }
    }
    try {
      const result = await run();
      if (result.ok && result.claimed === false) {
        return res.status(200).json({ ok: true, claimed: false });
      }
      return res.status(result.ok ? 200 : 503).json({
        ok: result.ok, claimed: result.claimed,
        ...(result.ok ? { state: result.state, mode: result.mode ?? null, seen: result.seen ?? 0,
          pagesFetched: result.pages_fetched ?? result.pagesFetched ?? 0,
          inserted: result.inserted ?? 0, updated: result.updated ?? 0, unchanged: result.unchanged ?? 0 } :
          { state: result.state ?? 'ERROR', error: result.errorCode ?? 'SYNC_OPERATION_FAILED' })
      });
    } catch {
      return res.status(503).json({ ok: false, error: 'REVIEW_SYNC_WORKER_FAILED' });
    }
  };
}

export const runReviewSyncWorker = createReviewSyncWorker();
