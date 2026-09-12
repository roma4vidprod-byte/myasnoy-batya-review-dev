import {connectBusiness,nativeChannel} from './connect.js';
import {diagnose} from './diagnostics.js';
const button=document.getElementById('copy');
const diagnosticButton=document.getElementById('diagnose');
const status=document.getElementById('status');
let stopped=false,channel;
const api={
  queryTabs:details=>chrome.tabs.query(details),
  getStores:()=>chrome.cookies.getAllCookieStores(),
  getCookies:details=>chrome.cookies.getAll(details)
};
function cancel(){
  stopped=true;button.disabled=true;diagnosticButton.disabled=true;channel?.close();
  status.textContent='Остановлено. Если передача уже началась, результат неизвестен. Не повторяйте импорт.';
}
document.getElementById('cancel').addEventListener('click',cancel);
window.addEventListener('pagehide',cancel);
button.addEventListener('click',async()=>{
  if(stopped||button.disabled)return;
  button.disabled=true;
  diagnosticButton.disabled=true;
  status.textContent='Локальный импорт… Не закрывайте окно.';
  try {
    channel=nativeChannel(chrome.runtime);
    await connectBusiness(api,channel,{cancelled:()=>stopped});
    status.textContent='Session imported\nState: NOT_CONFIGURED';
  } catch {
    status.textContent='Импорт не подтверждён. Не повторяйте: сначала проверьте безопасный статус.';
  } finally {channel=null;}
});
diagnosticButton.addEventListener('click',async()=>{
  if(stopped||button.disabled||diagnosticButton.disabled)return;
  button.disabled=true;diagnosticButton.disabled=true;
  status.textContent='Диагностика без импорта…';
  try {
    const output=await diagnose(chrome.runtime,api,{cancelled:()=>stopped,openChannel:runtime=>{
      channel=nativeChannel(runtime);return channel;
    }});
    status.textContent=`diagnostic stage = ${output.stage}\ndiagnostic code = ${output.code}\nimport calls = 0`;
    if(output.counts){
      // Fixed labels/scalars only. Never render objects, names or raw metadata.
      for(const key of ['total','examined','prohibited_names','metadata_eligible','metadata_rejected',
        'duplicate_name_groups','duplicate_name_excess','partitioned','scope_mismatch','not_secure','expired']){
        const count=output.counts[key];
        if(!Number.isSafeInteger(count)||count<0)throw new Error('COUNT_INVALID');
        status.textContent+=`\n${key} = ${count}`;
      }
      status.textContent+=`\ncounts_complete = ${output.counts.complete===true}\nvalues_checked = false`;
    }
  } catch {
    status.textContent='diagnostic stage = UI\ndiagnostic code = CHECK_FAILED\nimport calls = 0';
  } finally {channel=null;}
});
