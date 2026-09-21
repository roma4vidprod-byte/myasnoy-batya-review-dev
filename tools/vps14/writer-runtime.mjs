// Private VPS composition. Missing trusted session/CSRF adapters block BEFORE claim.
import {userInfo} from 'node:os';
import {runYandexReplyOnce} from '../../lib/server/yandex-reply-worker.js';
import {createVpsReplyWriterContext,VPS_SESSION_SCOPE} from '../../lib/server/yandex-session/profile-context.js';
import {createYandexReplyTransport} from '../../lib/server/yandex-session/reply-transport.js';
import {createReplyWorkerStore} from './reply-worker-store.mjs';

const CLOUD=['VERCEL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SECRET_KEY',
  'SUPABASE_ANON_KEY','YANDEX_SESSION_KEYS_JSON','YANDEX_SESSION_ACTIVE_KID','REVIEW_WORKER_SECRET'];
const blocked=code=>Object.freeze({ok:false,status:'BLOCKED',code,claimed:false,
  storageCalls:0,sessionReads:0,providerRequests:0,providerWrites:0});

export function runtimeGate(env){
  if(env.RA_RUNTIME_PROFILE!=='vps-lab'||CLOUD.some(key=>env[key]))
    return 'REPLY_RUNTIME_PROFILE_DENIED';
  if(env.RA_YANDEX_MODE!=='reply-write-one-shot')return 'REPLY_RUNTIME_MODE_DENIED';
  if(env.RA_YANDEX_REPLY_WRITE_ENABLED===undefined||env.RA_YANDEX_REPLY_WRITE_ENABLED==='false')
    return 'DISABLED';
  if(env.RA_YANDEX_REPLY_WRITE_ENABLED!=='true')return 'REPLY_RUNTIME_FLAG_INVALID';
  return 'WRITE_REQUESTED';
}

export async function runVpsReplyRuntime({resolveCsrf,getSession,createStore=createReplyWorkerStore}={}){
  const gate=runtimeGate(process.env);
  if(gate==='DISABLED'){
    const result=await runYandexReplyOnce({allowWrite:false});
    return Object.freeze({...result,code:'WRITE_OFF',storageCalls:0,sessionReads:0,
      providerRequests:0,csrfResolver:'NOT_CONNECTED',readiness:'DISABLED_INSTALLATION_ONLY'});
  }
  if(gate!=='WRITE_REQUESTED')return blocked(gate);
  // Browser presence evidence is NOT a configured server token channel.
  if(typeof resolveCsrf!=='function')return blocked('YANDEX_REPLY_CSRF_BOOTSTRAP_UNPROVEN');
  if(typeof getSession!=='function')return blocked('REPLY_RUNTIME_SESSION_ADAPTER_MISSING');
  if(process.platform!=='linux'||userInfo().username!=='review-yandex-writer')
    return blocked('REPLY_WRITER_ROLE_DENIED');
  const context=createVpsReplyWriterContext();
  const store=createStore();
  let session;
  try{
    return await runYandexReplyOnce({allowWrite:true,store,
      getSession:async claim=>{
        session=await getSession({store,context,scope:VPS_SESSION_SCOPE,claim});
        return session;
      },
      createTransport:({session:active})=>createYandexReplyTransport({
        context,scope:VPS_SESSION_SCOPE,session:active,allowWrite:true,resolveCsrf
      })
    });
  }finally{
    if(session?.cookies)for(const cookie of session.cookies)if(cookie)cookie.value='';
  }
}
