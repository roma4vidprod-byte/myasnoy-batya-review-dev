import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { assertSessionContext, assertContextScope } from './profile-context.js';

export const ORG_ID = '54309413522';
export const ACCOUNT = 'myasnoibatya-zakaz';
export const FAILURE_CODES = new Set([
  'YANDEX_HTTP_401','YANDEX_HTTP_403','YANDEX_LOGIN_REDIRECT','YANDEX_LOGIN_HTML','YANDEX_CHALLENGE',
  'YANDEX_MALFORMED_JSON','YANDEX_CONTRACT_DRIFT','YANDEX_PAGINATION_CHANGED','YANDEX_PAGINATION_LIMIT_EXCEEDED',
  'YANDEX_NETWORK_ERROR','YANDEX_HTTP_ERROR','YANDEX_RESPONSE_TOO_LARGE','SESSION_DECRYPT_FAILED',
  'SESSION_ENVELOPE_SCHEMA_INVALID','SESSION_KEY_NOT_FOUND','SESSION_KEY_INVALID_ENCODING',
  'SESSION_KEY_INVALID_LENGTH','SESSION_IV_INVALID','SESSION_AUTH_TAG_INVALID',
  'SESSION_CIPHERTEXT_INVALID','SESSION_AAD_INVALID','SESSION_AES_GCM_AUTH_FAILED',
  'SESSION_PLAINTEXT_INVALID_ENCODING','SESSION_PLAINTEXT_INVALID_JSON',
  'SESSION_PLAINTEXT_SCHEMA_INVALID','SESSION_COOKIE_INVALID','PAGE_BASE_AMBIGUOUS',
  'PAGE_BASE_MISMATCH','REVIEW_SCOPE_COLLISION','SESSION_STORAGE_FAILED','SESSION_CHANGED','SESSION_OPERATION_FAILED'
]);
export const SESSION_DECRYPT_FAILURE_CODES = new Set([
  'SESSION_ENVELOPE_SCHEMA_INVALID','SESSION_KEY_NOT_FOUND','SESSION_KEY_INVALID_ENCODING',
  'SESSION_KEY_INVALID_LENGTH','SESSION_IV_INVALID','SESSION_AUTH_TAG_INVALID',
  'SESSION_CIPHERTEXT_INVALID','SESSION_AAD_INVALID','SESSION_AES_GCM_AUTH_FAILED',
  'SESSION_PLAINTEXT_INVALID_ENCODING','SESSION_PLAINTEXT_INVALID_JSON',
  'SESSION_PLAINTEXT_SCHEMA_INVALID'
]);
export const SESSION_VALIDATION_RULE_CODES = new Set([
  'SESSION_MATERIAL_SHAPE_INVALID','SESSION_MATERIAL_FIELDS_INVALID','SESSION_MATERIAL_ACCOUNT_INVALID',
  'SESSION_COOKIE_COUNT_INVALID','SESSION_COOKIE_SHAPE_INVALID','SESSION_COOKIE_FIELDS_INVALID',
  'SESSION_COOKIE_NAME_INVALID','SESSION_COOKIE_PROHIBITED','SESSION_COOKIE_VALUE_INVALID',
  'SESSION_COOKIE_DOMAIN_INVALID','SESSION_COOKIE_PATH_INVALID','SESSION_COOKIE_SECURE_INVALID',
  'SESSION_COOKIE_HTTPONLY_INVALID','SESSION_COOKIE_EXPIRY_INVALID','SESSION_COOKIE_EXPIRED',
  'SESSION_COOKIE_DUPLICATE','SESSION_MATERIAL_TOO_LARGE'
]);
export const fail = code => { throw Object.assign(new Error(code), { code }); };
const failValidation = (code, path, expectedType, actual) => {
  throw Object.assign(new Error(code), {
    code,
    rule: {
      code, path, expected_type: expectedType,
      actual_type: actual === null ? 'null' : Array.isArray(actual) ? 'array' : typeof actual,
      present: actual !== undefined
    }
  });
};
export const serverOnly = context => { if (typeof window !== 'undefined') fail('SERVER_ONLY'); assertSessionContext(context); };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function scopeOf(input) {
  if (!input || typeof input.companyId !== 'string' || !uuid.test(input.companyId) ||
      typeof input.locationId !== 'string' || !uuid.test(input.locationId) ||
      input.organizationId !== ORG_ID) fail('SESSION_SCOPE_INVALID');
  return { companyId: input.companyId.toLowerCase(), locationId: input.locationId.toLowerCase(), organizationId: ORG_ID };
}
function aad(scope, version, context) {
  if (typeof version !== 'string' || !uuid.test(version)) fail('SESSION_INPUT_INVALID');
  if (context) {
    assertContextScope(context, scopeOf(scope));
    return Buffer.from(JSON.stringify([context.aadIdentity, 'yandex', ...Object.values(scopeOf(scope)), ACCOUNT, version]));
  }
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
export function validateSessionClassified(input, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    failValidation('SESSION_MATERIAL_SHAPE_INVALID', 'material', 'object', input);
  }
  if (Object.keys(input).some(k => !['account','cookies'].includes(k))) {
    failValidation('SESSION_MATERIAL_FIELDS_INVALID', 'material', 'account,cookies only', input);
  }
  if (input.account !== ACCOUNT) {
    failValidation('SESSION_MATERIAL_ACCOUNT_INVALID', 'account', 'fixed account string', input.account);
  }
  if (!Array.isArray(input.cookies) || !input.cookies.length || input.cookies.length > 100) {
    failValidation('SESSION_COOKIE_COUNT_INVALID', 'cookies', 'non-empty array with at most 100 items', input.cookies);
  }
  const names = new Set();
  const cookies = input.cookies.map(c => {
    if (!c || typeof c !== 'object' || Array.isArray(c)) {
      failValidation('SESSION_COOKIE_SHAPE_INVALID', 'cookies[*]', 'object', c);
    }
    if (Object.keys(c).some(k => !['name','value','domain','path','secure','httpOnly','expires'].includes(k))) {
      failValidation('SESSION_COOKIE_FIELDS_INVALID', 'cookies[*]', 'allowlisted cookie fields', c);
    }
    if (typeof c.name !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(c.name)) {
      failValidation('SESSION_COOKIE_NAME_INVALID', 'cookies[*].name', 'safe cookie-name string', c.name);
    }
    if (/csrf|xsrf|password|authorization|2fa|sms/i.test(c.name)) {
      failValidation('SESSION_COOKIE_PROHIBITED', 'cookies[*].name', 'non-prohibited cookie name', c.name);
    }
    if (typeof c.value !== 'string' || !/^[\x21-\x3A\x3C-\x7E]+$/.test(c.value) || c.value.length > 8192) {
      failValidation('SESSION_COOKIE_VALUE_INVALID', 'cookies[*].value', 'bounded printable string', c.value);
    }
    if (!['yandex.ru','.yandex.ru'].includes(c.domain)) {
      failValidation('SESSION_COOKIE_DOMAIN_INVALID', 'cookies[*].domain', 'yandex.ru domain string', c.domain);
    }
    if (!['/','/sprav','/sprav/','/sprav/api','/sprav/api/'].includes(c.path)) {
      failValidation('SESSION_COOKIE_PATH_INVALID', 'cookies[*].path', 'allowlisted sprav path string', c.path);
    }
    if (c.secure !== true) {
      failValidation('SESSION_COOKIE_SECURE_INVALID', 'cookies[*].secure', 'true boolean', c.secure);
    }
    if (c.httpOnly !== undefined && typeof c.httpOnly !== 'boolean') {
      failValidation('SESSION_COOKIE_HTTPONLY_INVALID', 'cookies[*].httpOnly', 'boolean when present', c.httpOnly);
    }
    if (c.expires !== undefined && c.expires !== null && c.expires !== -1) {
      if (typeof c.expires !== 'number' || !Number.isFinite(c.expires)) {
        failValidation('SESSION_COOKIE_EXPIRY_INVALID', 'cookies[*].expires', 'null|-1|finite unix-seconds number', c.expires);
      }
      if (c.expires * 1000 <= now) {
        failValidation('SESSION_COOKIE_EXPIRED', 'cookies[*].expires', 'future unix-seconds number', c.expires);
      }
    }
    if (names.has(c.name)) {
      failValidation('SESSION_COOKIE_DUPLICATE', 'cookies[*].name', 'unique cookie-name string', c.name);
    }
    names.add(c.name);
    return { name: c.name, value: c.value, domain: c.domain, path: c.path, secure: true, httpOnly: c.httpOnly ?? false, expires: c.expires ?? null };
  });
  const result = { account: ACCOUNT, cookies };
  if (Buffer.byteLength(JSON.stringify(result)) > 60000) {
    failValidation('SESSION_MATERIAL_TOO_LARGE', 'material', 'UTF-8 JSON <= 60000 bytes', result);
  }
  return result;
}
export function validateSession(input, now = Date.now()) {
  try { return validateSessionClassified(input, now); }
  catch { fail('SESSION_COOKIE_INVALID'); }
}
export function encryptSession(scope, input, keyring, now = Date.now(), context) {
  serverOnly(context);
  const version = randomUUID(), kid = keyring.currentKid;
  const key = keyAt(keyring, kid), iv = randomBytes(12);
  const plaintext = Buffer.from(JSON.stringify(validateSession(input, now)));
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(aad(scope, version, context));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return { credential_version: version, envelope: {
      v: 1, kid, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64')
    } };
  } finally { plaintext.fill(0); }
}
export function decryptSessionClassified(scope, stored, keyring, now = Date.now(), context) {
  serverOnly(context);
  let plaintext;
  try {
    const e = stored?.envelope;
    if (!e || typeof e !== 'object' || Array.isArray(e) || e.v !== 1 ||
        Object.keys(e).sort().join() !== 'ciphertext,iv,kid,tag,v' ||
        typeof e.kid !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(e.kid)) {
      fail('SESSION_ENVELOPE_SCHEMA_INVALID');
    }

    const key = keyring?.keys?.[e.kid];
    if (key === undefined) fail('SESSION_KEY_NOT_FOUND');
    if (!Buffer.isBuffer(key)) fail('SESSION_KEY_INVALID_ENCODING');
    if (key.length !== 32) fail('SESSION_KEY_INVALID_LENGTH');

    if (typeof e.iv !== 'string' || !/^[A-Za-z0-9+/]{16}$/.test(e.iv)) fail('SESSION_IV_INVALID');
    const iv = Buffer.from(e.iv, 'base64');
    if (iv.length !== 12) fail('SESSION_IV_INVALID');

    if (typeof e.tag !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(e.tag)) fail('SESSION_AUTH_TAG_INVALID');
    const tag = Buffer.from(e.tag, 'base64');
    if (tag.length !== 16) fail('SESSION_AUTH_TAG_INVALID');

    if (typeof e.ciphertext !== 'string' || e.ciphertext.length > 90000 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(e.ciphertext)) fail('SESSION_CIPHERTEXT_INVALID');
    const ciphertext = Buffer.from(e.ciphertext, 'base64');
    if (ciphertext.length === 0) fail('SESSION_CIPHERTEXT_INVALID');

    let associatedData;
    try { associatedData = aad(scope, stored?.credential_version, context); }
    catch { fail('SESSION_AAD_INVALID'); }

    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(associatedData);
      decipher.setAuthTag(tag);
      plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch { fail('SESSION_AES_GCM_AUTH_FAILED'); }

    let decoded;
    try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(plaintext); }
    catch { fail('SESSION_PLAINTEXT_INVALID_ENCODING'); }

    let parsed;
    try { parsed = JSON.parse(decoded); }
    catch { fail('SESSION_PLAINTEXT_INVALID_JSON'); }

    try { return validateSessionClassified(parsed, now); }
    catch (error) {
      if (SESSION_VALIDATION_RULE_CODES.has(error?.code)) {
        throw Object.assign(new Error('SESSION_PLAINTEXT_SCHEMA_INVALID'), {
          code: 'SESSION_PLAINTEXT_SCHEMA_INVALID', rule: error.rule
        });
      }
      fail('SESSION_PLAINTEXT_SCHEMA_INVALID');
    }
  } catch (error) {
    if (SESSION_DECRYPT_FAILURE_CODES.has(error?.code)) {
      throw Object.assign(new Error(error.code), {
        code: error.code, ...(error.rule ? { rule: error.rule } : {})
      });
    }
    fail('SESSION_DECRYPT_FAILED');
  } finally { plaintext?.fill(0); }
}

