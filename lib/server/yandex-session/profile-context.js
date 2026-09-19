// Explicit capability for the private VPS admin/read CLI only. No automatic
// profile selection, Cloud fallback, API environment or alternate key lookup.
import { requireCloudProfile } from '../runtime-profile.js';

const contexts = new WeakSet();
const denied = () => { throw Object.assign(new Error('SESSION_PROFILE_INVALID'), {code:'SESSION_PROFILE_INVALID'}); };
export const VPS_SESSION_SCOPE = Object.freeze({
  companyId:'13f3cb80-487a-4a19-96a1-fb3103200230',
  locationId:'9a95f63b-18e6-447b-a449-8530b67ddbae', organizationId:'54309413522'
});
function vpsEnvironment() {
  if (process.env.RA_RUNTIME_PROFILE !== 'vps-lab' || process.env.RA_YANDEX_MODE !== 'read-only-admin' ||
      ['VERCEL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SECRET_KEY',
        'SUPABASE_ANON_KEY','YANDEX_SESSION_KEYS_JSON','YANDEX_SESSION_ACTIVE_KID',
        'REVIEW_WORKER_SECRET'].some(k => process.env[k])) denied();
}
export function createVpsSessionContext() {
  if (typeof window !== 'undefined') denied();
  vpsEnvironment();
  const context = Object.freeze({profile:'vps-lab',target:'review-activator-lab',aadIdentity:'vps-lab:review-activator-lab:yandex:v1'});
  contexts.add(context);
  return context;
}
export function assertSessionContext(context) {
  if (context === undefined) { requireCloudProfile(); return; }
  if (!contexts.has(context)) denied();
  vpsEnvironment();
}
export function assertContextScope(context, scope) {
  assertSessionContext(context);
  if (context && Object.keys(VPS_SESSION_SCOPE).some(k => scope[k] !== VPS_SESSION_SCOPE[k])) {
    throw Object.assign(new Error('SESSION_SCOPE_INVALID'), {code:'SESSION_SCOPE_INVALID'});
  }
}
