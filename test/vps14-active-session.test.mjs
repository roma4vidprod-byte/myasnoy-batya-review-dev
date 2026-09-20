import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  ACCOUNT,encryptSession,decryptSessionClassified,decryptSessionForRequest
} from '../lib/server/yandex-session/crypto.js';
import {
  createVpsSessionContext,VPS_SESSION_SCOPE as scope
} from '../lib/server/yandex-session/profile-context.js';

const now=1_900_000_000_000;
const ring={currentKid:'synthetic',keys:{synthetic:Buffer.alloc(32,91)}};
const envNames=['RA_RUNTIME_PROFILE','RA_YANDEX_MODE','VERCEL','SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SECRET_KEY','SUPABASE_ANON_KEY',
  'YANDEX_SESSION_KEYS_JSON','YANDEX_SESSION_ACTIVE_KID','REVIEW_WORKER_SECRET'];

async function vps(fn){
  const saved=Object.fromEntries(envNames.map(n=>[n,process.env[n]]));
  for(const n of envNames)delete process.env[n];
  process.env.RA_RUNTIME_PROFILE='vps-lab';
  process.env.RA_YANDEX_MODE='read-only-admin';
  try{return await fn(createVpsSessionContext());}
  finally{
    for(const n of envNames)
      if(saved[n]===undefined)delete process.env[n];else process.env[n]=saved[n];
  }
}

const cookie=(name,expires)=>({
  name,value:'SYNTHETIC_'+name.toUpperCase(),domain:'.yandex.ru',path:'/',
  secure:true,httpOnly:true,expires
});

test('strict decrypt remains fail-closed while request decrypt omits browser-expired cookie',()=>vps(ctx=>{
  const input={account:ACCOUNT,cookies:[
    cookie('expired',now/1000-1),
    cookie('future',now/1000+3600),
    cookie('session',-1)
  ]};
  const row=encryptSession(scope,input,ring,now-120_000,ctx);
  assert.throws(
    ()=>decryptSessionClassified(scope,row,ring,now,ctx),
    error=>error?.code==='SESSION_PLAINTEXT_SCHEMA_INVALID'&&
      error?.rule?.code==='SESSION_COOKIE_EXPIRED'
  );
  const active=decryptSessionForRequest(scope,row,ring,now,ctx);
  assert.deepEqual(active.cookies.map(c=>c.name),['future','session']);
  assert.equal(active.cookies[0].expires,now/1000+3600);
  assert.equal(active.cookies[1].expires,-1);
}));

test('request decrypt fails closed if no active cookie remains',()=>vps(ctx=>{
  const input={account:ACCOUNT,cookies:[cookie('expired',now/1000-1)]};
  const row=encryptSession(scope,input,ring,now-120_000,ctx);
  assert.throws(
    ()=>decryptSessionForRequest(scope,row,ring,now,ctx),
    error=>error?.code==='SESSION_PLAINTEXT_SCHEMA_INVALID'&&
      error?.rule?.code==='SESSION_COOKIE_COUNT_INVALID'
  );
}));

test('wrong key and AAD remain rejected before active-cookie filtering',()=>vps(ctx=>{
  const input={account:ACCOUNT,cookies:[cookie('future',now/1000+3600)]};
  const row=encryptSession(scope,input,ring,now,ctx);
  assert.throws(
    ()=>decryptSessionForRequest(scope,row,{currentKid:'synthetic',keys:{synthetic:Buffer.alloc(32,92)}},now,ctx),
    error=>error?.code==='SESSION_AES_GCM_AUTH_FAILED'
  );
  assert.throws(
    ()=>decryptSessionForRequest(scope,{...row,credential_version:'11111111-1111-4111-8111-111111111111'},ring,now,ctx),
    error=>error?.code==='SESSION_AES_GCM_AUTH_FAILED'
  );
}));

test('provider read service uses request-session decrypt while import/rotate stay strict',()=>{
  const src=readFileSync(new URL('../lib/server/yandex-session/service.js',import.meta.url),'utf8');
  assert.ok((src.match(/decryptSessionForRequest\(/g)||[]).length>=4);
  assert.match(src,/rotateKey:[\s\S]*encryptSession\(scope, decryptSession\(/);
});
