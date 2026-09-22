import { TARGET, projectCookie, selectUnpartitioned } from './metadata.js';

export const EXTENSION_ID='gdjhmlbffahmpnphfoogegihhnfkoojm';
export const NATIVE_HOST='com.review_activator.dev_yandex';
const forbidden=/csrf|xsrf|password|authorization|2fa|sms/i;
const stop=() => { throw new Error('IMPORT_NOT_CONFIRMED'); };

// This is the URL-applicable eligible set, NOT a guessed minimal auth-cookie list.
// Account ownership cannot be proved offline; the UI explicitly states the account.
export async function collectSession(api,{now=Date.now,cancelled=()=>false}={}) {
  let batch, selected, cookies=[];
  const check=()=>{if(cancelled())stop();};
  try {
    check();
    const tabs=await api.queryTabs({active:true,currentWindow:true}); check();
    if(!Array.isArray(tabs)||tabs.length!==1||!Number.isInteger(tabs[0].id)||tabs[0].incognito!==false)stop();
    const url=new URL(tabs[0].url);
    if(url.origin!=='https://yandex.ru'||!url.pathname.startsWith('/sprav/')||
      !url.pathname.split('/').includes('54309413522'))stop();
    const stores=await api.getStores(); check();
    if(!Array.isArray(stores))stop();
    const matches=stores.filter(s=>Array.isArray(s.tabIds)&&s.tabIds.includes(tabs[0].id));
    if(matches.length!==1||typeof matches[0].id!=='string'||!matches[0].id)stop();
    const storeId=matches[0].id;
    batch=await api.getCookies({url:TARGET,storeId,partitionKey:{}}); check();
    selected=selectUnpartitioned(batch,storeId,cancelled);
    const names=new Set();
    for(const c of selected) {
      check();
      if(!c||typeof c.name!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(c.name)||names.has(c.name))stop();
      names.add(c.name);
      // Partitioned records were excluded above. Never ignore remaining ambiguity.
      if(c.storeId!==storeId||!['yandex.ru','.yandex.ru'].includes(c.domain)||Object.hasOwn(c,'partitionKey'))stop();
      if(forbidden.test(c.name))continue;
      const m=projectCookie(c,c.name,storeId,now());
      if(typeof c.value!=='string'||! /^[\x21-\x3A\x3C-\x7E]+$/.test(c.value)||c.value.length>8192)stop();
      cookies.push({name:m.name,value:c.value,domain:m.domain,path:m.path,secure:m.secure,httpOnly:m.httpOnly,
        expires:m.expirationDate===null?-1:m.expirationDate});
    }
    if(!cookies.length)stop();
    const session={account:'myasnoibatya-zakaz',cookies};
    if(new TextEncoder().encode(JSON.stringify(session)).length>60000)stop();
    check(); cookies=[]; return session;
  } catch { stop(); }
  finally { if(Array.isArray(batch))batch.fill(null); if(selected)selected.fill(null); batch=null;selected=null;cookies.length=0; }
}

export function nativeChannel(runtime) {
  if(runtime.id!==EXTENSION_ID)stop();
  const failure=code=>Object.assign(new Error('IMPORT_NOT_CONFIRMED'),{code});
  const publicErrors={
    'Specified native messaging host not found.':'NATIVE_HOST_NOT_FOUND',
    'Access to the specified native messaging host is forbidden.':'NATIVE_HOST_FORBIDDEN',
    'Failed to start native messaging host.':'NATIVE_HOST_START_FAILED',
    'Native host has exited.':'NATIVE_HOST_EXITED',
    'Error when communicating with the native messaging host.':'NATIVE_PROTOCOL_FAILED'
  };
  const classify=message=>typeof message==='string'&&Object.hasOwn(publicErrors,message)?publicErrors[message]:'NATIVE_DISCONNECTED';
  let port;
  try {port=runtime.connectNative(NATIVE_HOST);} catch {throw failure('NATIVE_CONNECT_FAILED');}
  let pending=null, closed=false;
  function reject(code='NATIVE_DISCONNECTED'){closed=true;if(pending){clearTimeout(pending.timer);pending.reject(failure(code));pending=null;}}
  port.onDisconnect.addListener(()=>{
    let code='NATIVE_DISCONNECTED';
    try {code=classify(runtime.lastError?.message);} catch { }
    reject(code);
  });
  port.onMessage.addListener(message=>{
    if(!pending){reject();port.disconnect();return;}
    const p=pending;pending=null;clearTimeout(p.timer);p.resolve(message);
  });
  return {
    exchange(message){
      if(closed||pending)return Promise.reject(new Error('IMPORT_NOT_CONFIRMED'));
      return new Promise((resolve,rejectPromise)=>{
        pending={resolve,reject:rejectPromise,timer:setTimeout(()=>{reject('NATIVE_TIMEOUT');port.disconnect();},120000)};
        try{port.postMessage(message);}catch{reject('NATIVE_SEND_FAILED');port.disconnect();}
      });
    },
    close(){reject();port.disconnect();}
  };
}

