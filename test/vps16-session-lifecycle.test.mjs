import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {summarizeSessionLifecycle} from '../tools/yandex-server-browser/session-lifecycle-snapshot.mjs';
import {LIFECYCLE_ACTIONS,assertSafeTelemetry,classifyLifecycle,runLifecycle}
  from '../tools/vps16/session-lifecycle-manager.mjs';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const now=2_000_000_000_000;
const iso=ms=>new Date(ms).toISOString();
const snapshot=(overrides={})=>({
  ok:true,operation:'session_lifecycle_snapshot',state:'SESSION_READY',
  organization_id:'54309413522',session_revision:6,credential_version_present:true,
  cookie_count:3,persistent_cookie_count:2,session_cookie_count:1,
  min_cookie_ttl_seconds:400000,max_cookie_ttl_seconds:800000,
  expiring_within_6h:0,expiring_within_72h:0,rotation_state:'CURRENT',
  last_session_check_age_seconds:120,last_successful_sync_age_seconds:600,
  provider_requests:0,provider_writes:0,...overrides
});
const csrf=(revision=6)=>({
  ok:true,mode:'readiness',state:'SERVER_CSRF_READY',organization_id:'54309413522',
  session_revision:revision,browser_provider_requests:1,writer_provider_requests:0,
  provider_writes:0,queue_claims:0,action_binding:true,session_match:true,profile_persistent:false
});
const read=(revision=6)=>({
  ok:true,operation:'server_browser_read',state:'BROWSER_READY',organization_id:'54309413522',
  session_revision:revision,provider_requests:1,provider_writes:0,reply_endpoint_attempts:0,
  profile_persistent:false,sandbox_disabled:false
});

test('Stage16 session snapshot emits TTL aggregates only and no cookie secrets',()=>{
  const value=summarizeSessionLifecycle({
    nowMs:now,
    stored:{state:'READY',revision:6,credential_version:'secret-version',
      last_session_check_at:iso(now-60_000),last_successful_sync_at:iso(now-120_000)},
    session:{cookies:[
      {name:'Session_id',value:'secret-a',expires:now/1000+3600},
      {name:'yandexuid',value:'secret-b',expires:null}
    ]}
  });
  assert.equal(value.rotation_state,'DUE');
  assert.equal(value.cookie_count,2);
  assert.equal(value.min_cookie_ttl_seconds,3600);
  assert.equal(value.provider_requests,0);
  assert.equal(value.provider_writes,0);
  const json=JSON.stringify(value);
  assert.doesNotMatch(json,/Session_id|yandexuid|secret-a|secret-b|secret-version/);
});

test('Stage16 snapshot classification is deterministic and network-off',()=>{
  const value=classifyLifecycle({mode:'snapshot',snapshot:snapshot()});
  assert.equal(value.state,'MONITORING');
  assert.equal(value.ready,null);
  assert.deepEqual(value.chain,{auth:'NOT_CHECKED',session:'SESSION_READY',csrf:'NOT_CHECKED',read:'NOT_CHECKED'});
  assert.equal(value.provider_requests,0);
  assert.equal(value.provider_writes,0);
  assert.deepEqual(value.allowed_action_ids,[]);
});

test('Stage16 stale snapshot requests readiness without executing recovery',()=>{
  const value=classifyLifecycle({mode:'snapshot',snapshot:snapshot({last_successful_sync_age_seconds:20000})});
  assert.equal(value.state,'READINESS_DUE');
  assert.deepEqual(value.allowed_action_ids,['RUN_READINESS']);
});

test('Stage16 expiry marks rotation due but never auto-rotates',()=>{
  const value=classifyLifecycle({mode:'snapshot',snapshot:snapshot({rotation_state:'DUE',min_cookie_ttl_seconds:100})});
  assert.equal(value.state,'ROTATION_DUE');
  assert.deepEqual(value.allowed_action_ids,['ROTATE_SESSION']);
  assert.equal(LIFECYCLE_ACTIONS.ROTATE_SESSION.automatic,false);
  assert.equal(LIFECYCLE_ACTIONS.ROTATE_SESSION.provider_write,false);
});

