(()=>{
  'use strict';
  const script=document.currentScript;
  const requestId=script?.dataset?.requestId||'';
  const ORG='54309413522';
  let token=null,permanentId=null;
  try{
    token=window?.__PRELOAD_DATA?.initialState?.env?.csrf;
    permanentId=window?.__PRELOAD_DATA?.initialState?.edit?.company?.permanent_id;
  }catch{}
  const valid=typeof token==='string'&&token.length>=8&&token.length<=1024&&
    /^[\x21-\x7e]+$/.test(token)&&String(permanentId??'')===ORG;
  window.postMessage({
    source:'review-activator-csrf-handoff',version:1,requestId,
    op:'csrf_value',organizationId:ORG,ok:valid,token:valid?token:null
  },location.origin);
  token=null;permanentId=null;
  script?.remove();
})();
