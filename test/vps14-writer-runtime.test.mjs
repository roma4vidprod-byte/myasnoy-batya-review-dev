import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runtimeGate,runVpsReplyRuntime} from '../tools/vps14/writer-runtime.mjs';
const base={RA_RUNTIME_PROFILE:'vps-lab',RA_YANDEX_MODE:'reply-write-one-shot',
  RA_YANDEX_REPLY_WRITE_ENABLED:'false'};
const names=[...Object.keys(base),'VERCEL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SECRET_KEY','SUPABASE_ANON_KEY','YANDEX_SESSION_KEYS_JSON',
  'YANDEX_SESSION_ACTIVE_KID','REVIEW_WORKER_SECRET'];
async function withEnv(changes,fn){
  const saved=Object.fromEntries(names.map(k=>[k,process.env[k]]));
  for(const k of names)delete process.env[k];
  Object.assign(process.env,base,changes);
  try{return await fn();}finally{
    for(const k of names)if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];
  }
}
const cli=fileURLToPath(new URL('../tools/vps14/writer-once.mjs',import.meta.url));
const noNetwork=new URL('./support/no-network.mjs',import.meta.url).href;
const unit=readFileSync(new URL('../tools/vps14/review-activator-reply.service',import.meta.url),'utf8');
const config=readFileSync(new URL('../tools/vps14/writer-disabled.env',import.meta.url),'utf8');
const source=readFileSync(new URL('../tools/vps14/writer-runtime.mjs',import.meta.url),'utf8');

test('stage5 exact false or missing write flag is DISABLED',()=>{
  assert.equal(runtimeGate(base),'DISABLED');
  const missing={...base};delete missing.RA_YANDEX_REPLY_WRITE_ENABLED;
  assert.equal(runtimeGate(missing),'DISABLED');
});
test('stage5 malformed flags never authorize writing',()=>{
  for(const flag of ['TRUE','1','yes','true ',' false',''])
    assert.equal(runtimeGate({...base,RA_YANDEX_REPLY_WRITE_ENABLED:flag}),'REPLY_RUNTIME_FLAG_INVALID');
});
test('stage5 read mode cannot become writer by setting a flag',()=>{
  assert.equal(runtimeGate({...base,RA_YANDEX_MODE:'read-only-admin',RA_YANDEX_REPLY_WRITE_ENABLED:'true'}),
    'REPLY_RUNTIME_MODE_DENIED');
});
test('stage5 Cloud presence and wrong profile fail before work',()=>{
  for(const name of names.filter(n=>!Object.hasOwn(base,n)))
    assert.equal(runtimeGate({...base,[name]:'synthetic'}),'REPLY_RUNTIME_PROFILE_DENIED');
  assert.equal(runtimeGate({...base,RA_RUNTIME_PROFILE:'cloud-dev'}),'REPLY_RUNTIME_PROFILE_DENIED');
});
test('stage5 disabled composition touches neither store nor session nor CSRF',()=>withEnv({},async()=>{
  let calls=0;const forbidden=()=>{calls++;throw Error('SHOULD_NOT_RUN');};
  const result=await runVpsReplyRuntime({createStore:forbidden,getSession:forbidden,resolveCsrf:forbidden});
  assert.equal(calls,0);assert.equal(result.status,'DISABLED');assert.equal(result.claimed,false);
  for(const k of ['storageCalls','sessionReads','providerRequests','providerWrites'])assert.equal(result[k],0);
}));
test('stage5 true flag without CSRF channel blocks before store or session',()=>
  withEnv({RA_YANDEX_REPLY_WRITE_ENABLED:'true'},async()=>{
    let calls=0;const forbidden=()=>{calls++;throw Error('SHOULD_NOT_RUN');};
    const result=await runVpsReplyRuntime({createStore:forbidden,getSession:forbidden});
    assert.equal(result.code,'YANDEX_REPLY_CSRF_BOOTSTRAP_UNPROVEN');
    assert.equal(result.status,'BLOCKED');assert.equal(result.claimed,false);assert.equal(calls,0);
  }));
