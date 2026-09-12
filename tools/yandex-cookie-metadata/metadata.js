// No platform globals: only explicitly injected read APIs. Never access cookie.value.
export const TARGET = 'https://yandex.ru/sprav/api/54309413522/reviews';
const PATHS = new Set(['/','/sprav','/sprav/','/sprav/api','/sprav/api/']);
const forbidden = /csrf|xsrf|password|authorization|2fa|sms/i;
const stop = () => { throw new Error('METADATA_EXPORT_STOPPED'); };
const exact = (o, keys) => o && !Array.isArray(o) && typeof o === 'object' &&
  Object.keys(o).sort().join(',') === [...keys].sort().join(',');

export function parseRequest(text, now = Date.now()) {
  try {
    if (typeof text !== 'string' || text.length > 20000) stop();
    const r = JSON.parse(text);
    if (!exact(r,['version','requestId','url','issuedAt','names']) || r.version !== 1 || r.url !== TARGET ||
        typeof r.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(r.requestId) ||
        !Number.isSafeInteger(r.issuedAt) || r.issuedAt > now || now-r.issuedAt > 300000 ||
        !Array.isArray(r.names) || r.names.length < 1 || r.names.length > 100 ||
        new Set(r.names).size !== r.names.length || r.names.some(n => typeof n !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(n) || forbidden.test(n))) stop();
    return r;
  } catch { stop(); }
}

function projectCookie(c, name, storeId, now) {
  if (!c || c.name !== name || c.storeId !== storeId || !['yandex.ru','.yandex.ru'].includes(c.domain) ||
      !PATHS.has(c.path) || c.secure !== true || typeof c.httpOnly !== 'boolean' ||
      typeof c.session !== 'boolean' || Object.hasOwn(c,'partitionKey')) stop();
  if (c.session ? Object.hasOwn(c,'expirationDate') :
    !Number.isFinite(c.expirationDate) || c.expirationDate * 1000 <= now) stop();
  // Construct a fresh allowlisted object. No spread/serialization of an API response.
  return {name:c.name,domain:c.domain,path:c.path,secure:true,httpOnly:c.httpOnly,
    expirationDate:c.session ? null : c.expirationDate,partitioned:false};
}

export async function exportMetadata(text, api, {now = Date.now, cancelled = () => false} = {}) {
  let request, batch, records = [], tabs, stores;
  const check = () => { if (cancelled()) stop(); };
  try {
    check(); request = parseRequest(text,now()); text = null;
    tabs = await api.queryTabs({active:true,currentWindow:true}); check();
    if (!Array.isArray(tabs) || tabs.length !== 1 || !Number.isInteger(tabs[0].id) || tabs[0].incognito !== false) stop();
    const active = new URL(tabs[0].url);
    if (active.origin !== 'https://yandex.ru' || !active.pathname.startsWith('/sprav/')) stop();
    stores = await api.getStores(); check();
    if (!Array.isArray(stores)) stop();
    const matches = stores.filter(s => Array.isArray(s.tabIds) && s.tabIds.includes(tabs[0].id));
    if (matches.length !== 1 || typeof matches[0].id !== 'string' || !matches[0].id) stop();
    const storeId = matches[0].id;
    for (const name of request.names) {
      check();
      // Empty partitionKey explicitly includes all partitions: never silently prefer
      // an unpartitioned cookie over a same-named partitioned match.
      batch = await api.getCookies({url:TARGET,name,storeId,partitionKey:{}}); check();
      if (!Array.isArray(batch) || batch.length !== 1) stop();
      records.push(projectCookie(batch[0],name,storeId,now()));
      batch.fill(null); batch = null;
    }
    check();
    const capturedAt = now();
    if (capturedAt < request.issuedAt || capturedAt-request.issuedAt > 300000) stop();
    return JSON.stringify({version:1,requestId:request.requestId,url:TARGET,capturedAt,cookies:records});
  } catch { stop(); }
  finally {
    if (Array.isArray(batch)) batch.fill(null);
    batch=null; records.length=0; request=null; tabs=null; stores=null; text=null;
  }
}
