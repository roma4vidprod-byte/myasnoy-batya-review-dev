// Server-only scheduler boundary. No browser credentials and no Yandex transport.
const PROJECT_REF = 'ykiubttldgyjpajmsuas';
const RPC_URL = `https://${PROJECT_REF}.supabase.co/rest/v1/rpc/review_enqueue_due_syncs`;
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
    const key = serviceKey(config?.serviceKey);
    if (typeof config?.companyId !== 'string' || !uuid.test(config.companyId)) fail('SERVER_SYNC_NOT_CONFIGURED');
    let result;
    try {
      const headers = { apikey: key, 'Content-Type': 'application/json' };
      // New secret keys belong in apikey, not a JWT Authorization header.
      if (!key.startsWith('sb_secret_')) headers.Authorization = `Bearer ${key}`;
      const response = await fetchImpl(RPC_URL, {
        method: 'POST', headers,
        body: JSON.stringify({ p_company_id: config.companyId }),
        signal: AbortSignal.timeout(15000),
        redirect: 'error'
      });
      if (!response.ok) throw new Error();
      result = await response.json();
    } catch {
      fail('SERVER_SYNC_FAILED');
    }
    if (!Number.isSafeInteger(result) || result < 0) fail('SERVER_SYNC_CONTRACT_DRIFT');
    return result;
  };
}

export const enqueueDueSyncs = createServerSyncBoundary();
