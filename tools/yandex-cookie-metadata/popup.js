import { exportMetadata } from './metadata.js';

const input = document.getElementById('request');
const copy = document.getElementById('copy');
const status = document.getElementById('status');
let stopped = false;
const api = {
  queryTabs: details => chrome.tabs.query(details),
  getStores: () => chrome.cookies.getAllCookieStores(),
  getCookies: details => chrome.cookies.getAll(details)
};
document.getElementById('cancel').addEventListener('click', () => {
  stopped = true; input.value = ''; copy.disabled = true;
  status.textContent = 'Отменено. Метаданные не отправляются.';
});
window.addEventListener('pagehide', () => { stopped = true; input.value = ''; });
copy.addEventListener('click', async () => {
  if (copy.disabled || stopped) return;
  copy.disabled = true;
  let text = input.value, output;
  input.value = '';
  status.textContent = 'Проверка локальных метаданных…';
  try {
    output = await exportMetadata(text,api,{cancelled:() => stopped});
    text = null;
    if (stopped) return;
    await navigator.clipboard.writeText(output);
    status.textContent = 'Скопированы только метаданные. Вставьте их в ожидающий PowerShell.';
  } catch {
    status.textContent = 'Экспорт остановлен. Закройте окно. Ничего не импортируйте и не угадывайте атрибуты.';
  } finally { text = null; output = null; input.value = ''; }
});
