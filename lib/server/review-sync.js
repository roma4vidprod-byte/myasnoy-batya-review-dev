import { safeReconciliationSuccess, reconciliationError, isReconciliationError } from './reconciliation-result.js';
import { requireCloudProfile } from './runtime-profile.js';
// Server-only scheduler boundary. No browser credentials and no Yandex transport.
const PROJECT_REF = 'ykiubttldgyjpajmsuas';
const RPC_ROOT = `https://${PROJECT_REF}.supabase.co/rest/v1/rpc/`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = code => { throw Object.assign(new Error(code), { code }); };

function serviceKey(value) {
  if (typeof value !== 'string' || !value || value !== value.trim()) fail('SERVER_SYNC_NOT_CONFIGURED');
  if (/^sb_secret_[A-Za-z0-9_-]+$/.test(value)) return value;
  // Configuration guard only; signature verification belongs to Supabase, not this parser.
  try {
    const parts = value.split('.');
    if (parts.length !== 3) throw new Error();
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (claims.role !== 'service_role' || claims.ref !== PROJECT_REF) throw new Error();
    return value;
  } catch {
    fail('SERVER_SYNC_NOT_CONFIGURED');
  }
}

export function createServerSyncBoundary({
  getConfig = () => ({
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    companyId: process.env.REVIEW_SYNC_COMPANY_ID
  }),
  fetchImpl = (...args) => globalThis.fetch(...args)
} = {}) {
  return async function enqueueDueSyncs() {
    requireCloudProfile();
    if (typeof window !== 'undefined') fail('SERVER_ONLY');
    const config = getConfig();
    serviceKey(config?.serviceKey);
    if (typeof config?.companyId !== 'string' || !uuid.test(config.companyId)) fail('SERVER_SYNC_NOT_CONFIGURED');
    const result = await requestDevServiceRpc('review_enqueue_due_syncs', { p_company_id: config.companyId },
      { key: config.serviceKey, fetchImpl });
    if (!Number.isSafeInteger(result) || result < 0) fail('SERVER_SYNC_CONTRACT_DRIFT');
    return result;
  };
}

export function createYandexConnectionReconciliation({
  rpc = requestDevServiceRpc
} = {}) {
  if (typeof window !== 'undefined') fail('SERVER_ONLY');
  return async function reconcileYandexConnection() {
    requireCloudProfile();
    const result = await rpc('review_reconcile_yandex_connection', {
      p_company_id: '13f3cb80-487a-4a19-96a1-fb3103200230',
      p_location_id: '9a95f63b-18e6-447b-a449-8530b67ddbae',
      p_org_id: '54309413522'
    });
    const projected = safeReconciliationSuccess(result);
    if (!projected.ok) throw reconciliationError(null, 'RPC_RESPONSE_INVALID');
    return { ...projected, operation: 'reconcile_connection' };
  };
}

// Shared service-role boundary; fixed project and explicit RPC allowlist.
export async function requestDevServiceRpc(name, payload, {
  key = process.env.SUPABASE_SERVICE_ROLE_KEY, fetchImpl = (...args) => globalThis.fetch(...args)
} = {}) {
  requireCloudProfile();
  if (typeof window !== 'undefined') fail('SERVER_ONLY');
  if (![
    'review_enqueue_due_syncs',
    'review_claim_next_sync_run',
    'review_complete_sync_run',
    'review_fail_sync_run',
    'review_reconcile_yandex_connection',
    'review_yandex_session_store',
    'review_persist_external_reviews'
  ].includes(name)) fail('SERVER_RPC_NOT_ALLOWED');
  const reconciliation = name === 'review_reconcile_yandex_connection';
  let credential;
  try { credential = serviceKey(key); }
  catch (error) {
    if (reconciliation) throw reconciliationError(null, 'BEFORE_RPC_DISPATCH');
    throw error;
  }
  let rpcBoundary = 'BEFORE_RPC_DISPATCH';
  const writerErrors = ['REVIEW_SCOPE_REQUIRED','REVIEW_SCOPE_INVALID','REVIEW_BATCH_INVALID','REVIEW_ROW_INVALID',
    'REVIEW_BATCH_DUPLICATE','REVIEW_RAW_PAYLOAD_INVALID','REVIEW_SCOPE_COLLISION'];
  try {
    const headers = { apikey: credential, 'Content-Type': 'application/json' };
    if (!credential.startsWith('sb_secret_')) headers.Authorization = `Bearer ${credential}`;
    const options = {method:'POST',headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(15000),redirect:'error'};
    rpcBoundary = 'RPC_TRANSPORT_UNKNOWN';
    const response = await fetchImpl(RPC_ROOT + name, options);
    rpcBoundary = 'RPC_RESPONSE_INVALID';
    const data = await response.json();
    if (!response.ok) {
      if (reconciliation) throw reconciliationError(data, 'RPC_ERROR_RESPONSE');
      if (name === 'review_yandex_session_store' && ['SESSION_CHANGED','SESSION_SCOPE_INVALID'].includes(data?.message)) fail(data.message);
      if (name === 'review_persist_external_reviews' && ['P0001','22023'].includes(data?.code) && writerErrors.includes(data?.message)) fail(data.message);
      fail('SERVER_SYNC_FAILED');
    }
    return data;
  } catch (error) {
    if (reconciliation) {
      if (isReconciliationError(error)) throw error;
      throw reconciliationError(null, rpcBoundary);
    }
    const safeErrors = [
      'SESSION_CHANGED', 'SESSION_SCOPE_INVALID', 'REVIEW_SCOPE_INVALID',
      'REVIEW_CONNECTION_NOT_FOUND', 'SESSION_NOT_READY', 'RECONCILIATION_NOT_ALLOWED'
    ];
    // Preserve the writer's already-sanitized contract codes through this catch.
    const allowed = name === 'review_persist_external_reviews' ? [...safeErrors, ...writerErrors] : safeErrors;
    fail(allowed.includes(error?.code) ? error.code : 'SERVER_SYNC_FAILED');
  }
}

export const enqueueDueSyncs = createServerSyncBoundary();
