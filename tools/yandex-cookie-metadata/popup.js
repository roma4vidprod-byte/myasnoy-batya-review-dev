import {connectBusiness,connectCsrfReadiness,nativeChannel} from './connect.js';
import {diagnose} from './diagnostics.js';
const button=document.getElementById('copy');
const csrfButton=document.getElementById('csrf-ready');
const diagnosticButton=document.getElementById('diagnose');
const cancelButton=document.getElementById('cancel');
const status=document.getElementById('status');
let stopped=false,channel;
const api={
  queryTabs:details=>chrome.tabs.query(details),
  getStores:()=>chrome.cookies.getAllCookieStores(),
  getCookies:details=>chrome.cookies.getAll(details),
  extractCsrf:tabId=>chrome.tabs.sendMessage(tabId,{version:1,op:'csrf_handoff_extract'})
};
function disableAll(){button.disabled=true;csrfButton.disabled=true;diagnosticButton.disabled=true;}
function cancel(){
  stopped=true;disableAll();cancelButton.disabled=true;channel?.close();
  status.textContent='Остановлено. Если передача уже началась, результат неизвестен. Не повторяйте без проверки статуса.';
}
cancelButton.addEventListener('click',cancel);
window.addEventListener('pagehide',cancel);
button.addEventListener('click',async()=>{
  if(stopped||button.disabled)return;
  disableAll();
  status.textContent='Локальный импорт… Не закрывайте окно.';
  try{
    channel=nativeChannel(chrome.runtime);
    await connectBusiness(api,channel,{cancelled:()=>stopped});
    status.textContent='Session imported\nState: NOT_CONFIGURED';
  }catch{
    status.textContent='Импорт не подтверждён. Не повторяйте: сначала проверьте безопасный статус.';
  }finally{channel=null;}
});
csrfButton.addEventListener('click',async()=>{
  if(stopped||csrfButton.disabled)return;
  disableAll();
  status.textContent='CSRF readiness… Запросов к Яндексу не будет.';
  try{
    channel=nativeChannel(chrome.runtime);
    await connectCsrfReadiness(api,channel,{cancelled:()=>stopped});
    status.textContent='CSRF handoff READY\nprovider requests = 0\nprovider writes = 0';
  }catch{
    status.textContent='CSRF readiness не подтверждён. Provider write не выполнялся.';
  }finally{channel=null;}
});
diagnosticButton.addEventListener('click',async()=>{
  if(stopped||diagnosticButton.disabled)return;
  disableAll();
  status.textContent='Диагностика без импорта…';
  try{
    const output=await diagnose(chrome.runtime,api,{cancelled:()=>stopped,openChannel:runtime=>{
      channel=nativeChannel(runtime);return channel;
    }});
    status.textContent=`diagnostic stage = ${output.stage}\ndiagnostic code = ${output.code}\nimport calls = 0`;
    if(output.counts){
      for(const key of ['total','examined','prohibited_names','metadata_eligible','metadata_rejected',
        'duplicate_name_groups','duplicate_name_excess','eligible_duplicate_name_groups','eligible_duplicate_name_excess',
        'partitioned','scope_mismatch','not_secure','expired']){
        const count=output.counts[key];
        if(!Number.isSafeInteger(count)||count<0)throw new Error('COUNT_INVALID');
        status.textContent+=`\n${key} = ${count}`;
      }
      status.textContent+=`\ncounts_complete = ${output.counts.complete===true}\nvalues_checked = false`;
    }
  }catch{
    status.textContent='diagnostic stage = UI\ndiagnostic code = CHECK_FAILED\nimport calls = 0';
  }finally{channel=null;}
});
