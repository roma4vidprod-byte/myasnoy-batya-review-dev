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

// Shared service-role boundary; fixed project and explicit RPC allowlist.
export async function requestDevServiceRpc(name, payload, {
  key = process.env.SUPABASE_SERVICE_ROLE_KEY, fetchImpl = (...args) => globalThis.fetch(...args)
} = {}) {
  if (typeof window !== 'undefined') fail('SERVER_ONLY');
  if (!['review_enqueue_due_syncs','review_yandex_session_store'].includes(name)) fail('SERVER_RPC_NOT_ALLOWED');
  const credential = serviceKey(key);
  try {
    const headers = { apikey: credential, 'Content-Type': 'application/json' };
    if (!credential.startsWith('sb_secret_')) headers.Authorization = `Bearer ${credential}`;
    const response = await fetchImpl(RPC_ROOT + name, {
      method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000), redirect: 'error'
    });
    const data = await response.json();
    if (!response.ok) {
      if (name === 'review_yandex_session_store' && ['SESSION_CHANGED','SESSION_SCOPE_INVALID'].includes(data?.message)) fail(data.message);
      fail('SERVER_SYNC_FAILED');
    }
    return data;
  } catch (error) {
    fail(['SESSION_CHANGED','SESSION_SCOPE_INVALID'].includes(error.code) ? error.code : 'SERVER_SYNC_FAILED');
  }
}

export const enqueueDueSyncs = createServerSyncBoundary();
