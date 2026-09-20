import test from 'node:test';
import assert from 'node:assert/strict';
import {ACCOUNT} from '../lib/server/yandex-session/crypto.js';
import {
  createVpsSessionContext,VPS_SESSION_SCOPE as scope
} from '../lib/server/yandex-session/profile-context.js';
import {
  createYandexReplyTransport,YANDEX_CSRF_BOOTSTRAP_ENDPOINT
} from '../lib/server/yandex-session/reply-transport.js';
import {YANDEX_REPLY_ENDPOINT} from '../lib/server/yandex-session/reply-contract.js';

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

const now=1_900_000_000_000;
const session=()=>({account:ACCOUNT,cookies:[{
  name:'synthetic',value:'SYNTHETIC_COOKIE',domain:'.yandex.ru',path:'/',
  secure:true,httpOnly:true,expires:now/1000+3600
}]});
const auth=()=>({
  actionId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  idempotencyKey:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  approvalFingerprint:'c'.repeat(64),
  approvedAt:now-1000,
  expiresAt:now+60_000
});
const page=({answered=false}={})=>({
  list:{
    csrf_token:'REVIEWS_CSRF',
    pager:{limit:20,offset:0,total:1},
    items:[{
      id:'review-42',
      business_answer_csrf_token:'ANSWER_CSRF',
      owner_comment:answered?{text:'already'}:null
    }]
  }
});

test('write gate blocks before any provider request',()=>vps(async context=>{
  let calls=0;
  const send=createYandexReplyTransport({
    scope,session:session(),allowWrite:false,context,now:()=>now,
    fetchImpl:async()=>{calls++;throw Error('MUST_NOT_CALL');}
  });
  await assert.rejects(
    send({externalReviewId:'review-42',replyText:'Спасибо',authorization:auth()}),
    e=>e.code==='LIVE_WRITE_NOT_APPROVED'
  );
  assert.equal(calls,0);
}));

test('expired or malformed approval blocks before provider request',()=>vps(async context=>{
  let calls=0;
  const send=createYandexReplyTransport({
    scope,session:session(),allowWrite:true,context,now:()=>now,
    fetchImpl:async()=>{calls++;throw Error('MUST_NOT_CALL');}
  });
  await assert.rejects(
    send({externalReviewId:'review-42',replyText:'Спасибо',authorization:{...auth(),expiresAt:now-1}}),
    e=>e.code==='YANDEX_REPLY_APPROVAL_INVALID'
  );
  assert.equal(calls,0);
}));

test('mocked contract performs GET discovery, CSRF bootstrap, then exactly one reply POST',()=>vps(async context=>{
  const calls=[];
  const fetchImpl=async(url,options={})=>{
    calls.push({url,options});
    if(String(url).includes('/reviews?'))return new Response(JSON.stringify(page()),{
      status:200,headers:{'content-type':'application/json'}
    });
    if(url===YANDEX_CSRF_BOOTSTRAP_ENDPOINT)return new Response(JSON.stringify({csrf:'GLOBAL_CSRF'}),{
      status:488,headers:{'content-type':'application/json'}
    });
    if(url===YANDEX_REPLY_ENDPOINT)return new Response('OK',{
      status:200,headers:{'content-type':'text/plain'}
    });
    throw Error('UNEXPECTED_URL');
  };
  const send=createYandexReplyTransport({
    scope,session:session(),allowWrite:true,context,now:()=>now,fetchImpl
  });
  const result=await send({
    externalReviewId:'review-42',replyText:'Спасибо за отзыв',authorization:auth()
  });
  assert.deepEqual(result,{
    ok:true,code:'YANDEX_REPLY_ACCEPTED',
    actionId:auth().actionId,idempotencyKey:auth().idempotencyKey,
    providerRequests:3,providerWrites:1
  });
  assert.equal(calls.length,3);
  assert.equal(calls[0].options.method,'GET');
  assert.equal(calls[1].url,YANDEX_CSRF_BOOTSTRAP_ENDPOINT);
  assert.equal(calls[1].options.method,'POST');
  assert.equal(calls[2].url,YANDEX_REPLY_ENDPOINT);
  assert.equal(calls[2].options.method,'POST');
  const body=JSON.parse(calls[2].options.body);
  assert.deepEqual(body,{
    reviewId:'review-42',text:'Спасибо за отзыв',
    reviewsCsrfToken:'REVIEWS_CSRF',answerCsrfToken:'ANSWER_CSRF'
  });
  assert.equal(calls[2].options.headers['X-CSRF-Token'],'GLOBAL_CSRF');
}));

test('answered review stops before bootstrap and write',()=>vps(async context=>{
  const calls=[];
  const send=createYandexReplyTransport({
    scope,session:session(),allowWrite:true,context,now:()=>now,
    fetchImpl:async(url)=>{
      calls.push(url);
      return new Response(JSON.stringify(page({answered:true})),{
        status:200,headers:{'content-type':'application/json'}
      });
    }
  });
  await assert.rejects(
    send({externalReviewId:'review-42',replyText:'Спасибо',authorization:auth()}),
    e=>e.code==='YANDEX_REPLY_ALREADY_ANSWERED'
  );
  assert.equal(calls.length,1);
}));

test('bootstrap drift stops before reply endpoint',()=>vps(async context=>{
  const calls=[];
  const fetchImpl=async(url)=>{
    calls.push(url);
    if(String(url).includes('/reviews?'))return new Response(JSON.stringify(page()),{
      status:200,headers:{'content-type':'application/json'}
    });
    return new Response(JSON.stringify({unexpected:true}),{
      status:200,headers:{'content-type':'application/json'}
    });
  };
  const send=createYandexReplyTransport({
    scope,session:session(),allowWrite:true,context,now:()=>now,fetchImpl
  });
  await assert.rejects(
    send({externalReviewId:'review-42',replyText:'Спасибо',authorization:auth()}),
    e=>e.code==='YANDEX_REPLY_CSRF_BOOTSTRAP_DRIFT'&&e.providerWriteAttempted===false
  );
  assert.equal(calls.length,2);
  assert.equal(calls.includes(YANDEX_REPLY_ENDPOINT),false);
}));

test('network uncertainty after final POST is marked non-retriable by caller',()=>vps(async context=>{
  let stage=0;
  const send=createYandexReplyTransport({
    scope,session:session(),allowWrite:true,context,now:()=>now,
    fetchImpl:async(url)=>{
      stage++;
      if(stage===1)return new Response(JSON.stringify(page()),{
        status:200,headers:{'content-type':'application/json'}
      });
      if(stage===2)return new Response(JSON.stringify({csrf:'GLOBAL_CSRF'}),{
        status:488,headers:{'content-type':'application/json'}
      });
      throw Error('NETWORK_AFTER_SEND');
    }
  });
  await assert.rejects(
    send({externalReviewId:'review-42',replyText:'Спасибо',authorization:auth()}),
    e=>e.code==='YANDEX_REPLY_RESULT_UNKNOWN'&&e.providerWriteAttempted===true
  );
  assert.equal(stage,3);
}));
