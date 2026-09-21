import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCOUNT,encryptSession,decryptSessionForRequest
} from '../lib/server/yandex-session/crypto.js';
import {
  createVpsSessionContext,createVpsReplyWriterContext,
  VPS_SESSION_SCOPE as scope
} from '../lib/server/yandex-session/profile-context.js';

const envNames=[
  'RA_RUNTIME_PROFILE','RA_YANDEX_MODE','RA_YANDEX_REPLY_WRITE_ENABLED',
  'VERCEL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_SECRET_KEY',
  'SUPABASE_ANON_KEY','YANDEX_SESSION_KEYS_JSON','YANDEX_SESSION_ACTIVE_KID',
  'REVIEW_WORKER_SECRET'
];
const saveEnv=()=>Object.fromEntries(envNames.map(k=>[k,process.env[k]]));
const restore=saved=>{
  for(const key of envNames)
    if(saved[key]===undefined)delete process.env[key];
    else process.env[key]=saved[key];
};
const clear=()=>{for(const key of envNames)delete process.env[key];};

test('reader context refuses any reply write gate',()=>{
  const saved=saveEnv();
  try{
    clear();
    process.env.RA_RUNTIME_PROFILE='vps-lab';
    process.env.RA_YANDEX_MODE='read-only-admin';
    process.env.RA_YANDEX_REPLY_WRITE_ENABLED='false';
    assert.throws(
      ()=>createVpsSessionContext(),
      error=>error?.code==='SESSION_PROFILE_INVALID'
    );
  }finally{restore(saved);}
});

test('writer context requires exact mode and explicit true gate',()=>{
  const saved=saveEnv();
  try{
    clear();
    process.env.RA_RUNTIME_PROFILE='vps-lab';
    process.env.RA_YANDEX_MODE='reply-write-one-shot';
    assert.throws(
      ()=>createVpsReplyWriterContext(),
      error=>error?.code==='SESSION_PROFILE_INVALID'
    );
    process.env.RA_YANDEX_REPLY_WRITE_ENABLED='false';
    assert.throws(
      ()=>createVpsReplyWriterContext(),
      error=>error?.code==='SESSION_PROFILE_INVALID'
    );
    process.env.RA_YANDEX_REPLY_WRITE_ENABLED='true';
    const context=createVpsReplyWriterContext();
    assert.equal(context.profile,'vps-lab');
  }finally{restore(saved);}
});

test('reader and writer capabilities share only the fixed AAD identity',()=>{
  const saved=saveEnv();
  const ring={currentKid:'synthetic',keys:{synthetic:Buffer.alloc(32,101)}};
  const now=1_900_000_000_000;
  try{
    clear();
    process.env.RA_RUNTIME_PROFILE='vps-lab';
    process.env.RA_YANDEX_MODE='read-only-admin';
    const reader=createVpsSessionContext();
    const encrypted=encryptSession(scope,{
      account:ACCOUNT,
      cookies:[{
        name:'synthetic',value:'SYNTHETIC_COOKIE',domain:'.yandex.ru',
        path:'/',secure:true,httpOnly:true,expires:now/1000+3600
      }]
    },ring,now,reader);

    delete process.env.RA_YANDEX_MODE;
    process.env.RA_YANDEX_MODE='reply-write-one-shot';
    process.env.RA_YANDEX_REPLY_WRITE_ENABLED='true';
    const writer=createVpsReplyWriterContext();
    const opened=decryptSessionForRequest(scope,encrypted,ring,now,writer);
    assert.equal(opened.cookies.length,1);
    opened.cookies[0].value='';
  }finally{
    for(const key of Object.values(ring.keys))key.fill(0);
    restore(saved);
  }
});

test('Cloud credential presence rejects writer capability',()=>{
  const saved=saveEnv();
  try{
    clear();
    process.env.RA_RUNTIME_PROFILE='vps-lab';
    process.env.RA_YANDEX_MODE='reply-write-one-shot';
    process.env.RA_YANDEX_REPLY_WRITE_ENABLED='true';
    process.env.SUPABASE_URL='https://example.invalid';
    assert.throws(
      ()=>createVpsReplyWriterContext(),
      error=>error?.code==='SESSION_PROFILE_INVALID'
    );
  }finally{restore(saved);}
});
