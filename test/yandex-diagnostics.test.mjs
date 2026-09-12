import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {diagnose,countMetadata} from '../tools/yandex-cookie-metadata/diagnostics.js';
import {EXTENSION_ID,nativeChannel} from '../tools/yandex-cookie-metadata/connect.js';
const now=1900000000000;
const nativePass={version:1,diagnostic:true,stage:'NATIVE_HOST',code:'PASS',import_calls:0};
function countedCookie(name,change={}){
  const c={name,domain:'.yandex.ru',path:'/',secure:true,httpOnly:true,session:true,storeId:'main',...change};
  Object.defineProperty(c,'value',{get(){throw new Error('PRIVATE_VALUE_ACCESSED');},enumerable:true});
  return c;
}
test('oversized metadata census gives exact counts, no credential access or transmission',async()=>{
  const batch=Array.from({length:101},(_,i)=>countedCookie('fixture_'+i));
  batch.push(countedCookie('csrf_fixture'),countedCookie('fixture_0'),countedCookie('partition',{partitionKey:{}}),
    countedCookie('insecure',{secure:false}),countedCookie('expired',{session:false,expirationDate:1}),
    countedCookie('foreign',{domain:'elsewhere.test'}));
  const f=fixture(b=>b.splice(0,b.length,...batch));const r=await f.run();
  assert.deepEqual(r.counts,{total:107,examined:107,prohibited_names:1,metadata_eligible:102,metadata_rejected:4,
    duplicate_name_groups:1,duplicate_name_excess:1,eligible_duplicate_name_groups:1,eligible_duplicate_name_excess:1,
    partitioned:1,scope_mismatch:1,not_secure:1,expired:1,complete:true});
  assert.equal(r.code,'COOKIE_SET_TOO_LARGE');assert.equal(r.import_calls,0);
  assert.deepEqual(f.requests,[{version:1,op:'diagnose'}]);assert.ok(f.batch.every(c=>c===null));
  assert.doesNotMatch(JSON.stringify(r),/fixture|elsewhere|PRIVATE/);
  assert.ok(Object.values(r.counts).every(x=>typeof x==='number'||typeof x==='boolean'));
});
test('counts preserve case-sensitive duplicate rules including prohibited names; no import verdict',()=>{
  const c=countMetadata([countedCookie('csrf_a'),countedCookie('csrf_a'),countedCookie('csrf_a'),
    countedCookie('CSRF_a'),countedCookie('valid'),countedCookie('valid'),null], 'main',now);
  assert.equal(c.prohibited_names,4);assert.equal(c.duplicate_name_groups,2);assert.equal(c.duplicate_name_excess,3);
  assert.equal(c.metadata_eligible,2);assert.equal(c.metadata_rejected,1);assert.equal(c.complete,true);
});
test('eligible duplicate counts exclude rejected/partitioned/prohibited matches without reading values',()=>{
  const c=countMetadata([countedCookie('same'),countedCookie('same',{partitionKey:{}}),
    countedCookie('same',{secure:false}),countedCookie('csrf_a'),countedCookie('csrf_a'),
    countedCookie('good'),countedCookie('good'),countedCookie('good'),countedCookie('Good')],'main',now);
  assert.equal(c.duplicate_name_groups,3);assert.equal(c.duplicate_name_excess,5);
  assert.equal(c.metadata_eligible,5);assert.equal(c.eligible_duplicate_name_groups,1);
  assert.equal(c.eligible_duplicate_name_excess,2);
});
test('22 individually valid unique names stay zero eligible duplicates alongside 118 partitioned records',()=>{
  // Synthetic distribution only: does not assume the owner's 22 names are unique.
  const batch=Array.from({length:22},(_,i)=>countedCookie('fixture_'+i));
  for(let i=0;i<118;i++)batch.push(countedCookie('partition_'+(i%4),{partitionKey:{}}));
  const c=countMetadata(batch,'main',now);
  assert.equal(c.total,140);assert.equal(c.metadata_eligible,22);assert.equal(c.partitioned,118);
  assert.equal(c.duplicate_name_groups,4);assert.equal(c.duplicate_name_excess,114);
  assert.equal(c.eligible_duplicate_name_groups,0);assert.equal(c.eligible_duplicate_name_excess,0);
});
test('census CPU bound marks incomplete, cancellation returns no partial counts',()=>{
  const batch=Array.from({length:10001},(_,i)=>countedCookie('fixture_'+i));
  const c=countMetadata(batch,'main',now);
  assert.equal(c.total,10001);assert.equal(c.examined,10000);assert.equal(c.complete,false);
  let calls=0;assert.equal(countMetadata(batch,'main',now,()=>++calls>3),null);
});
test('existing native import still rejects more than 100 before filtering',async()=>{
  const {collectSession}=await import('../tools/yandex-cookie-metadata/connect.js');
  const f=fixture(b=>{b.length=0;for(let i=0;i<101;i++)b.push(countedCookie('csrf_'+i));});
  await assert.rejects(collectSession(f.api,{now:()=>now}),{message:'IMPORT_NOT_CONFIRMED'});
});
function fixture(change=()=>{}){
  const cookie={name:'fixture',domain:'.yandex.ru',path:'/',secure:true,httpOnly:true,session:true,storeId:'main'};
  Object.defineProperty(cookie,'value',{enumerable:true,get(){throw new Error('SYNTHETIC_PRIVATE_VALUE_ACCESSED');}});
  const batch=[cookie];change(batch);
  const requests=[];let reads=0,closes=0;
  const api={
    queryTabs:async()=>[{id:1,url:'https://yandex.ru/sprav/54309413522/p/edit/reviews/?page=2',incognito:false}],
    getStores:async()=>[{id:'main',tabIds:[1]}],
    getCookies:async args=>{reads++;assert.deepEqual(args,{url:'https://yandex.ru/sprav/api/54309413522/reviews',storeId:'main',partitionKey:{}});return batch;}
  };
  const channel={exchange:async m=>{requests.push(m);return nativePass;},close(){closes++;}};
  return {batch,api,channel,requests,get reads(){return reads;},get closes(){return closes;},run:options=>diagnose({id:EXTENSION_ID},api,{now:()=>now,openChannel:()=>channel,...options})};
}
test('diagnostic PASS never accesses cookie values or sends material; only single diagnostic frame',async()=>{
  const f=fixture();const r=await f.run();
  assert.deepEqual(r,{stage:'METADATA_ONLY',code:'PASS_VALUES_NOT_CHECKED',import_calls:0});
  assert.deepEqual(f.requests,[{version:1,op:'diagnose'}]);assert.equal(f.reads,1);assert.ok(f.closes>0);
  assert.ok(f.batch.every(c=>c===null));assert.doesNotMatch(JSON.stringify(r),/fixture|value\"|SYNTHETIC/);
});
const cases={
  COOKIE_NOT_SECURE:b=>b[0].secure=false,
  COOKIE_PATH_INVALID:b=>b[0].path='/mail',
  COOKIE_HTTPONLY_INVALID:b=>b[0].httpOnly='false',
  COOKIE_SESSION_FLAG_INVALID:b=>b[0].session=null,
  COOKIE_SESSION_EXPIRY_DRIFT:b=>b[0].expirationDate=now/1000+1,
  COOKIE_EXPIRY_INVALID:b=>b[0].session=false,
  COOKIE_EXPIRED:b=>{b[0].session=false;b[0].expirationDate=1;},
  COOKIE_DOMAIN_INVALID:b=>b[0].domain='elsewhere.test',
  COOKIE_STORE_MISMATCH:b=>b[0].storeId='other',
  COOKIE_NAME_INVALID:b=>b[0].name='bad=name',
  COOKIE_PARTITIONED:b=>b[0].partitionKey={},
  COOKIE_NAME_DUPLICATE:b=>b.push(b[0]),
  NO_ELIGIBLE_COOKIES:b=>b[0].name='csrf_fixture',
  COOKIE_SET_EMPTY:b=>b.length=0,
  COOKIE_SET_TOO_LARGE:b=>{const c=b[0];while(b.length<=100)b.push(c);}
};
for(const [code,change] of Object.entries(cases))test(`diagnostic safe reason ${code}; zero import`,async()=>{
  const f=fixture(change);const r=await f.run();
  assert.equal(r.code,code);assert.equal(r.import_calls,0);assert.equal(f.requests.length,1);
  assert.deepEqual(Object.keys(r).sort(),code==='COOKIE_SET_TOO_LARGE'?['code','counts','import_calls','stage']:['code','import_calls','stage']);assert.ok(f.batch.every(c=>c===null));
});
test('native unavailable: explicit allowlisted code; no cookie access, raw errors discarded',async()=>{
  for(const code of ['NATIVE_HOST_NOT_FOUND','NATIVE_HOST_FORBIDDEN','NATIVE_HOST_EXITED','PRIVATE_SECRET']){
    const f=fixture();f.channel.exchange=async()=>{throw Object.assign(new Error('SYNTHETIC_PRIVATE'),{code});};
    const r=await f.run();assert.equal(r.stage,'NATIVE_CHANNEL');assert.equal(f.reads,0);
    assert.equal(r.code,code==='PRIVATE_SECRET'?'CHECK_FAILED':code);assert.ok(!JSON.stringify(r).includes('PRIVATE'));
  }
});
test('native malformed reply cannot turn diagnostic into hello/import or cookie read',async()=>{
  for(const reply of [{state:'NOT_CONFIRMED'}, {...nativePass,session:'PRIVATE'}, {...nativePass,import_calls:1}]){
    const f=fixture();f.channel.exchange=async()=>reply;
    const r=await f.run();assert.equal(r.code,'NATIVE_DIAGNOSTIC_REPLY_INVALID');assert.equal(f.reads,0);
  }
});
test('stage errors, tab/store scope and cancellation remain safe',async()=>{
  for(const [method,stage] of [['queryTabs','TAB'],['getStores','COOKIE_STORE'],['getCookies','COOKIE_READ']]){
    const f=fixture();f.api[method]=async()=>{throw new Error('PRIVATE_DATA');};
    assert.deepEqual(await f.run(),{stage,code:'CHECK_FAILED',import_calls:0});
  }
  const f=fixture();f.api.queryTabs=async()=>[{id:1,url:'https://yandex.ru/sprav/other',incognito:false}];
  assert.equal((await f.run()).code,'TAB_SCOPE_INVALID');assert.equal(f.reads,0);
  const g=fixture();g.api.getStores=async()=>[];assert.equal((await g.run()).code,'COOKIE_STORE_AMBIGUOUS');
  for(const stage of ['before','after_read']){
    let cancelled=stage==='before';const h=fixture();const original=h.api.getCookies;
    h.api.getCookies=async d=>{const b=await original(d);cancelled=true;return b;};
    assert.deepEqual(await h.run({cancelled:()=>cancelled}),{stage:'CANCELLED',code:'CANCELLED',import_calls:0});
    assert.equal(h.requests.length,stage==='before'?0:1);
    if(stage==='after_read')assert.ok(h.batch.every(c=>c===null));
  }
});
test('native lastError maps exact public message to constant only',async()=>{
  for(const [message,code] of [['Specified native messaging host not found.','NATIVE_HOST_NOT_FOUND'],['PRIVATE_DATA','NATIVE_DISCONNECTED']]){
    let disconnect;const runtime={id:EXTENSION_ID,lastError:{message},connectNative(){return {
      onDisconnect:{addListener(fn){disconnect=fn;}},onMessage:{addListener(){}},
      postMessage(){queueMicrotask(()=>disconnect());},disconnect(){}
    };}};
    const ch=nativeChannel(runtime);
    await assert.rejects(ch.exchange({version:1,op:'diagnose'}),{message:'IMPORT_NOT_CONFIRMED',code});ch.close();
  }
});
test('actual native host diagnostic exits without pipe listener, env, session or CLI',()=>{
  const env=Object.fromEntries(Object.entries(process.env).filter(([n])=>/^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|PATHEXT|USERPROFILE|LOCALAPPDATA|APPDATA)$/i.test(n)));
  const frame=m=>{const body=Buffer.from(JSON.stringify(m));const size=Buffer.alloc(4);size.writeUInt32LE(body.length);return Buffer.concat([size,body]);};
  for(const message of [{version:1,op:'diagnose'},{version:1,op:'diagnose',session:'SYNTHETIC_PRIVATE'}]){
    const r=spawnSync('pwsh',['-NoProfile','-NonInteractive','-File','scripts/yandex-native-host.ps1',`chrome-extension://${EXTENSION_ID}/`],{
      cwd:fileURLToPath(new URL('..',import.meta.url)),env,input:Buffer.concat([frame(message),frame({version:1,op:'import',session:'SYNTHETIC_PRIVATE'})]),timeout:8000
    });
    assert.equal(r.status,0);assert.equal(r.stderr.length,0);
    assert.ok(r.stdout.length>=4);assert.equal(r.stdout.readUInt32LE(),r.stdout.length-4);
    const result=JSON.parse(r.stdout.subarray(4));
    assert.deepEqual(result,Object.hasOwn(message,'session')?{ok:false,state:'NOT_CONFIRMED'}:nativePass);
    assert.ok(!r.stdout.includes(Buffer.from('SYNTHETIC')));
  }
});
test('diagnostic source has no credential property access, collectSession or import method',()=>{
  const source=readFileSync(new URL('../tools/yandex-cookie-metadata/diagnostics.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\.value\b|\[['"]value['"]\]|collectSession|connectBusiness|op:\s*['"](?:hello|import)['"]|JSON\.stringify|fetch\s*\(|console\./);
});
test('actual diagnostic button sends only diagnose and disables import for that popup',async()=>{
  const elements=new Map(['copy','diagnose','cancel','status'].map(id=>[id,{disabled:false,textContent:'',events:{},addEventListener(n,f){this.events[n]=f;}}]));
  const held={document:globalThis.document,window:globalThis.window,chrome:globalThis.chrome};const f=fixture();
  let receiver;const sent=[];
  try{
    globalThis.document={getElementById:id=>elements.get(id)};globalThis.window={addEventListener(){}};
    globalThis.chrome={tabs:{query:f.api.queryTabs},cookies:{getAll:f.api.getCookies,getAllCookieStores:f.api.getStores},runtime:{id:EXTENSION_ID,connectNative(){return {
      onMessage:{addListener(fn){receiver=fn;}},onDisconnect:{addListener(){}},disconnect(){},postMessage(m){sent.push(m);queueMicrotask(()=>receiver(nativePass));}
    };}}};
    await import('../tools/yandex-cookie-metadata/popup.js');
    assert.equal(sent.length,0);await elements.get('diagnose').events.click();await elements.get('copy').events.click();
    assert.deepEqual(sent,[{version:1,op:'diagnose'}]);assert.ok(elements.get('copy').disabled);
    assert.equal(elements.get('status').textContent,'diagnostic stage = METADATA_ONLY\ndiagnostic code = PASS_VALUES_NOT_CHECKED\nimport calls = 0');
  }finally{for(const n of Object.keys(held)){if(held[n]===undefined)delete globalThis[n];else globalThis[n]=held[n];}}
});