export function decryptSessionForRequestClassified(scope, stored, keyring, now = Date.now(), context) {
  serverOnly(context);
  let opened;
  try {
    // The authenticated envelope remains strict. Time zero is used only to inspect
    // already-authenticated cookie metadata so browser-expired records can be omitted
    // from an outbound request exactly as a browser would omit them.
    opened = decryptSessionClassified(scope, stored, keyring, 0, context);
    const cookies = opened.cookies.filter(c =>
      c.expires === null || c.expires === undefined || c.expires === -1 || c.expires * 1000 > now
    );
    try {
      return validateSessionClassified({ account: opened.account, cookies }, now);
    } catch (error) {
      if (SESSION_VALIDATION_RULE_CODES.has(error?.code)) {
        throw Object.assign(new Error('SESSION_PLAINTEXT_SCHEMA_INVALID'), {
          code: 'SESSION_PLAINTEXT_SCHEMA_INVALID', rule: error.rule
        });
      }
      fail('SESSION_PLAINTEXT_SCHEMA_INVALID');
    }
  } finally {
    if (opened?.cookies) for (const cookie of opened.cookies) if (cookie) cookie.value = '';
  }
}

export function decryptSessionForRequest(scope, stored, keyring, now = Date.now(), context) {
  try { return decryptSessionForRequestClassified(scope, stored, keyring, now, context); }
  catch (error) {
    if (error?.code === 'SERVER_ONLY') throw error;
    fail('SESSION_DECRYPT_FAILED');
  }
}

export function decryptSession(scope, stored, keyring, now = Date.now(), context) {
  try { return decryptSessionClassified(scope, stored, keyring, now, context); }
  catch (error) {
    if (error?.code === 'SERVER_ONLY') throw error;
    fail('SESSION_DECRYPT_FAILED');
  }
}
