import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import http from 'node:http';
import {once} from 'node:events';
import {createLabServer} from '../lib/server/vps/lab.js';
import {createGateway,DEFAULT_INTERNAL_ORIGIN} from '../tools/vps12/https-gateway.mjs';

const sql=readFileSync(new URL('../tools/vps13/reply-drafts.sql',import.meta.url),'utf8');
const admin=readFileSync(new URL('../admin.html',import.meta.url),'utf8');

// Real gateway + internal application; only the PostgREST boundary is synthetic.
// No public listener, credentials, database or provider requests.
function localRequest(server,path,{method='POST',headers={},body='{}'}={}) {
  return new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port:server.address().port,path,method,agent:false,
      headers:{'Content-Type':'application/json',...headers}},res=>{
      let text='';res.on('data',chunk=>text+=chunk);
      res.on('end',()=>resolve({status:res.statusCode,text}));
    });
    req.on('error',reject);req.end(['GET','HEAD'].includes(method)?undefined:body);
  });
}
test('VPS13 gateway reaches only scoped drafts through the actual internal app',async t=>{
  const origin='https://review.example.invalid',calls=[];
  const config={profile:'vps-lab',host:'127.0.0.1',target:{url:DEFAULT_INTERNAL_ORIGIN},
    apiUrl:'http://127.0.0.1:13001',authUrl:'http://127.0.0.1:19999',
    maxBodyBytes:65536,maxHeaderBytes:8192,bodyTimeoutMs:500,handlerTimeoutMs:1000,
    headersTimeoutMs:1000,requestTimeoutMs:2000,keepAliveTimeoutMs:10,shutdownTimeoutMs:500};
  const app=createLabServer({config,fetchImpl:async(url,options)=>{
    calls.push({url,options});return new Response('{}',{status:200});
  }});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  t.after(()=>app.stop());
  const priorFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    assert.ok(url.startsWith(DEFAULT_INTERNAL_ORIGIN+'/'));
    const result=await localRequest(app.server,url.slice(DEFAULT_INTERNAL_ORIGIN.length),options);
    return new Response(result.text,{status:result.status});
  };
  t.after(()=>{globalThis.fetch=priorFetch;});
  const gateway=createGateway({publicOrigin:origin});
  gateway.listen(0,'127.0.0.1');await once(gateway,'listening');
  t.after(()=>new Promise(resolve=>{gateway.close(resolve);gateway.closeAllConnections();}));
  const headers={Origin:origin,Authorization:'Bearer synthetic.operator.jwt'};
  for(const name of ['review_admin_reviews_with_drafts_scoped','review_admin_save_reply_draft_scoped','review_admin_discard_reply_draft_scoped']) {
    const result=await localRequest(gateway,'/rest/v1/rpc/'+name,{headers});
    assert.equal(result.status,200,name);
    assert.equal(calls.at(-1).url,config.apiUrl+'/rpc/'+name);
    assert.equal(calls.at(-1).options.headers.Authorization,headers.Authorization);
  }
  assert.equal(calls.length,3);
  for(const name of ['review_admin_save_reply_draft','review_admin_publish_reply','review_admin_queue_reply','review_claim_initial_owner','arbitrary']) {
    const path='/rest/v1/rpc/'+name;
    assert.equal((await localRequest(gateway,path,{headers})).status,404);
    assert.equal((await localRequest(app.server,path)).status,404);
  }
  assert.equal((await localRequest(gateway,'/rest/v1/review_external_reviews',{method:'GET',body:undefined})).status,404);
  const wrong=await localRequest(gateway,'/rest/v1/rpc/review_admin_save_reply_draft_scoped',{headers:{...headers,Origin:'https://wrong.invalid'}});
  assert.equal(wrong.status,403);assert.equal(JSON.parse(wrong.text).error,'ORIGIN_NOT_ALLOWED');
  assert.equal(calls.length,3);
});

test('VPS13 draft RPCs are exact-scope and membership gated',()=>{
  for(const value of [
    'review_admin_reviews_with_drafts_scoped',
    'review_admin_save_reply_draft_scoped',
    'review_admin_discard_reply_draft_scoped',
    'vps_lab_private.has_company(p_company_id)',
    '13f3cb80-487a-4a19-96a1-fb3103200230',
    '9a95f63b-18e6-447b-a449-8530b67ddbae',
    '54309413522',
    "p_provider is distinct from 'yandex'",
    'COMPANY_ACCESS_DENIED'
  ]) assert.ok(sql.includes(value),value);
});
test('VPS13 only mutates local draft state and blocks queued/sending regression',()=>{
  assert.match(sql,/status in \('QUEUED','SENDING'\)/);
  assert.match(sql,/where public\.review_reply_actions\.status='DRAFT'/);
  assert.match(sql,/status='CANCELLED'/);
  assert.match(sql,/set reply_state='DRAFT'/);
  assert.match(sql,/set reply_state='NONE'/);
  assert.doesNotMatch(sql,/https?:\/\//i);
  assert.doesNotMatch(sql,/fetch\s*\(/i);
  assert.doesNotMatch(sql,/status='SENT'/i);
  assert.doesNotMatch(sql,/status='QUEUED'/i);
  assert.doesNotMatch(sql,/status='SENDING'/i);
});

test('VPS13 browser UI exposes draft save/discard but no publish control',()=>{
  for(const value of [
    'review_admin_reviews_with_drafts_scoped',
    'review_admin_save_reply_draft_scoped',
    'review_admin_discard_reply_draft_scoped',
    'Сохранить черновик',
    'Удалить черновик',
    'Публикация в Яндекс отключена до следующего этапа.'
  ]) assert.ok(admin.includes(value),value);
  assert.equal(admin.includes('review_admin_publish_reply'),false);
  assert.equal(admin.includes('review_admin_queue_reply'),false);
});
