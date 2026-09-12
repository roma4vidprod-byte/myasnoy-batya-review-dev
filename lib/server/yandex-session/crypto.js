import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';

export const ORG_ID = '54309413522';
export const ACCOUNT = 'myasnoibatya-zakaz';
export const FAILURE_CODES = new Set([
  'YANDEX_HTTP_401','YANDEX_HTTP_403','YANDEX_LOGIN_REDIRECT','YANDEX_LOGIN_HTML','YANDEX_CHALLENGE',
  'YANDEX_MALFORMED_JSON','YANDEX_CONTRACT_DRIFT','YANDEX_PAGINATION_CHANGED','YANDEX_PAGINATION_LIMIT_EXCEEDED',
  'YANDEX_NETWORK_ERROR','YANDEX_HTTP_ERROR','YANDEX_RESPONSE_TOO_LARGE','SESSION_DECRYPT_FAILED',
  'SESSION_COOKIE_INVALID','PAGE_BASE_AMBIGUOUS','PAGE_BASE_MISMATCH','REVIEW_SCOPE_COLLISION','SESSION_OPERATION_FAILED'
]);
export const fail = code => { throw Object.assign(new Error(code), { code }); };
export const serverOnly = () => { if (typeof window !== 'undefined') fail('SERVER_ONLY'); };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function scopeOf(input) {
  if (!input || typeof input.companyId !== 'string' || !uuid.test(input.companyId) ||
      typeof input.locationId !== 'string' || !uuid.test(input.locationId) ||
      input.organizationId !== ORG_ID) fail('SESSION_SCOPE_INVALID');
  return { companyId: input.companyId.toLowerCase(), locationId: input.locationId.toLowerCase(), organizationId: ORG_ID };
}
function aad(scope, version) {
  if (typeof version !== 'string' || !uuid.test(version)) fail('SESSION_INPUT_INVALID');
  return Buffer.from(JSON.stringify(['ykiubttldgyjpajmsuas', 'yandex', ...Object.values(scopeOf(scope)), ACCOUNT, version]));
}
function keyAt(keyring, kid) {
  const key = keyring?.keys?.[kid];
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(kid) || !Buffer.isBuffer(key) || key.length !== 32) fail('SESSION_KEY_NOT_CONFIGURED');
  return key;
}
export function keyringFromEnv() {
  serverOnly();
  try {
    const input = JSON.parse(process.env.YANDEX_SESSION_KEYS_JSON || '{}');
    const keys = {};
    for (const [kid, value] of Object.entries(input)) {
      if (typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) fail('SESSION_KEY_NOT_CONFIGURED');
      keys[kid] = Buffer.from(value, 'base64');
    }
    const ring = { currentKid: process.env.YANDEX_SESSION_ACTIVE_KID, keys };
    keyAt(ring, ring.currentKid); return ring;
  } catch { fail('SESSION_KEY_NOT_CONFIGURED'); }
}

// Import only cookies applicable to the exact read endpoint, never whole browser state.
export function validateSession(input, now = Date.now()) {
  if (!input || Object.keys(input).some(k => !['account','cookies'].includes(k)) ||
      input.account !== ACCOUNT || !Array.isArray(input.cookies) || !input.cookies.length || input.cookies.length > 100) fail('SESSION_COOKIE_INVALID');
  const names = new Set();
  const cookies = input.cookies.map(c => {
    if (!c || Object.keys(c).some(k => !['name','value','domain','path','secure','httpOnly','expires'].includes(k)) ||
        typeof c.name !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(c.name) ||
        /csrf|xsrf|password|authorization|2fa|sms/i.test(c.name) ||
        typeof c.value !== 'string' || !/^[\x21-\x3A\x3C-\x7E]+$/.test(c.value) ||
        c.value.length > 8192 || !['yandex.ru','.yandex.ru'].includes(c.domain) || c.secure !== true ||
        !['/','/sprav','/sprav/','/sprav/api','/sprav/api/'].includes(c.path) ||
        (c.httpOnly !== undefined && typeof c.httpOnly !== 'boolean') ||
        (c.expires !== undefined && c.expires !== null && c.expires !== -1 &&
          (typeof c.expires !== 'number' || !Number.isFinite(c.expires) || c.expires * 1000 <= now)) ||
        names.has(c.name)) fail('SESSION_COOKIE_INVALID');
    names.add(c.name);
    return { name: c.name, value: c.value, domain: c.domain, path: c.path, secure: true, httpOnly: c.httpOnly ?? false, expires: c.expires ?? null };
  });
  const result = { account: ACCOUNT, cookies };
  if (Buffer.byteLength(JSON.stringify(result)) > 60000) fail('SESSION_COOKIE_INVALID');
  return result;
}
export function encryptSession(scope, input, keyring, now = Date.now()) {
  serverOnly();
  const version = randomUUID(), kid = keyring.currentKid;
  const key = keyAt(keyring, kid), iv = randomBytes(12);
  const plaintext = Buffer.from(JSON.stringify(validateSession(input, now)));
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad(scope, version));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return { credential_version: version, envelope: {
      v: 1, kid, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64')
    } };
  } finally { plaintext.fill(0); }
}
export function decryptSession(scope, stored, keyring, now = Date.now()) {
  serverOnly();
  let plaintext;
  try {
    const e = stored.envelope;
    if (!e || e.v !== 1 || Object.keys(e).sort().join() !== 'ciphertext,iv,kid,tag,v' ||
        typeof e.iv !== 'string' || !/^[A-Za-z0-9+/]{16}$/.test(e.iv) ||
        typeof e.tag !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(e.tag) ||
        typeof e.ciphertext !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(e.ciphertext) || e.ciphertext.length > 90000) throw new Error();
    const decipher = createDecipheriv('aes-256-gcm', keyAt(keyring, e.kid), Buffer.from(e.iv, 'base64'));
    decipher.setAAD(aad(scope, stored.credential_version));
    decipher.setAuthTag(Buffer.from(e.tag, 'base64'));
    plaintext = Buffer.concat([decipher.update(Buffer.from(e.ciphertext, 'base64')), decipher.final()]);
    return validateSession(JSON.parse(plaintext.toString('utf8')), now);
  } catch { fail('SESSION_DECRYPT_FAILED'); }
  finally { plaintext?.fill(0); }
}
