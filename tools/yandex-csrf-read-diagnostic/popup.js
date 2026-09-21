const run=document.getElementById('run');
const preload=document.getElementById('preload');
const status=document.getElementById('status');

function safeTab(tab){
  try{
    const url=new URL(tab?.url||'');
    return Number.isInteger(tab?.id)&&url.origin==='https://yandex.ru'&&
      url.pathname.startsWith('/sprav/')&&
      url.pathname.split('/').includes('54309413522');
  }catch{return false;}
}
function scalar(value){
  return typeof value==='boolean'||typeof value==='string'||Number.isSafeInteger(value);
}
async function execute(op){
  if(run.disabled||preload.disabled)return;
  run.disabled=true;preload.disabled=true;
  status.textContent=op==='csrf_preload_diagnostic'?'PRELOAD-диагностика…':'GET-диагностика…';
  try{
    const tabs=await chrome.tabs.query({active:true,currentWindow:true});
    if(!Array.isArray(tabs)||tabs.length!==1||!safeTab(tabs[0]))throw new Error();
    const result=await chrome.tabs.sendMessage(tabs[0].id,{version:1,op});
    const required=['ok','code','http_status','content_type','csrf_present','csrf_length',
      'permanent_id_present','permanent_id_match',
      'provider_requests','provider_writes','answer_endpoint_called'];
    if(!result||result.version!==1||required.some(key=>!scalar(result[key])&&result[key]!==null))
      throw new Error();
    status.textContent=[
      'diagnostic code = '+result.code,
      'http status = '+String(result.http_status),
      'content type = '+result.content_type,
      'csrf present = '+result.csrf_present,
      'csrf length = '+String(result.csrf_length),
      'permanent id present = '+result.permanent_id_present,
      'permanent id match = '+result.permanent_id_match,
      'provider requests = '+result.provider_requests,
      'provider writes = '+result.provider_writes,
      'answer endpoint called = '+result.answer_endpoint_called
    ].join('\n');
  }catch{
    status.textContent='diagnostic code = CHECK_FAILED\nprovider writes = 0\nanswer endpoint called = false';
  }
}
preload.addEventListener('click',()=>execute('csrf_preload_diagnostic'));
run.addEventListener('click',()=>execute('csrf_get_diagnostic'));
