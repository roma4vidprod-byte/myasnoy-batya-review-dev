// Review Activator only. This profile deliberately cannot start business integrations.
export const BLOCKED_CREDENTIAL_NAMES = Object.freeze([
  'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_URL', 'SUPABASE_ANON_KEY',
  'YANDEX_SESSION_KEYS_JSON', 'YANDEX_SESSION_ACTIVE_KID', 'YANDEX_LIVE_READ_APPROVAL',
  'REVIEW_WORKER_SECRET', 'RESEND_API_KEY', 'REVIEW_EMAIL_API_KEY', 'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_CHAT_ID', 'OPENAI_API_KEY', 'DATABASE_URL', 'PGPASSWORD'
]);

const reject = code => { throw Object.assign(new Error(code), { code }); };
const integer = (value, fallback, min, max) => {
  if (value === undefined || value === '') return fallback;
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) reject('VPS_CONFIG_INVALID');
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) reject('VPS_CONFIG_INVALID');
  return n;
};

export function readFoundationConfig(env = process.env) {
  if (env.RA_VPS_PROFILE !== 'foundation') reject('VPS_PROFILE_REQUIRED');
  if (env.VERCEL === '1') reject('VPS_WRONG_RUNTIME');
  if (BLOCKED_CREDENTIAL_NAMES.some(name => typeof env[name] === 'string' && env[name].length)) {
    // Never disclose the value or even an exception object supplied by another component.
    reject('VPS_FOUNDATION_CREDENTIALS_FORBIDDEN');
  }
  if (env.RA_VPS_HOST && env.RA_VPS_HOST !== '127.0.0.1') reject('VPS_LOOPBACK_REQUIRED');
  if (env.RA_VPS_ENABLE_BUSINESS_ROUTES && env.RA_VPS_ENABLE_BUSINESS_ROUTES !== 'false') reject('VPS_BUSINESS_ROUTES_DISABLED');
  const sourceSha = env.RA_VPS_SOURCE_SHA || null;
  if (sourceSha !== null && !/^[0-9a-f]{40}$/.test(sourceSha)) reject('VPS_SOURCE_SHA_INVALID');
  return Object.freeze({
    profile: 'foundation', host: '127.0.0.1',
    port: integer(env.RA_VPS_PORT, 13000, 1024, 65535),
    sourceSha, // Caller declaration only, not independently verified deployment provenance.
    maxBodyBytes: 65536, maxHeaderBytes: 8192,
    bodyTimeoutMs: 5000, handlerTimeoutMs: 5000,
    headersTimeoutMs: 5000, requestTimeoutMs: 10000,
    keepAliveTimeoutMs: 1000, shutdownTimeoutMs: 3000
  });
}