export async function connectBusiness(api,channel,{now=Date.now,cancelled=()=>false}={}) {
  let hello,session;
  try {
    if(cancelled())stop();
    hello=await channel.exchange({version:1,op:'hello'});
    if(!hello||Object.keys(hello).sort().join()!=='expiresAt,nonce,version'||hello.version!==1||
      typeof hello.nonce!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(hello.nonce)||
      !Number.isSafeInteger(hello.expiresAt)||hello.expiresAt<=now()||hello.expiresAt-now()>120000)stop();
    session=await collectSession(api,{now,cancelled});
    if(cancelled()||now()>=hello.expiresAt)stop();
    const result=await channel.exchange({version:1,op:'import',nonce:hello.nonce,session});
    if(!result||Object.keys(result).sort().join()!=='ok,state'||result.ok!==true||result.state!=='NOT_CONFIGURED')stop();
    return {ok:true,state:'NOT_CONFIGURED'};
  } catch { stop(); }
  finally { if(session){session.cookies.length=0;} session=null;hello=null;channel.close(); }
}
export async function connectCsrfReadiness(api,channel,{now=Date.now,cancelled=()=>false}={}){
  let hello,preload,token='';
  try{
    if(cancelled())stop();
    hello=await channel.exchange({version:1,op:'hello'});
    if(!hello||Object.keys(hello).sort().join()!=='expiresAt,nonce,version'||
       hello.version!==1||typeof hello.nonce!=='string'||
       !/^[A-Za-z0-9+/]{43}=$/.test(hello.nonce)||
       !Number.isSafeInteger(hello.expiresAt)||hello.expiresAt<=now()||
       hello.expiresAt-now()>120000)stop();
    const tabs=await api.queryTabs({active:true,currentWindow:true});
    if(!Array.isArray(tabs)||tabs.length!==1||!Number.isInteger(tabs[0].id)||
       tabs[0].incognito!==false)stop();
    const url=new URL(tabs[0].url);
    if(url.origin!=='https://yandex.ru'||!url.pathname.startsWith('/sprav/')||
       !url.pathname.split('/').includes('54309413522'))stop();
    preload=await api.sendTabMessage(tabs[0].id,{
      version:1,op:'csrf_handoff_read',nonce:hello.nonce,expiresAt:hello.expiresAt
    });
    if(cancelled()||now()>=hello.expiresAt||!preload||preload.version!==1||
       preload.ok!==true||preload.code!=='CSRF_VALUE_READY'||
       typeof preload.token!=='string'||preload.token.length<8||
       preload.token.length>1024||!/^[\x21-\x7e]+$/.test(preload.token))stop();
    token=preload.token;preload.token=null;
    const result=await channel.exchange({
      version:1,op:'csrf_handoff',nonce:hello.nonce,
      organizationId:'54309413522',token
    });
    token='';
    if(!result||Object.keys(result).sort().join()!=='ok,state'||
       result.ok!==true||result.state!=='CSRF_READY')stop();
    return {ok:true,state:'CSRF_READY'};
  }catch{stop();}
  finally{
    token='';if(preload&&typeof preload==='object')preload.token=null;
    preload=null;hello=null;channel.close();
  }
}
