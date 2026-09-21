(()=>{
  'use strict';
  const ORG='54309413522';
  const ENDPOINT='https://yandex.ru/sprav/api/view/chain/0/list/';
  let consumed=false;

  const safePage=()=>{
    try{
      return location.origin==='https://yandex.ru'&&
        location.pathname.startsWith('/sprav/')&&
        location.pathname.split('/').includes(ORG);
    }catch{return false;}
  };
  const type=value=>value===null?'null':Array.isArray(value)?'array':typeof value;

  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(consumed||!safePage()||sender.id!==chrome.runtime.id||
       !message||Object.keys(message).sort().join()!=='op,version'||
       message.version!==1||message.op!=='csrf_get_diagnostic'){
      sendResponse({version:1,ok:false,code:'REQUEST_DENIED',http_status:null,
        content_type:'NONE',csrf_present:false,csrf_length:null,
        provider_requests:0,provider_writes:0,answer_endpoint_called:false});
      return false;
    }
    consumed=true;
    (async()=>{
      try{
        const response=await fetch(ENDPOINT,{
          method:'GET',
          credentials:'include',
          redirect:'manual',
          cache:'no-store',
          headers:{Accept:'application/json'},
          signal:AbortSignal.timeout(10000)
        });
        const text=await response.text();
        if(new TextEncoder().encode(text).length>65536)throw new Error();
        let data=null;
        try{data=JSON.parse(text);}catch{}
        const csrf=data&&type(data)==='object'&&typeof data.csrf==='string'?data.csrf:null;
        const contentType=/^application\/(?:[a-z0-9.-]+\+)?json(?:;|$)/i.test(
          response.headers.get('content-type')||''
        )?'JSON':'OTHER';
        const present=typeof csrf==='string'&&csrf.length>=8&&csrf.length<=1024;
        sendResponse({
          version:1,
          ok:response.status===488&&contentType==='JSON'&&present,
          code:response.status===488&&contentType==='JSON'&&present?
            'PASS_CSRF_PRESENT':'CSRF_GET_CONTRACT_NOT_PROVEN',
          http_status:Number.isSafeInteger(response.status)?response.status:null,
          content_type:contentType,
          csrf_present:present,
          csrf_length:present?csrf.length:null,
          provider_requests:1,
          provider_writes:0,
          answer_endpoint_called:false
        });
      }catch{
        sendResponse({version:1,ok:false,code:'CSRF_GET_FAILED',http_status:null,
          content_type:'NONE',csrf_present:false,csrf_length:null,
          provider_requests:1,provider_writes:0,answer_endpoint_called:false});
      }
    })();
    return true;
  });
})();
