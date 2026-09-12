// Operator-only configuration check. No import, enqueue, Yandex transport or alerts.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { keyringFromEnv } from '../lib/server/yandex-session/crypto.js';
import { requestDevServiceRpc } from '../lib/server/review-sync.js';
import { createSessionStore } from '../lib/server/yandex-session/store.js';

export const ENV_NAMES = Object.freeze([
  'SUPABASE_SERVICE_ROLE_KEY', 'YANDEX_SESSION_KEYS_JSON', 'YANDEX_SESSION_ACTIVE_KID'
]);
const scope = Object.freeze({
  companyId: '13f3cb80-487a-4a19-96a1-fb3103200230',
  locationId: '9a95f63b-18e6-447b-a449-8530b67ddbae', organizationId: '54309413522'
});

export async function checkYandexDevEnv({ fetchImpl } = {}) {
  const report = {
    env_present: Object.fromEntries(ENV_NAMES.map(name => [name, Boolean(process.env[name])])),
    keyring_parse: 'FAIL', active_kid_exists: 'FAIL', service_role_connection: 'FAIL'
  };
  let ring;
  try {
    const input = JSON.parse(process.env.YANDEX_SESSION_KEYS_JSON || 'null');
    if (!input || Array.isArray(input) || typeof input !== 'object' || !Object.keys(input).length) return { report, ready: false };
    for (const [kid, value] of Object.entries(input)) {
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(kid) || ['__proto__', 'constructor', 'prototype'].includes(kid) ||
          typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return { report, ready: false };
      const bytes = Buffer.from(value, 'base64');
      try {
        if (bytes.length !== 32 || bytes.toString('base64') !== value) return { report, ready: false };
      } finally { bytes.fill(0); }
    }
    report.keyring_parse = 'PASS';
    if (!Object.hasOwn(input, process.env.YANDEX_SESSION_ACTIVE_KID || '')) return { report, ready: false };
    // Validate compatibility with the actual v1 parser, not a replacement key format.
    ring = keyringFromEnv();
    report.active_kid_exists = 'PASS';
    if (!report.env_present.SUPABASE_SERVICE_ROLE_KEY) return { report, ready: false };
    const store = createSessionStore({
      rpc: (name, payload) => requestDevServiceRpc(name, payload, { fetchImpl })
    });
    const row = await store.read(scope); // One Supabase RPC; SQL branch is SELECT only.
    if (row !== null && (!row || Array.isArray(row) || row.company_id !== scope.companyId ||
        row.location_id !== scope.locationId || row.external_org_id !== scope.organizationId ||
        !Number.isSafeInteger(row.revision) || row.revision < 1)) return { report, ready: false };
    report.service_role_connection = 'PASS';
    // Never replace configuration blindly if a session was imported since preflight.
    // Do not return any row fields (including the encrypted envelope).
    return { report, ready: row === null };
  } catch {
    return { report, ready: false }; // Never return exceptions, headers or input.
  } finally {
    if (ring) for (const bytes of Object.values(ring.keys)) bytes.fill(0);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { report, ready } = await checkYandexDevEnv();
  process.stdout.write(JSON.stringify(report) + '\n');
  // 2 means an existing session blocked fresh setup despite a successful connection.
  process.exitCode = ready ? 0 : report.service_role_connection === 'PASS' ? 2 : 1;
}
