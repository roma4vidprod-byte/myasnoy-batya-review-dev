import {connectBusiness,nativeChannel} from './connect.js';
const button=document.getElementById('copy');
const status=document.getElementById('status');
let stopped=false,channel;
const api={
  queryTabs:details=>chrome.tabs.query(details),
  getStores:()=>chrome.cookies.getAllCookieStores(),
  getCookies:details=>chrome.cookies.getAll(details)
};
function cancel(){
  stopped=true;button.disabled=true;channel?.close();
  status.textContent='Остановлено. Если передача уже началась, результат неизвестен. Не повторяйте импорт.';
}
document.getElementById('cancel').addEventListener('click',cancel);
window.addEventListener('pagehide',cancel);
button.addEventListener('click',async()=>{
  if(stopped||button.disabled)return;
  button.disabled=true;
  status.textContent='Локальный импорт… Не закрывайте окно.';
  try {
    channel=nativeChannel(chrome.runtime);
    await connectBusiness(api,channel,{cancelled:()=>stopped});
    status.textContent='Session imported\nState: NOT_CONFIGURED';
  } catch {
    status.textContent='Импорт не подтверждён. Не повторяйте: сначала проверьте безопасный статус.';
  } finally {channel=null;}
});
