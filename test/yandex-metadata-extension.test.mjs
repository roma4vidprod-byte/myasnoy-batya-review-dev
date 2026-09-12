import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { exportMetadata, parseRequest, TARGET } from '../tools/yandex-cookie-metadata/metadata.js';

const now = 1900000000000;
const request = () => ({version:1,requestId:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',url:TARGET,issuedAt:now,names:['fixture','other']});
const cookie = name => ({name,domain:'.yandex.ru',path:'/',secure:true,httpOnly:name==='other',session:name==='fixture',
  ...(name==='other' ? {expirationDate:now/1000+3600} : {}),storeId:'main'});
function fixture(change = () => {}) {
  const calls = [], batches = [];
  const api = {
    queryTabs: async () => [{id:7,url:'https://yandex.ru/sprav/54309413522',incognito:false}],
    getStores: async () => [{id:'main',tabIds:[7]},{id:'unrelated',tabIds:[8]}],
    getCookies: async details => {
      calls.push(details);
      const c = cookie(details.name);
      Object.defineProperty(c,'value',{get() { throw new Error('VALUE_ACCESS_FORBIDDEN'); },enumerable:true});
      const batch = [c]; change(batch,details); batches.push(batch); return batch;
    }
  };
  return {api,calls,batches};
}

test('metadata export reads only requested names/exact URL/store/all partitions; never reads or serializes value', async () => {
  const f=fixture();
  const result=JSON.parse(await exportMetadata(JSON.stringify(request()),f.api,{now:() => now}));
  assert.deepEqual(f.calls,request().names.map(name => ({url:TARGET,name,storeId:'main',partitionKey:{}})));
  assert.equal(result.cookies.length,2);
  assert.equal(result.cookies[0].expirationDate,null);
  assert.equal(result.cookies[1].expirationDate,now/1000+3600);
  assert.deepEqual(Object.keys(result.cookies[0]).sort(),['name','domain','path','secure','httpOnly','expirationDate','partitioned'].sort());
  assert.equal(JSON.stringify(result).includes('value'),false);
  assert.equal(f.batches.every(b => b.every(c => c===null)),true);
});

for (const scenario of ['missing','duplicate','partitioned','partitioned_and_plain','foreign','path','insecure','expired','httpOnly','session_drift','wrong_store','wrong_name','unknown_expiry']) {
  test(`metadata export fail closed: ${scenario}`, async () => {
    const f=fixture((batch) => {
      switch(scenario) {
        case 'missing': batch.length=0; break;
        case 'duplicate': batch.push(cookie('fixture')); break;
        case 'partitioned': batch[0].partitionKey={topLevelSite:'https://yandex.ru'}; break;
        case 'partitioned_and_plain': batch.push({...cookie('fixture'),partitionKey:{topLevelSite:'https://yandex.ru'}}); break;
        case 'foreign': batch[0].domain='example.com'; break;
        case 'path': batch[0].path='/mail'; break;
        case 'insecure': batch[0].secure=false; break;
        case 'expired': batch[0].session=false; batch[0].expirationDate=1; break;
        case 'httpOnly': batch[0].httpOnly='false'; break;
        case 'session_drift': batch[0].expirationDate=now/1000+1; break;
        case 'wrong_store': batch[0].storeId='other'; break;
        case 'wrong_name': batch[0].name='unrequested'; break;
        case 'unknown_expiry': batch[0].session=false; break;
      }
    });
    await assert.rejects(exportMetadata(JSON.stringify(request()),f.api,{now:() => now}),{message:'METADATA_EXPORT_STOPPED'});
    assert.equal(f.calls.length,1);
    assert.equal(f.batches.every(b => b.every(c => c===null)),true);
  });
}

for (const scenario of ['duplicate','prohibited','extra_secret','wrong_target','stale','future','empty','raw_header']) {
  test(`metadata request rejects ${scenario} before browser access`, async () => {
    const r=request();
    switch(scenario) {
      case 'duplicate': r.names=['fixture','fixture']; break;
      case 'prohibited': r.names=['csrf_token']; break;
      case 'extra_secret': r.value='SYNTHETIC_PRIVATE'; break;
      case 'wrong_target': r.url='https://example.com/'; break;
      case 'stale': r.issuedAt=0; break;
      case 'future': r.issuedAt=now+1; break;
      case 'empty': r.names=[]; break;
    }
    let reads=0;
    await assert.rejects(exportMetadata(scenario==='raw_header' ? 'fixture=SYNTHETIC_PRIVATE' : JSON.stringify(r),
      {queryTabs:async () => {reads++;throw new Error('UNEXPECTED');}},{now:() => now}),{message:'METADATA_EXPORT_STOPPED'});
    assert.equal(reads,0);
  });
}

test('metadata cannot reconstruct a credential; strict allowlist output contains no values', async () => {
  const f=fixture(); const output=await exportMetadata(JSON.stringify(request()),f.api,{now:() => now});
  assert.throws(() => parseRequest(output,now),{message:'METADATA_EXPORT_STOPPED'});
  assert.equal(Object.hasOwn(JSON.parse(output),'cookieHeader'),false);
  assert.equal(JSON.parse(output).cookies.every(c => !Object.hasOwn(c,'value')),true);
});

test('cancelled/error export drops raw references and never returns partial metadata', async () => {
  let cancelled=false;
  const f=fixture(() => {cancelled=true;});
  await assert.rejects(exportMetadata(JSON.stringify(request()),f.api,{now:() => now,cancelled:() => cancelled}),{message:'METADATA_EXPORT_STOPPED'});
  assert.equal(f.batches[0][0],null);
  const g=fixture(); g.api.getCookies=async () => {throw new Error('SYNTHETIC_PRIVATE');};
  await assert.rejects(exportMetadata(JSON.stringify(request()),g.api,{now:() => now}),{message:'METADATA_EXPORT_STOPPED'});
});

test('wrong active origin/incognito/ambiguous store cannot read cookies', async () => {
  for (const scenario of ['origin','incognito','store']) {
    const f=fixture();
    if (scenario==='origin') f.api.queryTabs=async () => [{id:7,url:'https://example.com/',incognito:false}];
    if (scenario==='incognito') f.api.queryTabs=async () => [{id:7,url:TARGET,incognito:true}];
    if (scenario==='store') f.api.getStores=async () => [{id:'1',tabIds:[7]},{id:'2',tabIds:[7]}];
    await assert.rejects(exportMetadata(JSON.stringify(request()),f.api,{now:() => now}),{message:'METADATA_EXPORT_STOPPED'});
    assert.equal(f.calls.length,0);
  }
});

test('reviewed extension inventory/manifest: strict host, no storage/network/mutation/background or injected code', () => {
  const root=new URL('../tools/yandex-cookie-metadata/',import.meta.url);
  assert.deepEqual(readdirSync(root).sort(),['manifest.json','metadata.js','popup.css','popup.html','popup.js']);
  const manifest=JSON.parse(readFileSync(new URL('manifest.json',root),'utf8'));
  assert.deepEqual(manifest.permissions,['cookies','clipboardWrite']);
  assert.deepEqual(manifest.host_permissions,['https://yandex.ru/*']);
  assert.equal(manifest.incognito,'not_allowed');
  assert.equal(manifest.minimum_chrome_version,'132');
  assert.equal(manifest.content_security_policy.extension_pages,"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'");
  for (const field of ['background','content_scripts','web_accessible_resources','externally_connectable','update_url','optional_permissions']) assert.equal(Object.hasOwn(manifest,field),false);
  const code=['metadata.js','popup.js'].map(p => readFileSync(new URL(p,root),'utf8')).join('\n');
  assert.doesNotMatch(code,/fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|indexedDB|chrome\.storage|console\.|cookies\.(set|remove|onChanged)|readText\(|eval\(|new Function/);
  assert.doesNotMatch(code,/c\.value|cookie\.value\s*[;),=]/);
  const html=readFileSync(new URL('popup.html',root),'utf8');
  assert.match(html,/type="password"/);
  assert.doesNotMatch(html,/<form|<iframe|https?:\/\//);
});

test('actual popup click copies only metadata and clears input; no raw API value access', async () => {
  const elements=new Map(['request','copy','cancel','status'].map(id => [id,{value:'',disabled:false,textContent:'',events:{},addEventListener(name,fn){this.events[name]=fn;}}]));
  const f=fixture(); const r=request(); r.issuedAt=Date.now();
  // Use a persistent future expiry because the popup uses the real clock.
  f.api.getCookies=async details => { const c=cookie(details.name); if (!c.session)c.expirationDate=4070934000;
    Object.defineProperty(c,'value',{get(){throw new Error('PRIVATE_ACCESS');}}); return [c]; };
  const held={document:globalThis.document,window:globalThis.window,chrome:globalThis.chrome,navigator:Object.getOwnPropertyDescriptor(globalThis,'navigator')};
  const writes=[];
  try {
    globalThis.document={getElementById:id => elements.get(id)};
    globalThis.window={addEventListener(){}};
    globalThis.chrome={tabs:{query:f.api.queryTabs},cookies:{getAllCookieStores:f.api.getStores,getAll:f.api.getCookies}};
    Object.defineProperty(globalThis,'navigator',{configurable:true,value:{clipboard:{writeText:async text => {writes.push(JSON.parse(text));}}}});
    await import('../tools/yandex-cookie-metadata/popup.js');
    elements.get('request').value=JSON.stringify(r);
    await elements.get('copy').events.click();
    assert.equal(writes.length,1);
    assert.equal(writes[0].cookies.every(c => !Object.hasOwn(c,'value')),true);
    assert.equal(elements.get('request').value,'');
    assert.equal(elements.get('status').textContent.includes('только метаданные'),true);
  } finally {
    for (const name of ['document','window','chrome']) { if (held[name]===undefined) delete globalThis[name]; else globalThis[name]=held[name]; }
    if (held.navigator) Object.defineProperty(globalThis,'navigator',held.navigator); else delete globalThis.navigator;
  }
});
