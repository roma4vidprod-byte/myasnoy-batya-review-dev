import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const root=new URL('../tools/yandex-csrf-read-diagnostic/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('manifest.json',root),'utf8'));
const content=readFileSync(new URL('content.js',root),'utf8');
const popup=readFileSync(new URL('popup.js',root),'utf8');
const pageInspect=readFileSync(new URL('page-inspect.js',root),'utf8');

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
  assert.match(content,/csrf_get_diagnostic/);
  assert.match(content,/csrf_preload_diagnostic/);
  assert.match(content,/sender\.id!==chrome\.runtime\.id/);
  assert.match(popup,/csrf_get_diagnostic/);
  assert.match(popup,/csrf_preload_diagnostic/);
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


test('VPS14 PRELOAD inspector reads exact page-state path with zero network',()=>{
  assert.deepEqual(manifest.web_accessible_resources,[{
    resources:['page-inspect.js'],matches:['https://yandex.ru/*']
  }]);
  assert.ok(pageInspect.includes('window?.__PRELOAD_DATA?.initialState?.env?.csrf'));
  assert.ok(pageInspect.includes('initialState?.edit?.company?.permanent_id'));
  assert.match(pageInspect,/window\.postMessage\(/);
  assert.doesNotMatch(pageInspect,/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon/i);
  assert.doesNotMatch(pageInspect,/method\s*:\s*['"]POST['"]|business-answer/i);
  assert.doesNotMatch(pageInspect,/\bcsrf\s*:/);
});

function preloadHarness({csrfPresent=true,orgMatch=true}={}){
  let listener=null,fetchCalls=0;
  const messageListeners=new Set();
  const windowObj={
    addEventListener(type,fn){if(type==='message')messageListeners.add(fn);},
    removeEventListener(type,fn){if(type==='message')messageListeners.delete(fn);}
  };
  const documentObj={
    createElement(){return {src:'',dataset:{}};},
    documentElement:{appendChild(script){
      const data={
        source:'review-activator-csrf-read',version:1,requestId:script.dataset.requestId,
        op:'preload_result',csrf_present:csrfPresent,
        csrf_length:csrfPresent?24:null,
        permanent_id_present:true,permanent_id_match:orgMatch
      };
      for(const fn of [...messageListeners])
        fn({source:windowObj,origin:'https://yandex.ru',data});
    }},
    head:null
  };
  const context={
    location:{origin:'https://yandex.ru',pathname:'/sprav/54309413522/edit/reviews'},
    TextEncoder,AbortSignal,setTimeout,clearTimeout,
    crypto:{randomUUID:()=> 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'},
    window:windowObj,document:documentObj,
    chrome:{runtime:{
      id:'synthetic-extension',
      getURL:path=>'chrome-extension://synthetic-extension/'+path,
      onMessage:{addListener(fn){listener=fn;}}
    }},
    fetch:async()=>{fetchCalls++;throw new Error('NETWORK_FORBIDDEN');}
  };
  vm.runInNewContext(content,context,{filename:'content.js'});
  const send=message=>new Promise((resolve,reject)=>{
    let returnedValue,callbackValue,callbackCalled=false;
    const callback=value=>{
      callbackCalled=true;callbackValue=value;
      if(returnedValue!==undefined)resolve({returned:returnedValue,value:callbackValue});
    };
    returnedValue=listener(message,{id:'synthetic-extension'},callback);
    if(callbackCalled)resolve({returned:returnedValue,value:callbackValue});
    else if(returnedValue!==true)reject(new Error('NO_RESPONSE'));
  });
  return {send,getFetchCalls:()=>fetchCalls};
}

test('VPS14 PRELOAD behavior proves token presence and org binding with zero provider request',async()=>{
  const h=preloadHarness();
  const result=await h.send({version:1,op:'csrf_preload_diagnostic'});
  assert.equal(result.returned,true);
  assert.equal(result.value.ok,true);
  assert.equal(result.value.code,'PASS_PRELOAD_CSRF_PRESENT');
  assert.equal(result.value.csrf_present,true);
  assert.equal(result.value.csrf_length,24);
  assert.equal(result.value.permanent_id_present,true);
  assert.equal(result.value.permanent_id_match,true);
  assert.equal(result.value.provider_requests,0);
  assert.equal(result.value.provider_writes,0);
  assert.equal(result.value.answer_endpoint_called,false);
  assert.equal(Object.hasOwn(result.value,'csrf'),false);
  assert.equal(Object.hasOwn(result.value,'token'),false);
  assert.equal(h.getFetchCalls(),0);
});

test('VPS14 PRELOAD behavior fails closed on wrong organization without network',async()=>{
  const h=preloadHarness({orgMatch:false});
  const result=await h.send({version:1,op:'csrf_preload_diagnostic'});
  assert.equal(result.value.ok,false);
  assert.equal(result.value.code,'PRELOAD_CSRF_NOT_PROVEN');
  assert.equal(result.value.permanent_id_match,false);
  assert.equal(result.value.provider_requests,0);
  assert.equal(result.value.provider_writes,0);
  assert.equal(h.getFetchCalls(),0);
});
