import test from 'node:test';
import assert from 'node:assert/strict';
import {runYandexReplyOnce} from '../lib/server/yandex-reply-worker.js';

const claim=()=>({
  status:'SENDING',
  actionId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  externalReviewId:'review-42',
  replyText:'Спасибо',
  idempotencyKey:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  approvalFingerprint:'c'.repeat(64),
  approvedAt:1000,
  expiresAt:100000
});

test('disabled worker does not touch store or provider',async()=>{
  let touched=0;
  const result=await runYandexReplyOnce({
    allowWrite:false,
    store:{claim:async()=>{touched++;},complete:async()=>{},fail:async()=>{}},
    createTransport:()=>{touched++;},
    getSession:async()=>{touched++;}
  });
  assert.deepEqual(result,{ok:true,status:'DISABLED',claimed:false,providerWrites:0});
  assert.equal(touched,0);
});

test('empty queue performs zero provider writes',async()=>{
  let sessions=0,transports=0;
  const result=await runYandexReplyOnce({
    allowWrite:true,
    store:{claim:async()=>null,complete:async()=>{},fail:async()=>{}},
    createTransport:()=>{transports++;},
    getSession:async()=>{sessions++;}
  });
  assert.deepEqual(result,{ok:true,status:'EMPTY',claimed:false,providerWrites:0});
  assert.equal(sessions,0);assert.equal(transports,0);
});

test('accepted provider result completes exact claimed action once',async()=>{
  const completed=[],failed=[];
  const c=claim();
  const result=await runYandexReplyOnce({
    allowWrite:true,
    store:{
      claim:async()=>c,
      complete:async value=>completed.push(value),
      fail:async value=>failed.push(value)
    },
    getSession:async()=>({safe:'synthetic'}),
    createTransport:()=>async input=>{
      assert.equal(input.externalReviewId,c.externalReviewId);
      assert.equal(input.replyText,c.replyText);
      assert.equal(input.authorization.actionId,c.actionId);
      assert.equal(input.authorization.idempotencyKey,c.idempotencyKey);
      return {ok:true,code:'YANDEX_REPLY_ACCEPTED',providerWrites:1};
    }
  });
  assert.deepEqual(result,{
    ok:true,status:'SENT',claimed:true,actionId:c.actionId,providerWrites:1
  });
  assert.deepEqual(completed,[{
    actionId:c.actionId,idempotencyKey:c.idempotencyKey,
    resultCode:'YANDEX_REPLY_ACCEPTED'
  }]);
  assert.deepEqual(failed,[]);
});

test('provider refusal marks FAILED and never completes',async()=>{
  const failed=[],completed=[];
  const c=claim();
  const result=await runYandexReplyOnce({
    allowWrite:true,
    store:{
      claim:async()=>c,
      complete:async value=>completed.push(value),
      fail:async value=>failed.push(value)
    },
    getSession:async()=>({}),
    createTransport:()=>async()=>{throw Object.assign(
      new Error('YANDEX_REPLY_CSRF_BOOTSTRAP_DRIFT'),
      {code:'YANDEX_REPLY_CSRF_BOOTSTRAP_DRIFT',providerWriteAttempted:false}
    );}
  });
  assert.equal(result.status,'FAILED');
  assert.equal(result.providerWrites,0);
  assert.deepEqual(completed,[]);
  assert.equal(failed.length,1);
  assert.equal(failed[0].errorCode,'YANDEX_REPLY_CSRF_BOOTSTRAP_DRIFT');
});

test('uncertain network after final POST marks one attempted write and no retry',async()=>{
  const failed=[];let sends=0;
  const c=claim();
  const result=await runYandexReplyOnce({
    allowWrite:true,
    store:{
      claim:async()=>c,
      complete:async()=>{throw Error('MUST_NOT_COMPLETE');},
      fail:async value=>failed.push(value)
    },
    getSession:async()=>({}),
    createTransport:()=>async()=>{
      sends++;
      throw Object.assign(new Error('YANDEX_REPLY_RESULT_UNKNOWN'),{
        code:'YANDEX_REPLY_RESULT_UNKNOWN',providerWriteAttempted:true
      });
    }
  });
  assert.equal(sends,1);
  assert.equal(result.status,'FAILED');
  assert.equal(result.providerWrites,1);
  assert.equal(result.errorCode,'YANDEX_REPLY_RESULT_UNKNOWN');
  assert.equal(failed.length,1);
});

test('unknown error is redacted before persistence',async()=>{
  const failed=[];
  const c=claim();
  const result=await runYandexReplyOnce({
    allowWrite:true,
    store:{
      claim:async()=>c,
      complete:async()=>{},
      fail:async value=>failed.push(value)
    },
    getSession:async()=>{throw new Error('raw private error body');},
    createTransport:()=>async()=>({})
  });
  assert.equal(result.errorCode,'YANDEX_REPLY_OPERATION_FAILED');
  assert.equal(failed[0].errorCode,'YANDEX_REPLY_OPERATION_FAILED');
  assert.equal(JSON.stringify(result).includes('private'),false);
});
