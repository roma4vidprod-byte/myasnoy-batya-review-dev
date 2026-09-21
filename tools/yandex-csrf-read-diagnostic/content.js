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
  const denied=sendResponse=>{
    sendResponse({version:1,ok:false,code:'REQUEST_DENIED',http_status:null,
      content_type:'NONE',csrf_present:false,csrf_length:null,
      permanent_id_present:false,permanent_id_match:false,
      provider_requests:0,provider_writes:0,answer_endpoint_called:false});
  };

  function preloadDiagnostic(sendResponse){
    const requestId=crypto.randomUUID();
    let settled=false;
    const finish=value=>{
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      window.removeEventListener('message',onMessage);
      sendResponse(value);
    };
    const onMessage=event=>{
      const data=event.data;
      if(event.source!==window||event.origin!==location.origin||!data||
         data.source!=='review-activator-csrf-read'||data.version!==1||
         data.requestId!==requestId||data.op!=='preload_result')return;
      const present=data.csrf_present===true&&Number.isSafeInteger(data.csrf_length)&&
        data.csrf_length>=8&&data.csrf_length<=1024;
      const orgMatch=data.permanent_id_present===true&&data.permanent_id_match===true;
      finish({
        version:1,ok:present&&orgMatch,
        code:present&&orgMatch?'PASS_PRELOAD_CSRF_PRESENT':'PRELOAD_CSRF_NOT_PROVEN',
        http_status:null,content_type:'PRELOAD',
        csrf_present:present,csrf_length:present?data.csrf_length:null,
        permanent_id_present:data.permanent_id_present===true,
        permanent_id_match:data.permanent_id_match===true,
        provider_requests:0,provider_writes:0,answer_endpoint_called:false
      });
    };
    window.addEventListener('message',onMessage);
    const timer=setTimeout(()=>finish({
      version:1,ok:false,code:'PRELOAD_CSRF_TIMEOUT',http_status:null,
      content_type:'PRELOAD',csrf_present:false,csrf_length:null,
      permanent_id_present:false,permanent_id_match:false,
      provider_requests:0,provider_writes:0,answer_endpoint_called:false
    }),3000);
    const script=document.createElement('script');
    script.src=chrome.runtime.getURL('page-inspect.js');
    script.dataset.requestId=requestId;
    (document.documentElement||document.head).appendChild(script);
  }

  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(consumed||!safePage()||sender.id!==chrome.runtime.id||
       !message||Object.keys(message).sort().join()!=='op,version'||message.version!==1||
       !['csrf_get_diagnostic','csrf_preload_diagnostic'].includes(message.op)){
      denied(sendResponse);
      return false;
    }
    consumed=true;

    if(message.op==='csrf_preload_diagnostic'){
      preloadDiagnostic(sendResponse);
      return true;
    }

    (async()=>{
      try{
        const response=await fetch(ENDPOINT,{
          method:'GET',credentials:'include',redirect:'manual',cache:'no-store',
          headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)
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
          version:1,ok:response.status===488&&contentType==='JSON'&&present,
          code:response.status===488&&contentType==='JSON'&&present?
            'PASS_CSRF_PRESENT':'CSRF_GET_CONTRACT_NOT_PROVEN',
          http_status:Number.isSafeInteger(response.status)?response.status:null,
          content_type:contentType,csrf_present:present,csrf_length:present?csrf.length:null,
          permanent_id_present:true,permanent_id_match:true,
          provider_requests:1,provider_writes:0,answer_endpoint_called:false
        });
      }catch{
        sendResponse({version:1,ok:false,code:'CSRF_GET_FAILED',http_status:null,
          content_type:'NONE',csrf_present:false,csrf_length:null,
          permanent_id_present:true,permanent_id_match:true,
          provider_requests:1,provider_writes:0,answer_endpoint_called:false});
      }
    })();
    return true;
  });
})();
