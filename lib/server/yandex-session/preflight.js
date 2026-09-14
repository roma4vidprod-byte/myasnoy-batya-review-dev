import { createSessionStore } from './store.js';
import {
  ACCOUNT, ORG_ID, decryptSessionClassified, keyringFromEnv, scopeOf,
  SESSION_VALIDATION_RULE_CODES
} from './crypto.js';
import { createYandexPageNumbering } from '../../providers/yandex.js';
import { createSessionProvenance } from './provenance.js';

export const ASBEST_HEALTH_SCOPE = Object.freeze({
  companyId: '13f3cb80-487a-4a19-96a1-fb3103200230',
  locationId: '9a95f63b-18e6-447b-a449-8530b67ddbae',
  organizationId: ORG_ID
});
export const HEALTH_MODE = 'health';
export const HEALTH_PAGE_BASE = 1;
export const LIVE_READ_APPROVAL = 'asbest-read-only-v1';
export const PREFLIGHT_ENV_NAMES = Object.freeze([
  'SUPABASE_SERVICE_ROLE_KEY', 'YANDEX_SESSION_KEYS_JSON',
  'YANDEX_SESSION_ACTIVE_KID', 'YANDEX_LIVE_READ_APPROVAL'
]);
export const PREFLIGHT_CODES = Object.freeze(new Set([
  'LIVE_READ_NOT_APPROVED', 'SESSION_KEY_NOT_CONFIGURED', 'SESSION_SCOPE_INVALID',
  'SESSION_MODE_INVALID', 'YANDEX_PAGE_BASE_INVALID', 'SESSION_DECRYPT_FAILED',
  'SESSION_ENVELOPE_SCHEMA_INVALID', 'SESSION_KEY_NOT_FOUND', 'SESSION_KEY_INVALID_ENCODING',
  'SESSION_KEY_INVALID_LENGTH', 'SESSION_IV_INVALID', 'SESSION_AUTH_TAG_INVALID',
  'SESSION_CIPHERTEXT_INVALID', 'SESSION_AAD_INVALID', 'SESSION_AES_GCM_AUTH_FAILED',
  'SESSION_PLAINTEXT_INVALID_ENCODING', 'SESSION_PLAINTEXT_INVALID_JSON',
  'SESSION_PLAINTEXT_SCHEMA_INVALID', 'SESSION_STORAGE_FAILED', 'SESSION_OPERATION_FAILED'
]));

const DECRYPT_STAGE = Object.freeze({
  SESSION_ENVELOPE_SCHEMA_INVALID: 'ENVELOPE_SCHEMA',
  SESSION_KEY_NOT_FOUND: 'KEY_LOOKUP',
  SESSION_KEY_INVALID_ENCODING: 'KEY_ENCODING',
  SESSION_KEY_INVALID_LENGTH: 'KEY_LENGTH',
  SESSION_IV_INVALID: 'IV_SCHEMA',
  SESSION_AUTH_TAG_INVALID: 'AUTH_TAG_SCHEMA',
  SESSION_CIPHERTEXT_INVALID: 'CIPHERTEXT_SCHEMA',
  SESSION_AAD_INVALID: 'AAD_SCHEMA',
  SESSION_AES_GCM_AUTH_FAILED: 'AES_GCM_AUTH',
  SESSION_PLAINTEXT_INVALID_ENCODING: 'PLAINTEXT_ENCODING',
  SESSION_PLAINTEXT_INVALID_JSON: 'PLAINTEXT_JSON',
  SESSION_PLAINTEXT_SCHEMA_INVALID: 'PLAINTEXT_SCHEMA'
});
const AES_AUTH_CODES = new Set(['SESSION_AES_GCM_AUTH_FAILED']);
const POST_AES_CODES = new Set([
  'SESSION_PLAINTEXT_INVALID_ENCODING', 'SESSION_PLAINTEXT_INVALID_JSON',
  'SESSION_PLAINTEXT_SCHEMA_INVALID'
]);

const endpointFor = (scope, page) =>
  `https://yandex.ru/sprav/api/${scope.organizationId}/reviews?ranking=by_time&source=pagination&page=${page}`;

const runtimeLocation = env => env?.VERCEL === '1' ? 'vercel-server' : 'local-server-process';
const envPresence = env => Object.fromEntries(PREFLIGHT_ENV_NAMES.map(name => [name, Boolean(env?.[name])]));
const safeCode = error => PREFLIGHT_CODES.has(error?.code) ? error.code : 'SESSION_OPERATION_FAILED';
export const safeSchemaRule = value => {
  const rule = value?.rule ?? value;
  if (!rule || !SESSION_VALIDATION_RULE_CODES.has(rule.code) ||
      typeof rule.path !== 'string' || typeof rule.expected_type !== 'string' ||
      typeof rule.actual_type !== 'string' || typeof rule.present !== 'boolean') return null;
  return {
    code: rule.code,
    path: rule.path,
    expected_type: rule.expected_type,
    actual_type: rule.actual_type,
    present: rule.present
  };
};

