import { createHash } from 'node:crypto';
import { authorizedWorkerRequest } from '../../lib/server/review-sync-worker.js';
import { createSessionStore } from '../../lib/server/yandex-session/store.js';
import { ACCOUNT, ORG_ID, decryptSession, keyringFromEnv } from '../../lib/server/yandex-session/crypto.js';

const SCOPE = Object.freeze({
  companyId: '13f3cb80-487a-4a19-96a1-fb3103200230',
  locationId: '9a95f63b-18e6-447b-a449-8530b67ddbae',
  organizationId: ORG_ID
});
const PROJECT_REF = 'ykiubttldgyjpajmsuas';
const SAFE_CODES = new Set(['SESSION_DECRYPT_FAILED', 'SESSION_KEY_NOT_CONFIGURED', 'SESSION_STORAGE_FAILED']);
const ENV_NAMES = Object.freeze([
  'SUPABASE_SERVICE_ROLE_KEY', 'YANDEX_SESSION_KEYS_JSON', 'YANDEX_SESSION_ACTIVE_KID',
  'YANDEX_LIVE_READ_APPROVAL', 'REVIEW_WORKER_SECRET'
]);

function envPresence() {
  return Object.fromEntries(ENV_NAMES.map(name => [name, Boolean(process.env[name])]));
}

function keyMetadata(keyring, kid) {
  const key = keyring?.keys?.[kid];
  if (!Buffer.isBuffer(key)) return { present: false, length: 0, sha256_prefix: '', sha256_suffix: '' };
  const digest = key.length === 32 ? createHash('sha256').update(key).digest('hex') : '';
  return { present: key.length === 32, length: key.length, sha256_prefix: digest.slice(0, 12), sha256_suffix: digest.slice(-12) };
}

function storedMetadata(row) {
  const envelope = row?.envelope;
  return {
    present: Boolean(row),
    state: row?.state ?? null,
    revision: Number.isSafeInteger(row?.revision) ? row.revision : null,
    credential_version: typeof row?.credential_version === 'string' ? row.credential_version : null,
    envelope_v: envelope?.v ?? null,
    envelope_kid: typeof envelope?.kid === 'string' ? envelope.kid : null,
    ciphertext_length: typeof envelope?.ciphertext === 'string' ? envelope.ciphertext.length : 0,
    tag_length: typeof envelope?.tag === 'string' ? envelope.tag.length : 0,
    iv_length: typeof envelope?.iv === 'string' ? envelope.iv.length : 0
  };
}

export function createYandexSessionRuntimeStatusHandler({
  getSecret = () => process.env.REVIEW_WORKER_SECRET,
  read = scope => createSessionStore().read(scope),
  getKeyring = keyringFromEnv,
  decrypt = decryptSession
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

    let keyring;
    let row;
    let material;
    try {
      keyring = getKeyring();
      row = await read(SCOPE);
      const stored = storedMetadata(row);
      const active = keyMetadata(keyring, keyring.currentKid);
      const storedKey = keyMetadata(keyring, stored.envelope_kid);
      let decryptStatus = row ? 'FAIL' : 'NO_SESSION';
      let decryptCode = row ? 'SESSION_DECRYPT_FAILED' : null;
      if (row) {
        try {
          material = decrypt(SCOPE, row, keyring);
          decryptStatus = 'PASS';
          decryptCode = null;
        } catch (error) {
          const code = SAFE_CODES.has(error?.code) ? error.code : 'SESSION_DECRYPT_FAILED';
          decryptCode = code;
        }
      }
      return res.status(decryptStatus === 'FAIL' ? 503 : 200).json({
        ok: decryptStatus !== 'FAIL',
        scope: { company_id: SCOPE.companyId, location_id: SCOPE.locationId, organization_id: SCOPE.organizationId },
        env_present: envPresence(),
        keyring: {
          parse: 'PASS',
          active_kid: keyring.currentKid,
          active_key: active,
          stored_kid: stored.envelope_kid,
          stored_key: storedKey,
          active_stored_key_match: active.present && storedKey.present &&
            active.sha256_prefix === storedKey.sha256_prefix && active.sha256_suffix === storedKey.sha256_suffix
        },
        stored,
        aad: { project_ref: PROJECT_REF, provider: 'yandex', account: ACCOUNT, scope_matches: true },
        decrypt: decryptStatus,
        error: decryptCode,
        yandex_requests: 0,
        review_persistence: 'OFF'
      });
    } catch (error) {
      const code = SAFE_CODES.has(error?.code) ? error.code : 'SESSION_STORAGE_FAILED';
      return res.status(503).json({ ok: false, env_present: envPresence(), decrypt: 'FAIL', error: code, yandex_requests: 0, review_persistence: 'OFF' });
    } finally {
      if (material?.cookies) material.cookies.fill(null);
      if (keyring?.keys) for (const key of Object.values(keyring.keys)) key.fill(0);
    }
  };
}

export default createYandexSessionRuntimeStatusHandler();
