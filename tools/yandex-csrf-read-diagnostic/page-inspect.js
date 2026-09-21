(()=>{
  'use strict';
  const script=document.currentScript;
  const requestId=script?.dataset?.requestId||'';
  const ORG='54309413522';
  let csrf=null,permanentId=null;
  try{
    csrf=window?.__PRELOAD_DATA?.initialState?.env?.csrf;
    permanentId=window?.__PRELOAD_DATA?.initialState?.edit?.company?.permanent_id;
  }catch{}
  const present=typeof csrf==='string'&&csrf.length>=8&&csrf.length<=1024;
  const orgMatch=String(permanentId??'')===ORG;
  window.postMessage({
    source:'review-activator-csrf-read',
    version:1,
    requestId,
    op:'preload_result',
    csrf_present:present,
    csrf_length:present?csrf.length:null,
    permanent_id_present:permanentId!==null&&permanentId!==undefined,
    permanent_id_match:orgMatch
  },location.origin);
  csrf=null;permanentId=null;
  script?.remove();
})();
