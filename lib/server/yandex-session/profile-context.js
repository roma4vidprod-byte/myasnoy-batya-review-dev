// Explicit capabilities for private VPS Yandex operations. No automatic
// profile selection, Cloud fallback, API environment or alternate key lookup.
import { requireCloudProfile } from '../runtime-profile.js';

const contexts = new WeakMap();
const denied = () => {
  throw Object.assign(new Error('SESSION_PROFILE_INVALID'), {
    code:'SESSION_PROFILE_INVALID'
  });
};
export const VPS_SESSION_SCOPE = Object.freeze({
  companyId:'13f3cb80-487a-4a19-96a1-fb3103200230',
  locationId:'9a95f63b-18e6-447b-a449-8530b67ddbae',
  organizationId:'54309413522'
});
const forbiddenCloudEnv=[
  'VERCEL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SECRET_KEY',
  'SUPABASE_ANON_KEY','YANDEX_SESSION_KEYS_JSON','YANDEX_SESSION_ACTIVE_KID',
  'REVIEW_WORKER_SECRET'
];

function vpsEnvironment(mode) {
  if(process.env.RA_RUNTIME_PROFILE!=='vps-lab'||
     process.env.RA_YANDEX_MODE!==mode||
     forbiddenCloudEnv.some(key=>process.env[key])) denied();

  if(mode==='read-only-admin'){
    if(process.env.RA_YANDEX_REPLY_WRITE_ENABLED!==undefined)denied();
    return;
  }
  if(mode==='reply-write-one-shot'){
    if(process.env.RA_YANDEX_REPLY_WRITE_ENABLED!=='true')denied();
    return;
  }
  denied();
}

function createContext(mode){
  if(typeof window!=='undefined')denied();
  vpsEnvironment(mode);
  const context=Object.freeze({
    profile:'vps-lab',
    target:'review-activator-lab',
    aadIdentity:'vps-lab:review-activator-lab:yandex:v1'
  });
  contexts.set(context,mode);
  return context;
}

export function createVpsSessionContext() {
  return createContext('read-only-admin');
}

export function createVpsReplyWriterContext() {
  return createContext('reply-write-one-shot');
}

export function assertReplyWriterContext(context) {
  if(typeof window!=='undefined'||contexts.get(context)!=='reply-write-one-shot') denied();
  vpsEnvironment('reply-write-one-shot');
}

export function assertSessionContext(context) {
  if(context===undefined){
    requireCloudProfile();
    return;
  }
  const mode=contexts.get(context);
  if(!mode)denied();
  vpsEnvironment(mode);
}

export function assertContextScope(context,scope) {
  assertSessionContext(context);
  if(context&&Object.keys(VPS_SESSION_SCOPE).some(
    key=>scope[key]!==VPS_SESSION_SCOPE[key]
  )){
    throw Object.assign(new Error('SESSION_SCOPE_INVALID'),{
      code:'SESSION_SCOPE_INVALID'
    });
  }
}
