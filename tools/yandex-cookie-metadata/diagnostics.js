// Read-only diagnostic: no session assembly, value access, import or metadata export.
import {EXTENSION_ID,nativeChannel} from './connect.js';
import {TARGET,projectCookie} from './metadata.js';
const paths=new Set(['/','/sprav','/sprav/','/sprav/api','/sprav/api/']);
const forbidden=/csrf|xsrf|password|authorization|2fa|sms/i;
const nativeCodes=new Set(['NATIVE_HOST_NOT_FOUND','NATIVE_HOST_FORBIDDEN','NATIVE_HOST_START_FAILED',
  'NATIVE_HOST_EXITED','NATIVE_PROTOCOL_FAILED','NATIVE_DISCONNECTED','NATIVE_CONNECT_FAILED','NATIVE_TIMEOUT','NATIVE_SEND_FAILED']);
const result=(stage,code)=>({stage,code,import_calls:0});

// Counts are not an importability verdict: values are never inspected and
// duplicate names/partitioning still block the unchanged importer.
export function countMetadata(batch,storeId,now,cancelled=()=>false){
  const counts={total:batch.length,examined:0,prohibited_names:0,metadata_eligible:0,
    metadata_rejected:0,duplicate_name_groups:0,duplicate_name_excess:0,
    partitioned:0,scope_mismatch:0,not_secure:0,expired:0,complete:false};
  const names=new Map();
  try {
    for(let i=0;i<Math.min(batch.length,10000);i++){
      if(cancelled())return null;
      const c=batch[i];counts.examined++;
      if(!c||typeof c.name!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(c.name)){
        counts.metadata_rejected++;continue;
      }
      const previous=names.get(c.name)||0;names.set(c.name,previous+1);
      if(previous===1)counts.duplicate_name_groups++;
      if(previous>0)counts.duplicate_name_excess++;
      if(Object.hasOwn(c,'partitionKey'))counts.partitioned++;
      if(c.storeId!==storeId||!['yandex.ru','.yandex.ru'].includes(c.domain))counts.scope_mismatch++;
      if(c.secure!==true)counts.not_secure++;
      if(c.session===false&&Number.isFinite(c.expirationDate)&&c.expirationDate*1000<=now)counts.expired++;
      if(forbidden.test(c.name)){counts.prohibited_names++;continue;}
      try{projectCookie(c,c.name,storeId,now);counts.metadata_eligible++;}
      catch{counts.metadata_rejected++;}
    }
    counts.complete=counts.examined===counts.total;
    return counts;
  }finally{names.clear();}
}

function metadataFailure(c,now){
  if(!paths.has(c.path))return 'COOKIE_PATH_INVALID';
  if(c.secure!==true)return 'COOKIE_NOT_SECURE';
  if(typeof c.httpOnly!=='boolean')return 'COOKIE_HTTPONLY_INVALID';
  if(typeof c.session!=='boolean')return 'COOKIE_SESSION_FLAG_INVALID';
  if(c.session&&Object.hasOwn(c,'expirationDate'))return 'COOKIE_SESSION_EXPIRY_DRIFT';
  if(!c.session&&!Number.isFinite(c.expirationDate))return 'COOKIE_EXPIRY_INVALID';
  if(!c.session&&c.expirationDate*1000<=now)return 'COOKIE_EXPIRED';
  return 'COOKIE_METADATA_DRIFT';
}

export async function diagnose(runtime,api,{now=Date.now,cancelled=()=>false,openChannel=nativeChannel}={}){
  let channel,batch,stage='EXTENSION';
  const cancel=()=>cancelled()?result('CANCELLED','CANCELLED'):null;
  try {
    if(cancelled())return cancel();
    if(runtime.id!==EXTENSION_ID)return result(stage,'EXTENSION_ID_MISMATCH');
    stage='NATIVE_CHANNEL';
    channel=openChannel(runtime);
    // No hello, nonce, session or import frame can be sent from this function.
    const reply=await channel.exchange({version:1,op:'diagnose'});
    if(cancelled())return cancel();
    if(!reply||Object.keys(reply).sort().join()!=='code,diagnostic,import_calls,stage,version'||
      reply.version!==1||reply.diagnostic!==true||reply.import_calls!==0||reply.stage!=='NATIVE_HOST'||reply.code!=='PASS'){
      return result(stage,'NATIVE_DIAGNOSTIC_REPLY_INVALID');
    }
    channel.close();channel=null;
    stage='TAB';
    const tabs=await api.queryTabs({active:true,currentWindow:true});
    if(cancelled())return cancel();
    if(!Array.isArray(tabs)||tabs.length!==1||!Number.isInteger(tabs[0].id))return result(stage,'ACTIVE_TAB_INVALID');
    if(tabs[0].incognito!==false)return result(stage,'INCOGNITO_OR_TAB_DRIFT');
    let url;try{url=new URL(tabs[0].url);}catch{return result(stage,'TAB_URL_UNAVAILABLE');}
    if(url.origin!=='https://yandex.ru'||!url.pathname.startsWith('/sprav/')||!url.pathname.split('/').includes('54309413522')){
      return result(stage,'TAB_SCOPE_INVALID');
    }
    stage='COOKIE_STORE';
    const stores=await api.getStores();
    if(cancelled())return cancel();
    if(!Array.isArray(stores))return result(stage,'COOKIE_STORES_INVALID');
    const matches=stores.filter(s=>Array.isArray(s.tabIds)&&s.tabIds.includes(tabs[0].id));
    if(matches.length!==1||typeof matches[0].id!=='string'||!matches[0].id)return result(stage,'COOKIE_STORE_AMBIGUOUS');
    const storeId=matches[0].id;
    stage='COOKIE_READ';
    batch=await api.getCookies({url:TARGET,storeId,partitionKey:{}});
    if(cancelled())return cancel();
    if(!Array.isArray(batch))return result(stage,'COOKIE_RESPONSE_INVALID');
    if(!batch.length)return result(stage,'COOKIE_SET_EMPTY');
    if(batch.length>100){
      const counts=countMetadata(batch,storeId,now(),cancelled);
      if(!counts)return result('CANCELLED','CANCELLED');
      return {...result(stage,'COOKIE_SET_TOO_LARGE'),counts};
    }
    stage='COOKIE_METADATA';
    const names=new Set();let retained=0;
    for(const c of batch){
      if(cancelled())return cancel();
      if(!c||typeof c.name!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(c.name))return result(stage,'COOKIE_NAME_INVALID');
      if(names.has(c.name))return result(stage,'COOKIE_NAME_DUPLICATE');
      names.add(c.name);
      if(c.storeId!==storeId)return result(stage,'COOKIE_STORE_MISMATCH');
      if(!['yandex.ru','.yandex.ru'].includes(c.domain))return result(stage,'COOKIE_DOMAIN_INVALID');
      if(Object.hasOwn(c,'partitionKey'))return result(stage,'COOKIE_PARTITIONED');
      if(forbidden.test(c.name))continue;
      try{projectCookie(c,c.name,storeId,now());}catch{return result(stage,metadataFailure(c,now()));}
      retained++;
    }
    if(!retained)return result(stage,'NO_ELIGIBLE_COOKIES');
    return result('METADATA_ONLY','PASS_VALUES_NOT_CHECKED');
  } catch(error){
    return result(stage,stage==='NATIVE_CHANNEL'&&nativeCodes.has(error?.code)?error.code:'CHECK_FAILED');
  } finally {
    try{channel?.close();}catch{ }
    if(Array.isArray(batch))batch.fill(null);
    batch=null;channel=null;
  }
}
