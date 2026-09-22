(()=>{
  'use strict';
  const ORG='54309413522';
  let consumed=false;
  const safePage=()=>{
    try{
      return location.origin==='https://yandex.ru'&&
        location.pathname.startsWith('/sprav/')&&
        location.pathname.split('/').includes(ORG);
    }catch{return false;}
  };
  const denied=sendResponse=>{
    sendResponse({version:1,ok:false,code:'CSRF_HANDOFF_DENIED',token:null});
  };
  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(consumed||!safePage()||sender.id!==chrome.runtime.id||!message||
       Object.keys(message).sort().join()!=='expiresAt,nonce,op,version'||
       message.version!==1||message.op!=='csrf_handoff_read'||
       typeof message.nonce!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(message.nonce)||
       !Number.isSafeInteger(message.expiresAt)||message.expiresAt<=Date.now()||
       message.expiresAt>Date.now()+120000){
      denied(sendResponse);return false;
    }
    consumed=true;
    const requestId=crypto.randomUUID();
    let settled=false;
    const finish=value=>{
      if(settled)return;
      settled=true;clearTimeout(timer);
      window.removeEventListener('message',onMessage);
      sendResponse(value);
    };
    const onMessage=event=>{
      const data=event.data;
      if(event.source!==window||event.origin!==location.origin||!data||
         data.source!=='review-activator-csrf-handoff'||data.version!==1||
         data.requestId!==requestId||data.op!=='csrf_value')return;
      const valid=data.ok===true&&data.organizationId===ORG&&
        typeof data.token==='string'&&data.token.length>=8&&data.token.length<=1024&&
        /^[\x21-\x7e]+$/.test(data.token);
      finish({version:1,ok:valid,code:valid?'CSRF_VALUE_READY':'CSRF_VALUE_DENIED',
        token:valid?data.token:null});
      if(data&&typeof data==='object')data.token=null;
    };
    window.addEventListener('message',onMessage);
    const timer=setTimeout(()=>finish({
      version:1,ok:false,code:'CSRF_VALUE_TIMEOUT',token:null
    }),3000);
    const script=document.createElement('script');
    script.src=chrome.runtime.getURL('csrf-handoff-page.js');
    script.dataset.requestId=requestId;
    (document.documentElement||document.head).appendChild(script);
    return true;
  });
})();
