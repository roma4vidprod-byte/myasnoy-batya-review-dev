import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PassThrough} from 'node:stream';
import {createCdpPipe} from '../tools/yandex-server-browser/chrome-pipe.mjs';
import {createBrowserSessionAdapter} from '../tools/yandex-server-browser/browser-session-adapter.mjs';
import {encryptSession} from '../lib/server/yandex-session/crypto.js';
import {createVpsSessionContext,VPS_SESSION_SCOPE} from '../lib/server/yandex-session/profile-context.js';

const browser=readFileSync(new URL('../tools/yandex-server-browser/browser-read.mjs',import.meta.url),'utf8');
const store=readFileSync(new URL('../tools/yandex-server-browser/browser-session-store.mjs',import.meta.url),'utf8');
const unit=readFileSync(new URL('../tools/yandex-server-browser/review-yandex-browser.service',import.meta.url),'utf8');
const sql=readFileSync(new URL('../tools/yandex-server-browser/browser-access.sql',import.meta.url),'utf8');

test('Stage13 CDP uses pipe framing and no TCP debugger',async()=>{
  const input=new PassThrough(),output=new PassThrough();let event=null;
  let written=Buffer.alloc(0);input.on('data',b=>written=Buffer.concat([written,b]));
  const cdp=createCdpPipe({input,output,onEvent:e=>{event=e;}});
  const promise=cdp.send('Browser.getVersion');
  await new Promise(r=>setTimeout(r,5));
  assert.equal(written.at(-1),0);
  const request=JSON.parse(written.subarray(0,written.length-1).toString('utf8'));
  assert.equal(request.method,'Browser.getVersion');
  output.write(Buffer.from(JSON.stringify({id:request.id,result:{product:'Chrome/1'}})+'\0'));
  assert.equal((await promise).product,'Chrome/1');
  output.write(Buffer.from(JSON.stringify({method:'Synthetic.event',params:{ok:true}})+'\0'));
  await new Promise(r=>setTimeout(r,5));assert.equal(event.method,'Synthetic.event');cdp.close();
});

test('Stage13 browser session adapter decrypts READY session and drops expired request cookies',async()=>{
  const priorProfile=process.env.RA_RUNTIME_PROFILE,priorMode=process.env.RA_YANDEX_MODE,priorWrite=process.env.RA_YANDEX_REPLY_WRITE_ENABLED;
  process.env.RA_RUNTIME_PROFILE='vps-lab';process.env.RA_YANDEX_MODE='read-only-admin';delete process.env.RA_YANDEX_REPLY_WRITE_ENABLED;
  try{
    const context=createVpsSessionContext();
    const key=Buffer.alloc(32,7),ring={currentKid:'vps-yandex-0123456789abcdef',keys:{'vps-yandex-0123456789abcdef':key}};
    const now=2_000_000_000_000;
    const material={account:'myasnoibatya-zakaz',cookies:[
      {name:'alive',value:'alive-secret',domain:'.yandex.ru',path:'/',secure:true,httpOnly:true,expires:now/1000+3600},
      {name:'expired',value:'expired-secret',domain:'.yandex.ru',path:'/',secure:true,httpOnly:true,expires:now/1000-1}
    ]};
    const envelope=encryptSession(VPS_SESSION_SCOPE,material,ring,now-10_000,context);
    const stored={...envelope,state:'READY',revision:6};
    const adapter=createBrowserSessionAdapter({
      store:{readSession:async()=>stored},context,now:()=>now,
      loadKeyring:()=>({currentKid:ring.currentKid,keys:{[ring.currentKid]:Buffer.from(key)}})
    });
    const opened=await adapter();
    assert.equal(opened.stored.revision,6);assert.deepEqual(opened.session.cookies.map(c=>c.name),['alive']);
    opened.session.cookies[0].value='';
  }finally{
    if(priorProfile===undefined)delete process.env.RA_RUNTIME_PROFILE;else process.env.RA_RUNTIME_PROFILE=priorProfile;
    if(priorMode===undefined)delete process.env.RA_YANDEX_MODE;else process.env.RA_YANDEX_MODE=priorMode;
    if(priorWrite===undefined)delete process.env.RA_YANDEX_REPLY_WRITE_ENABLED;else process.env.RA_YANDEX_REPLY_WRITE_ENABLED=priorWrite;
  }
});

test('Stage13 browser source is exact GET-only and blocks reply endpoint',()=>{
  assert.match(browser,/method==='GET'&&url===targetUrl/);
  assert.match(browser,/Fetch\.failRequest/);
  assert.match(browser,/business-answer/);
  assert.match(browser,/provider_writes:0/);
  assert.match(browser,/profile_persistent:false/);
  assert.match(browser,/sandbox_disabled:false/);
  assert.doesNotMatch(browser,/method\s*:\s*['"]POST['"]/);
  assert.doesNotMatch(browser,/--no-sandbox|remote-debugging-port/);
  assert.doesNotMatch(browser,/reply_worker_claim_next|reply_worker_finish|allowWrite/);
});

test('Stage13 browser DB role can only call read-only session RPC',()=>{
  for(const value of [
    'review-yandex-browser','browser_session_read()','BROWSER_ROLE_DENIED',
    "'54309413522','read',null",'SESSION_NOT_READY'
  ])assert.ok(sql.includes(value),value);
  assert.match(sql,/revoke all on all tables in schema public,review_private,vps_yandex_private/);
  assert.match(sql,/grant execute on function vps_yandex_private\.browser_session_read\(\)/);
  assert.doesNotMatch(sql,/reply_worker_claim_next|reply_worker_finish|business-answer/);
  assert.match(store,/select vps_yandex_private\.browser_session_read\(\)/);
  assert.doesNotMatch(store,/claim|finish|insert|update|delete/i);
});

test('Stage13 systemd unit is manual, credentialed, ephemeral and hardened',()=>{
  for(const value of [
    'Type=oneshot','User=review-yandex-browser','Group=review-yandex-browser',
    'LoadCredential=yandex-session-key:/etc/review-activator-yandex/session-key.json',
    'RuntimeDirectory=review-yandex-browser','RuntimeDirectoryPreserve=no',
    'NoNewPrivileges=yes','ProtectSystem=strict','ProtectHome=yes',
    'PrivateDevices=yes','Restart=no'
  ])assert.ok(unit.includes(value),value);
  assert.equal(unit.includes('[Install]'),false);
  assert.doesNotMatch(unit,/OnCalendar|\.timer|\.socket/);
});
