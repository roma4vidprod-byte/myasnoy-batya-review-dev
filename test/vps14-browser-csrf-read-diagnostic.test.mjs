import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const root=new URL('../tools/yandex-csrf-read-diagnostic/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',root),'utf8'));
const content=readFileSync(new URL('content.js',root),'utf8');
const popup=readFileSync(new URL('popup.js',root),'utf8');

test('VPS14 CSRF browser diagnostic is a separate minimal extension',()=>{
  assert.deepEqual(manifest.permissions,[]);
  assert.deepEqual(manifest.host_permissions,['https://yandex.ru/*']);
  assert.equal(manifest.incognito,'not_allowed');
  assert.equal(manifest.content_scripts.length,1);
  assert.deepEqual(manifest.content_scripts[0].matches,['https://yandex.ru/sprav/*']);
  assert.deepEqual(manifest.content_scripts[0].js,['content.js']);
  assert.match(manifest.content_security_policy.extension_pages,/connect-src 'none'/);
});

test('VPS14 CSRF browser content script performs one GET-only fixed-endpoint diagnostic',()=>{
  assert.match(content,/https:\/\/yandex\.ru\/sprav\/api\/view\/chain\/0\/list\//);
  assert.match(content,/method:'GET'/);
  assert.match(content,/credentials:'include'/);
  assert.match(content,/redirect:'manual'/);
  assert.match(content,/let consumed=false/);
  assert.match(content,/consumed=true/);
  assert.doesNotMatch(content,/method:\s*['"]POST['"]/);
  assert.doesNotMatch(content,/business-answer/i);
  assert.doesNotMatch(content,/chrome\.cookies|nativeMessaging|connectNative/);
});

test('VPS14 CSRF browser diagnostic returns aggregates only',()=>{
  for(const value of [
    'csrf_present','csrf_length','provider_requests:1','provider_writes:0',
    'answer_endpoint_called:false','PASS_CSRF_PRESENT',
    'CSRF_GET_CONTRACT_NOT_PROVEN'
  ])assert.ok(content.includes(value),value);
  assert.doesNotMatch(content,/sendResponse\([^)]*csrf\s*:/s);
  assert.doesNotMatch(content,/token\s*:/i);
  assert.doesNotMatch(popup,/\bfetch\s*\(|chrome\.cookies|connectNative|nativeMessaging/);
});

test('VPS14 CSRF browser diagnostic is exact-org and exact-message gated',()=>{
  assert.match(content,/54309413522/);
  assert.match(content,/message\.op!=='csrf_get_diagnostic'/);
  assert.match(content,/sender\.id!==chrome\.runtime\.id/);
  assert.match(popup,/csrf_get_diagnostic/);
  assert.match(popup,/54309413522/);
});


function contentHarness({pathname='/sprav/54309413522/edit/reviews',responseStatus=488,responseBody={csrf:'SYNTHETIC_CSRF_TOKEN_123'}}={}){
  let listener=null,fetchCalls=[];
  const context={
    location:{origin:'https://yandex.ru',pathname},
    TextEncoder,AbortSignal,
    chrome:{runtime:{
      id:'synthetic-extension',
      onMessage:{addListener(fn){listener=fn;}}
    }},
    fetch:async(url,options)=>{
      fetchCalls.push({url,options});
      return {
        status:responseStatus,
        headers:{get(name){return String(name).toLowerCase()==='content-type'?'application/json':null;}},
        async text(){return JSON.stringify(responseBody);}
      };
    }
  };
  vm.runInNewContext(content,context,{filename:'content.js'});
  assert.equal(typeof listener,'function');
  const send=message=>new Promise((resolve,reject)=>{
    let returnedValue,callbackValue,callbackCalled=false;
    const callback=value=>{
      callbackCalled=true;
      callbackValue=value;
      if(returnedValue!==undefined)resolve({returned:returnedValue,value:callbackValue});
    };
    returnedValue=listener(message,{id:'synthetic-extension'},callback);
    if(callbackCalled)resolve({returned:returnedValue,value:callbackValue});
    else if(returnedValue!==true)reject(new Error('NO_RESPONSE'));
  });
  return {send,fetchCalls};
}

test('VPS14 CSRF content behavior performs exactly one GET and never returns token value',async()=>{
  const h=contentHarness();
  const first=await h.send({version:1,op:'csrf_get_diagnostic'});
  assert.equal(first.returned,true);
  assert.equal(h.fetchCalls.length,1);
  assert.equal(h.fetchCalls[0].url,'https://yandex.ru/sprav/api/view/chain/0/list/');
  assert.equal(h.fetchCalls[0].options.method,'GET');
  assert.equal(h.fetchCalls[0].options.credentials,'include');
  assert.equal(h.fetchCalls[0].options.body,undefined);
  assert.equal(first.value.ok,true);
  assert.equal(first.value.code,'PASS_CSRF_PRESENT');
  assert.equal(first.value.csrf_present,true);
  assert.equal(first.value.csrf_length,'SYNTHETIC_CSRF_TOKEN_123'.length);
  assert.equal(first.value.provider_requests,1);
  assert.equal(first.value.provider_writes,0);
  assert.equal(first.value.answer_endpoint_called,false);
  assert.equal(Object.hasOwn(first.value,'csrf'),false);
  assert.equal(Object.hasOwn(first.value,'token'),false);

  const second=await h.send({version:1,op:'csrf_get_diagnostic'});
  assert.equal(second.returned,false);
  assert.equal(second.value.code,'REQUEST_DENIED');
  assert.equal(second.value.provider_requests,0);
  assert.equal(h.fetchCalls.length,1);
});

test('VPS14 CSRF content behavior denies wrong organization page before fetch',async()=>{
  const h=contentHarness({pathname:'/sprav/999999/edit/reviews'});
  const result=await h.send({version:1,op:'csrf_get_diagnostic'});
  assert.equal(result.returned,false);
  assert.equal(result.value.code,'REQUEST_DENIED');
  assert.equal(result.value.provider_requests,0);
  assert.equal(result.value.provider_writes,0);
  assert.equal(h.fetchCalls.length,0);
});
