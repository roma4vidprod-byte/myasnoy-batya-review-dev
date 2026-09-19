import { requestDevServiceRpc } from '../review-sync.js';
import { scopeOf, serverOnly, fail } from './crypto.js';
import { assertContextScope } from './profile-context.js';

export function createSessionStore({ rpc = requestDevServiceRpc, context } = {}) {
  if (context && rpc === requestDevServiceRpc) fail('SESSION_STORAGE_FAILED');
  async function call(scope, action, revision = null, data = {}) {
    serverOnly(context);
    const s = scopeOf(scope);
    if (context) {
      assertContextScope(context, s);
      if (!['read','replace','transition'].includes(action)) fail('SESSION_ACTION_INVALID');
    }
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