test('Stage16 readiness proves AUTH SESSION CSRF READ with exactly two GETs and zero writes',()=>{
  const value=classifyLifecycle({mode:'readiness',snapshot:snapshot(),csrf:csrf(),read:read()});
  assert.equal(value.state,'READY');
  assert.equal(value.ready,true);
  assert.deepEqual(value.chain,{auth:'AUTH_OK',session:'SESSION_READY',csrf:'CSRF_READY',read:'READ_OK'});
  assert.equal(value.provider_requests,2);
  assert.equal(value.provider_writes,0);
  assert.equal(value.queue_claims,0);
});

test('Stage16 readiness rejects session revision race',()=>{
  assert.throws(()=>classifyLifecycle({mode:'readiness',snapshot:snapshot(),csrf:csrf(6),read:read(7)}),
    error=>error?.code==='LIFECYCLE_SESSION_CHANGED');
});

test('Stage16 telemetry boundary rejects secret-bearing keys',()=>{
  assert.throws(()=>assertSafeTelemetry({ok:true,csrf_token:'secret'}),error=>error?.code==='LIFECYCLE_TELEMETRY_UNSAFE');
  assert.throws(()=>assertSafeTelemetry({cookie_value:'secret'}),error=>error?.code==='LIFECYCLE_TELEMETRY_UNSAFE');
  assert.doesNotThrow(()=>assertSafeTelemetry(snapshot()));
});

test('Stage16 injected lifecycle runner persists only the safe final telemetry',async()=>{
  let calls=0,persisted=null;
  const value=await runLifecycle('readiness',{
    snapshot:async()=>{calls++;return snapshot();},
    csrf:async()=>{calls++;return csrf();},
    read:async()=>{calls++;return read();},
    persist:v=>{persisted=v;}
  });
  assert.equal(calls,3);
  assert.equal(value.state,'READY');
  assert.equal(persisted,value);
  assert.equal(JSON.stringify(value).includes('secret'),false);
});

test('Stage16 action catalog contains no provider-write or automatic executor',()=>{
  assert.deepEqual(Object.keys(LIFECYCLE_ACTIONS).sort(),
    ['CONTRACT_DIAGNOSTIC','OPERATOR_REAUTH','ROTATE_SESSION','RUN_READINESS']);
  for(const action of Object.values(LIFECYCLE_ACTIONS)){
    assert.equal(action.provider_write,false);
    assert.equal(action.automatic,false);
  }
});

test('Stage16 source keeps timer snapshot network-off and deep readiness read-only',async()=>{
  const manager=await readFile(join(root,'tools/vps16/session-lifecycle-manager.mjs'),'utf8');
  const snapshotSource=await readFile(join(root,'tools/yandex-server-browser/session-lifecycle-snapshot.mjs'),'utf8');
  const service=await readFile(join(root,'tools/vps16/review-yandex-lifecycle.service'),'utf8');
  const timer=await readFile(join(root,'tools/vps16/review-yandex-lifecycle.timer'),'utf8');
  assert.match(manager,/PrivateNetwork=yes/);
  assert.match(manager,/"mode":"readiness"/);
  assert.doesNotMatch(manager,/"mode":"execute"/);
  assert.doesNotMatch(manager,/RA_YANDEX_REPLY_WRITE_ENABLED=true/);
  assert.doesNotMatch(snapshotSource,/fetch\s*\(|https:\/\//);
  assert.match(service,/RA_STAGE16_MODE=snapshot/);
  assert.match(service,/RestrictAddressFamilies=AF_UNIX/);
  assert.match(timer,/OnUnitActiveSec=15min/);
});

test('Stage16 timer service is one-shot, hardened and not a write service',async()=>{
  const service=await readFile(join(root,'tools/vps16/review-yandex-lifecycle.service'),'utf8');
  assert.match(service,/Type=oneshot/);
  assert.match(service,/NoNewPrivileges=yes/);
  assert.match(service,/ProtectSystem=strict/);
  assert.match(service,/CapabilityBoundingSet=\s*\n/);
  assert.doesNotMatch(service,/RA_YANDEX_REPLY_WRITE_ENABLED/);
  assert.doesNotMatch(service,/Restart=always|Restart=on-failure/);
});
