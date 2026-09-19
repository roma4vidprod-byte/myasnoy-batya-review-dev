import { createAdapterServer } from './http-adapter.js';

export const CLOSED_ROUTES = Object.freeze([
  '/api/health', '/api/admin-review-reply-draft', '/api/cron/review-sync',
  '/api/email-test', '/api/feedback', '/api/internal/review-sync-worker',
  '/api/promo-import', '/api/promo-stats', '/api/review-candidate',
  '/api/review-sync-status', '/api/reward-request', '/api/telegram-test'
]);

export function createFoundationServer({config,logger} = {}) {
  const status = {service:'review-activator', profile:'vps-foundation',
    application_ready:false, backend:'NOT_CONFIGURED',
    business_handlers_loaded:false, yandex:'DISABLED', notifications:'DISABLED', scheduler:'DISABLED',
    declared_source_sha:config.sourceSha, source_provenance:'NOT_VERIFIED_BY_RUNTIME'};
  const liveness = (_,res) => res.status(200).json({ok:true,...status});
  const readiness = (_,res) => res.status(503).json({ok:false,...status,error:'APPLICATION_PROFILE_PENDING'});
  const closed = (_,res) => res.status(503).json({ok:false,error:'BUSINESS_ROUTE_NOT_ENABLED_IN_FOUNDATION'});
  const routes = new Map([
    ['/',{methods:['GET','HEAD'],handler:liveness}],
    ['/healthz',{methods:['GET','HEAD'],handler:liveness}],
    ['/readyz',{methods:['GET','HEAD'],handler:readiness}],
    ...CLOSED_ROUTES.map(path=>[path,{methods:['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS'],handler:closed}])
  ]);
  // No static file server and no auto-discovery/import of /api, .env, SQL or tools.
  return createAdapterServer({config,routes,logger});
}