function emptyReport(env) {
  return {
    pretransport: 'FAIL',
    error: null,
    runtime_location: runtimeLocation(env),
    env_present: envPresence(env),
    allow_read: false,
    scope: 'FAIL',
    mode: 'FAIL',
    page_base: 'FAIL',
    endpoint: 'FAIL',
    keyring_parse: 'FAIL',
    active_kid: 'FAIL',
    envelope_shape: 'FAIL',
    stored_kid: 'FAIL',
    stored_key_available: 'FAIL',
    active_stored_kid_match: 'FAIL',
    session_decrypt: 'NOT_RUN',
    session_validation: 'NOT_RUN',
    decrypt_stage: null,
    schema_rule: null,
    session_state: null,
    revision: null,
    provenance: null,
    yandex_requests: 0
  };
}

export async function runYandexHealthPreflight({
  env = process.env,
  scope = ASBEST_HEALTH_SCOPE,
  mode = HEALTH_MODE,
  pageBase = HEALTH_PAGE_BASE,
  read = input => createSessionStore().read(input),
  getKeyring = () => keyringFromEnv(),
  decrypt = decryptSessionClassified
} = {}) {
  const report = emptyReport(env);
  let keyring;
  let material;
  try {
    if (!report.env_present.SUPABASE_SERVICE_ROLE_KEY) throw Object.assign(new Error(), { code: 'SESSION_STORAGE_FAILED' });
    if (env.YANDEX_LIVE_READ_APPROVAL !== LIVE_READ_APPROVAL) throw Object.assign(new Error(), { code: 'LIVE_READ_NOT_APPROVED' });
    report.allow_read = true;

    const safeScope = scopeOf(scope);
    if (safeScope.companyId !== ASBEST_HEALTH_SCOPE.companyId || safeScope.locationId !== ASBEST_HEALTH_SCOPE.locationId) {
      throw Object.assign(new Error(), { code: 'SESSION_SCOPE_INVALID' });
    }
    report.scope = 'PASS';

    if (mode !== HEALTH_MODE) throw Object.assign(new Error(), { code: 'SESSION_MODE_INVALID' });
    report.mode = 'PASS';
    if (pageBase !== HEALTH_PAGE_BASE) throw Object.assign(new Error(), { code: 'YANDEX_PAGE_BASE_INVALID' });
    createYandexPageNumbering(pageBase);
    report.page_base = 'PASS';
    if (endpointFor(safeScope, pageBase) !== 'https://yandex.ru/sprav/api/54309413522/reviews?ranking=by_time&source=pagination&page=1') {
      throw Object.assign(new Error(), { code: 'SESSION_OPERATION_FAILED' });
    }
    report.endpoint = 'PASS';

    keyring = getKeyring();
    if (!keyring || typeof keyring.currentKid !== 'string' ||
        !Buffer.isBuffer(keyring.keys?.[keyring.currentKid]) || keyring.keys[keyring.currentKid].length !== 32) {
      throw Object.assign(new Error(), { code: 'SESSION_KEY_NOT_CONFIGURED' });
    }
    report.keyring_parse = 'PASS';
    report.active_kid = 'PASS';
    const row = await read(safeScope);
    if (!row || row.state === 'DISABLED' || row.company_id !== safeScope.companyId ||
        row.location_id !== safeScope.locationId || row.external_org_id !== safeScope.organizationId) {
      throw Object.assign(new Error(), { code: 'SESSION_STORAGE_FAILED' });
    }
    report.session_state = typeof row.state === 'string' ? row.state : null;
    report.revision = Number.isSafeInteger(row.revision) ? row.revision : null;
    report.provenance = createSessionProvenance({ env, scope: safeScope, row, keyring });
    const envelope = row.envelope;
    report.envelope_shape = envelope && typeof envelope === 'object' && !Array.isArray(envelope) ? 'PASS' : 'FAIL';
    report.stored_kid = typeof envelope?.kid === 'string' ? 'PASS' : 'FAIL';
    const storedKey = typeof envelope?.kid === 'string' ? keyring.keys[envelope.kid] : null;
    report.stored_key_available = Buffer.isBuffer(storedKey) && storedKey.length === 32 ? 'PASS' : 'FAIL';
    report.active_stored_kid_match = typeof envelope?.kid === 'string' && envelope.kid === keyring.currentKid ? 'PASS' : 'FAIL';
    material = decrypt(safeScope, row, keyring);
    if (!material || material.account !== ACCOUNT || !Array.isArray(material.cookies) || !material.cookies.length) {
      throw Object.assign(new Error(), { code: 'SESSION_PLAINTEXT_SCHEMA_INVALID' });
    }
    report.session_decrypt = 'PASS';
    report.session_validation = 'PASS';
    report.decrypt_stage = 'SESSION_SCHEMA';
    report.provenance.decrypt = 'PASS';
    report.pretransport = 'PASS';
    return report;
  } catch (error) {
    const code = safeCode(error);
    report.error = code;
    report.decrypt_stage = DECRYPT_STAGE[code] ?? null;
    if (code === 'SESSION_PLAINTEXT_SCHEMA_INVALID') report.schema_rule = safeSchemaRule(error);
    if (AES_AUTH_CODES.has(code)) {
      report.session_decrypt = 'FAIL';
      report.session_validation = 'NOT_RUN';
      if (report.provenance) report.provenance.decrypt = 'FAIL';
    } else if (POST_AES_CODES.has(code)) {
      report.session_decrypt = 'PASS';
      report.session_validation = 'FAIL';
      if (report.provenance) report.provenance.decrypt = 'PASS';
    }
    return report;
  } finally {
    if (material?.cookies) material.cookies.fill(null);
    if (keyring?.keys) for (const key of Object.values(keyring.keys)) key.fill(0);
  }
}
