import { createHash } from 'node:crypto';
import { ACCOUNT, ORG_ID, scopeOf } from './crypto.js';

const PROJECT_REF = 'ykiubttldgyjpajmsuas';
const safeIdentity = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : null;
const fingerprint = value => {
  const digest = createHash('sha256').update(value).digest('hex');
  return `${digest.slice(0, 12)}…${digest.slice(-12)}`;
};

export function createSessionProvenance({ env = process.env, scope, row, keyring, decryptResult = 'NOT_RUN' } = {}) {
  const safeScope = scopeOf(scope);
  const envelope = row?.envelope;
  const storedKid = typeof envelope?.kid === 'string' ? envelope.kid : null;
  const storedKey = storedKid ? keyring?.keys?.[storedKid] : null;
  const activeKey = keyring?.currentKid ? keyring?.keys?.[keyring.currentKid] : null;
  const aadInput = row?.credential_version
    ? JSON.stringify([PROJECT_REF, 'yandex', ...Object.values(safeScope), ACCOUNT, row.credential_version])
    : null;
  const envelopeInput = envelope && ['v', 'kid', 'iv', 'tag', 'ciphertext'].every(field => typeof envelope[field] === 'string' || field === 'v')
    ? JSON.stringify([envelope.v, envelope.kid, envelope.iv, envelope.tag, envelope.ciphertext])
    : null;
  const key = Buffer.isBuffer(storedKey) && storedKey.length === 32 ? storedKey :
    Buffer.isBuffer(activeKey) && activeKey.length === 32 ? activeKey : null;
  return {
    runtime: env?.VERCEL === '1' ? 'vercel-server' : 'local-server-process',
    environment: safeIdentity(env?.VERCEL_ENV),
    deployment_id: safeIdentity(env?.VERCEL_DEPLOYMENT_ID),
    commit_sha: safeIdentity(env?.VERCEL_GIT_COMMIT_SHA),
    session_revision: Number.isSafeInteger(row?.revision) ? row.revision : null,
    active_kid: safeIdentity(keyring?.currentKid),
    stored_kid: safeIdentity(storedKid),
    stored_active_kid_match: Boolean(storedKid && keyring?.currentKid && storedKid === keyring.currentKid),
    envelope_fingerprint: envelopeInput ? fingerprint(envelopeInput) : null,
    aad_fingerprint: aadInput ? fingerprint(aadInput) : null,
    key_fingerprint: key ? fingerprint(key) : null,
    decrypt: decryptResult
  };
}