test('stage5 missing session adapter blocks before claim even with synthetic resolver',()=>
  withEnv({RA_YANDEX_REPLY_WRITE_ENABLED:'true'},async()=>{
    let calls=0;
    const result=await runVpsReplyRuntime({resolveCsrf:()=>{calls++;},createStore:()=>{calls++;}});
    assert.equal(result.code,'REPLY_RUNTIME_SESSION_ADAPTER_MISSING');assert.equal(calls,0);
  }));
function child(changes={},args=[]){
  const env={...process.env};for(const k of names)delete env[k];
  delete env.NODE_OPTIONS;delete env.NODE_PATH;
  Object.assign(env,base,changes);
  return spawnSync(process.execPath,['--import',noNetwork,cli,...args],
    {env,encoding:'utf8',timeout:10000,windowsHide:true});
}
test('stage5 real entrypoint starts with WRITE OFF and safe JSON only',()=>{
  const p=child();assert.equal(p.status,0,p.stderr);
  const value=JSON.parse(p.stdout);assert.equal(value.code,'WRITE_OFF');
  assert.equal(value.providerWrites,0);assert.equal(value.storageCalls,0);
  assert.equal(value.csrfResolver,'NOT_CONNECTED');assert.equal(p.stderr,'');
});
test('stage5 entrypoint cannot enable write merely with env flag',()=>{
  const p=child({RA_YANDEX_REPLY_WRITE_ENABLED:'true'});assert.equal(p.status,78);
  const value=JSON.parse(p.stdout);assert.equal(value.code,'YANDEX_REPLY_CSRF_BOOTSTRAP_UNPROVEN');
  assert.equal(value.storageCalls,0);assert.equal(value.providerRequests,0);assert.equal(value.providerWrites,0);
});
test('stage5 CLI denies supplied arguments without reflecting them',()=>{
  const marker='SYNTHETIC_MUST_NOT_REFLECT';const p=child({},[marker]);assert.equal(p.status,64);
  assert.equal(JSON.parse(p.stdout).code,'REPLY_RUNTIME_ARGUMENTS_DENIED');
  assert.equal((p.stdout+p.stderr).includes(marker),false);
});
test('stage5 service is manual one-shot with OS network isolation and least privilege',()=>{
  for(const line of ['Type=oneshot','User=review-yandex-writer','Group=review-yandex-writer',
    'Restart=no','PrivateNetwork=yes','RestrictAddressFamilies=AF_UNIX','ProtectSystem=strict',
    'NoNewPrivileges=yes','CapabilityBoundingSet=','ProtectHome=yes','LimitCORE=0'])
    assert.ok(unit.split(/\r?\n/).includes(line),line);
  assert.doesNotMatch(unit,/^\[Install\]|^WantedBy=|^Wants=|^OnCalendar=/m);
  assert.match(unit,/^EnvironmentFile=\/etc\/review-activator-reply\/writer.env$/m);
  assert.match(unit,/^InaccessiblePaths=.*\/etc\/review-activator-yandex/m);
});
test('stage5 source reuses existing worker store and transport without credential bootstrap',()=>{
  assert.ok(source.includes('runYandexReplyOnce'));
  assert.ok(source.includes('createReplyWorkerStore'));
  assert.ok(source.includes('createYandexReplyTransport'));
  assert.ok(source.indexOf("typeof resolveCsrf!=='function'")<source.indexOf('const store=createStore()'));
  assert.doesNotMatch(source,/\bfetch\s*\(|keyringFromEnv|readFileSync|setInterval|listen\s*\(/);
  assert.match(config,/^RA_YANDEX_REPLY_WRITE_ENABLED=false$/m);
  assert.doesNotMatch(config,/SUPABASE|SECRET|PASSWORD|TOKEN|COOKIE/);
});
