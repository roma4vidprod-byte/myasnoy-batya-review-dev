import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {collectSession,connectBusiness,nativeChannel,EXTENSION_ID,NATIVE_HOST} from '../tools/yandex-cookie-metadata/connect.js';
import {validateSession,encryptSession,decryptSession} from '../lib/server/yandex-session/crypto.js';
import {createYandexSessionService} from '../lib/server/yandex-session/service.js';

const cwd=fileURLToPath(new URL('..',import.meta.url));
const now=1900000000000;
const cookie=(name='fixture')=>({name,value:'synthetic-cookie-native',domain:'.yandex.ru',path:'/',secure:true,httpOnly:true,session:true,storeId:'main'});
function fixture(change=()=>{}){
  const calls=[],batch=[cookie(),{...cookie('second'),session:false,expirationDate:now/1000+1000},cookie('csrf_fixture')];
  change(batch);
  return {calls,batch,api:{
    queryTabs:async()=>[{id:7,url:'https://yandex.ru/sprav/54309413522/reviews',incognito:false}],
    getStores:async()=>[{id:'main',tabIds:[7]}],
    getCookies:async d=>{calls.push(d);return batch;}
  }};
}
const hello=()=>({version:1,nonce:Buffer.alloc(32).toString('base64'),expiresAt:now+30000});
test('automatic URL-applicable set: forbidden excluded, heterogeneous metadata, unchanged validator/encryption',async()=>{
  const f=fixture();
  const session=await collectSession(f.api,{now:()=>now});
  assert.deepEqual(f.calls,[{url:'https://yandex.ru/sprav/api/54309413522/reviews',storeId:'main',partitionKey:{}}]);
  assert.equal(session.cookies.length,2);
  assert.equal(validateSession(session,now).cookies.length,2);
  assert.ok(f.batch.every(x=>x===null));
  const scope={companyId:'13f3cb80-487a-4a19-96a1-fb3103200230',locationId:'9a95f63b-18e6-447b-a449-8530b67ddbae',organizationId:'54309413522'};
  const keyring={currentKid:'fixture',keys:{fixture:Buffer.alloc(32)}};
  let writes=0;
  const service=createYandexSessionService({keyring,now:()=>new Date(now),store:{replace:async(s,rev,envelope)=>{
    writes++;assert.deepEqual(s,scope);assert.equal(rev,0);
    assert.ok(!JSON.stringify(envelope).includes('synthetic-cookie'));
    assert.deepEqual(decryptSession(scope,envelope,keyring,now),validateSession(session,now));
    return {state:'NOT_CONFIGURED',revision:1};
  }}});
  await service.importSession(scope,session,0);assert.equal(writes,1);
  for(const mutation of [s=>s.cookies[0].domain='evil.test',s=>s.cookies[0].name='csrf_token',s=>s.account='other']){
    const invalid=structuredClone(session);mutation(invalid);
    await assert.rejects(service.importSession(scope,invalid,0));
    assert.equal(writes,1);
  }
});
for(const mode of ['duplicate','partition','domain','path','secure','expiry','no_expiry','empty','prohibited_only','value','store']){
  test(`automatic collection rejects ${mode} before native import`,async()=>{
    const f=fixture(b=>{
      if(mode==='duplicate')b.push(cookie());
      if(mode==='partition')b[0].partitionKey={};
      if(mode==='domain')b[0].domain='other.test';
      if(mode==='path')b[0].path='/mail';
      if(mode==='secure')b[0].secure=false;
      if(mode==='expiry'){b[0].session=false;b[0].expirationDate=1;}
      if(mode==='no_expiry')b[0].session=false;
      if(mode==='empty')b.length=0;
      if(mode==='prohibited_only')b.splice(0,2);
      if(mode==='value')b[0].value='bad\nvalue';
      if(mode==='store')b[0].storeId='other';
    });
    let calls=0;
    const channel={exchange:async()=>{calls++;return hello();},close(){}};
    await assert.rejects(connectBusiness(f.api,channel,{now:()=>now}),{message:'IMPORT_NOT_CONFIRMED'});
    assert.equal(calls,1);assert.ok(f.batch.every(x=>x===null));
  });
}
test('success: one hello + one import; close/cleanup; no automatic read',async()=>{
  const f=fixture();let calls=0,closed=false,held;
  const channel={exchange:async m=>{
    calls++;if(calls===1)return hello();
    held=m.session;assert.equal(m.op,'import');assert.equal(m.nonce,hello().nonce);
    assert.equal(m.session.cookies.length,2);return {ok:true,state:'NOT_CONFIGURED'};
  },close(){closed=true;}};
  assert.deepEqual(await connectBusiness(f.api,channel,{now:()=>now}),{ok:true,state:'NOT_CONFIGURED'});
  assert.equal(calls,2);assert.equal(closed,true);assert.equal(held.cookies.length,0);
});
test('cancellation and expired nonce never submit material',async()=>{
  for(const stage of ['before','after_hello','after_cookies','expired']){
    let cancel=stage==='before',calls=0;
    const f=fixture();const original=f.api.getCookies;
    f.api.getCookies=async d=>{const b=await original(d);if(stage==='after_cookies')cancel=true;return b;};
    const ch={exchange:async()=>{calls++;if(stage==='after_hello')cancel=true;return {...hello(),...(stage==='expired'?{expiresAt:now-1}:{})};},close(){}};
    await assert.rejects(connectBusiness(f.api,ch,{now:()=>now,cancelled:()=>cancel}));
    assert.equal(calls,stage==='before'?0:1);
  }
});
test('scope and native extension ID are exact; failures do not leak raw errors',async()=>{
  assert.throws(()=>nativeChannel({id:'wrong',connectNative(){throw new Error('PRIVATE');}}),{message:'IMPORT_NOT_CONFIRMED'});
  for(const url of ['https://example.com/sprav/54309413522','https://yandex.ru/sprav/999','https://yandex.ru/mail/54309413522']){
    const f=fixture();f.api.queryTabs=async()=>[{id:7,url,incognito:false}];
    await assert.rejects(collectSession(f.api),{message:'IMPORT_NOT_CONFIRMED'});assert.equal(f.calls.length,0);
  }
});
for(const mode of ['registration','framing','oversize','malformed','truncated','read_expired','pipe','origin','hello_expired','nonce','expired','extra','version','cancel','replay','success','host_roundtrip','host_cancel']){
  test(`PS7 native boundary ${mode}: synthetic only`,()=>{
    const env=Object.fromEntries(Object.entries(process.env).filter(([n])=>/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|PATHEXT|USERPROFILE|LOCALAPPDATA|APPDATA)$/i.test(n)));
    const r=spawnSync('pwsh',['-NoProfile','-NonInteractive','-File','test/support/yandex-native.test.ps1','-Mode',mode],{cwd,env,encoding:'utf8',timeout:15000});
    assert.equal(r.status===0&&r.stderr===''&&r.stdout.trim()==='PASS: native synthetic fixture',true);
    assert.doesNotMatch(r.stdout+r.stderr,/synthetic-cookie|nonce|ciphertext|SYNTHETIC/);
  });
}
test('missing env/args: importer never listens; native host wrong origin produces no output',()=>{
  const env=Object.fromEntries(Object.entries(process.env).filter(([n])=>/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|PATHEXT|USERPROFILE|LOCALAPPDATA|APPDATA)$/i.test(n)));
  for(const args of [[],['bad']]){
    const r=spawnSync('pwsh',['-NoProfile','-NonInteractive','-File','scripts/start-yandex-local-import.ps1',...args],{cwd,env,encoding:'utf8',timeout:5000});
    assert.equal(r.status,0);assert.equal(r.stderr,'');assert.ok(!r.stdout.includes('Importer ready'));
  }
  const r=spawnSync('pwsh',['-NoProfile','-NonInteractive','-File','scripts/yandex-native-host.ps1','wrong'],{cwd,env,encoding:'utf8',timeout:5000});
  assert.equal(r.stdout+r.stderr,'');
});
test('v4 security source inventory: no TCP/clipboard/storage/mutations; exact native origin and same-user pipes',()=>{
  const root=new URL('../tools/yandex-cookie-metadata/',import.meta.url);
  assert.deepEqual(readdirSync(root).sort(),['connect.js','diagnostics.js','manifest.json','metadata.js','popup.css','popup.html','popup.js']);
  const manifest=JSON.parse(readFileSync(new URL('manifest.json',root),'utf8'));
  assert.deepEqual(manifest.permissions,['cookies','nativeMessaging']);
  assert.deepEqual(manifest.host_permissions,['https://yandex.ru/*']);
  assert.equal(manifest.incognito,'not_allowed');
  assert.match(manifest.content_security_policy.extension_pages,/connect-src 'none'/);
  for(const field of ['background','content_scripts','externally_connectable','web_accessible_resources','optional_permissions'])assert.equal(Object.hasOwn(manifest,field),false);
  const source=['connect.js','diagnostics.js','popup.js','metadata.js'].map(f=>readFileSync(new URL(f,root),'utf8')).join('\n');
  assert.doesNotMatch(source,/fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|clipboard|localStorage|sessionStorage|indexedDB|chrome\.storage|console\.|cookies\.(set|remove)|eval\(/);
  for(const file of ['start-yandex-local-import.ps1','yandex-native-host.ps1','yandex-native-protocol.ps1']){
    const s=readFileSync(new URL('../scripts/'+file,import.meta.url),'utf8');
    assert.doesNotMatch(s,/WriteAll|Set-Content|Add-Content|Out-File|Start-Transcript|HttpListener|TcpListener|Invoke-WebRequest|Invoke-RestMethod|Get-Clipboard|Set-Clipboard/);
  }
  for(const file of ['start-yandex-local-import.ps1','yandex-native-host.ps1'])assert.match(readFileSync(new URL('../scripts/'+file,import.meta.url),'utf8'),/CurrentUserOnly/);
  assert.match(readFileSync(new URL('../scripts/yandex-native-protocol.ps1',import.meta.url),'utf8'),new RegExp(EXTENSION_ID));
  const html=readFileSync(new URL('popup.html',root),'utf8');assert.doesNotMatch(html,/<input|<form|<iframe|https?:\/\//);
});
test('actual v4 popup: click invokes native port, shows only safe success, no secret inputs',async()=>{
  const elements=new Map(['copy','diagnose','cancel','status'].map(id=>[id,{disabled:false,textContent:'',events:{},addEventListener(n,f){this.events[n]=f;}}]));
  const saved={document:globalThis.document,window:globalThis.window,chrome:globalThis.chrome};
  let onMessage,exchanges=0;
  const f=fixture();f.batch[1].expirationDate=4070934000;
  try {
    globalThis.document={getElementById:id=>elements.get(id)};globalThis.window={addEventListener(){}};
    globalThis.chrome={tabs:{query:f.api.queryTabs},cookies:{getAll:f.api.getCookies,getAllCookieStores:f.api.getStores},runtime:{id:EXTENSION_ID,connectNative(name){
      assert.equal(name,NATIVE_HOST);
      return {onMessage:{addListener(fn){onMessage=fn;}},onDisconnect:{addListener(){}},disconnect(){},postMessage(m){
        exchanges++;queueMicrotask(()=>onMessage(m.op==='hello'?{...hello(),expiresAt:Date.now()+30000}:{ok:true,state:'NOT_CONFIGURED'}));
      }};
    }}};
    await import('../tools/yandex-cookie-metadata/popup.js');
    assert.equal(exchanges,0);
    await elements.get('copy').events.click();
    assert.equal(exchanges,2);assert.equal(elements.get('status').textContent,'Session imported\nState: NOT_CONFIGURED');
  } finally {for(const n of Object.keys(saved)){if(saved[n]===undefined)delete globalThis[n];else globalThis[n]=saved[n];}}
});
