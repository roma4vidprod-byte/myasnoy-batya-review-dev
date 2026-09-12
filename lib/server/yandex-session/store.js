import { requestDevServiceRpc } from '../review-sync.js';
import { scopeOf, serverOnly, fail } from './crypto.js';

export function createSessionStore({ rpc = requestDevServiceRpc } = {}) {
  async function call(scope, action, revision = null, data = {}) {
    serverOnly();
    const s = scopeOf(scope);
    try {
      return await rpc('review_yandex_session_store', {
        p_company_id: s.companyId, p_location_id: s.locationId, p_org_id: s.organizationId,
        p_action: action, p_expected_revision: revision, p_data: data
      });
    } catch (error) { fail(['SESSION_CHANGED','SESSION_SCOPE_INVALID'].includes(error.code) ? error.code : 'SESSION_STORAGE_FAILED'); }
  }
  return {
    read: scope => call(scope, 'read'),
    snapshot: (scope, ids) => call(scope, 'snapshot', null, { ids }),
    replace: (scope, revision, encrypted) => call(scope, 'replace', revision, encrypted),
    transition: (scope, revision, result) => call(scope, 'transition', revision, result),
    claimAlert: (scope, revision) => call(scope, 'claim_alert', revision)
  };
}
