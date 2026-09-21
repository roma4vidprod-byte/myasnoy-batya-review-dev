(()=>{
  'use strict';
  const ORG='54309413522';
  let consumed=false;
  const safePage=()=>{
    try{return location.origin==='https://yandex.ru'&&location.pathname.startsWith('/sprav/')&&
      location.pathname.split('/').includes(ORG);}
    catch{return false;}
  };
  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(consumed||sender.id!==chrome.runtime.id||!safePage()||!message||
       Object.keys(message).sort().join()!=='op,version'||message.version!==1||
       message.op!=='csrf_handoff_extract'){
      sendResponse({version:1,ok:false,code:'CSRF_HANDOFF_EXTRACT_DENIED'});
      return false;
    }
    consumed=true;
    const requestId=crypto.randomUUID();
    let settled=false;
    const finish=value=>{
      if(settled)return;settled=true;clearTimeout(timer);
      window.removeEventListener('message',onMessage);sendResponse(value);
    };
    const onMessage=event=>{
      const data=event.data;
      if(event.source!==window||event.origin!==location.origin||!data||
         data.source!=='review-activator-csrf-handoff'||data.version!==1||
         data.requestId!==requestId||data.op!=='csrf_handoff_page')return;
      const valid=data.organizationId===ORG&&typeof data.token==='string'&&
        data.token.length>=8&&data.token.length<=1024&&/^[\x21-\x7e]+$/.test(data.token);
      finish(valid?{version:1,ok:true,organizationId:ORG,token:data.token}:
        {version:1,ok:false,code:'CSRF_HANDOFF_EXTRACT_FAILED'});
    };
    window.addEventListener('message',onMessage);
    const timer=setTimeout(()=>finish({version:1,ok:false,code:'CSRF_HANDOFF_EXTRACT_TIMEOUT'}),3000);
    const script=document.createElement('script');
    script.src=chrome.runtime.getURL('csrf-handoff-page.js');
    script.dataset.requestId=requestId;
    (document.documentElement||document.head).appendChild(script);
    return true;
  });
})();
