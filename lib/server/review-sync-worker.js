import { timingSafeEqual } from 'node:crypto';
import { createYandexSessionService } from './yandex-session/service.js';
import { createSessionStore } from './yandex-session/store.js';
import { keyringFromEnv, serverOnly, fail, FAILURE_CODES } from './yandex-session/crypto.js';
import { createReviewPersistenceWriter } from './review-persistence-writer.js';
import { requestDevServiceRpc } from './review-sync.js';

export const ASBEST_SYNC_SCOPE = Object.freeze({
  organizationId: '54309413522',
  companyId: '13f3cb80-487a-4a19-96a1-fb3103200230',
  locationId: '9a95f63b-18e6-447b-a449-8530b67ddbae'
});
export const ASBEST_SYNC_ACCOUNT = 'myasnoibatya-zakaz';
export const ASBEST_PAGE_BASE = 1;
export const ASBEST_READ_APPROVAL = 'asbest-read-only-v1';

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
  getSecret = () => process.env.REVIEW_WORKER_SECRET
} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
    }
    if (!authorizedWorkerRequest(req, getSecret())) {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
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
