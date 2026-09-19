import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {once} from 'node:events';
import http from 'node:http';
import {readFileSync} from 'node:fs';
import {runtimeProfile,requireCloudProfile,CLOUD_DEV} from '../lib/server/runtime-profile.js';
import {readLabConfig} from '../lib/server/vps/lab-config.js';
import {labReadiness,createLabServer} from '../lib/server/vps/lab.js';

const privateJwk=generateKeyPairSync('ec',{namedCurve:'P-256'}).privateKey.export({format:'jwk'});
Object.assign(privateJwk,{kid:'synthetic',alg:'ES256'});
const {d,...publicJwk}=privateJwk;
const issue=c=>{const h=Buffer.from(JSON.stringify({alg:'ES256',kid:'synthetic'})).toString('base64url'),b=Buffer.from(JSON.stringify(c)).toString('base64url');return h+'.'+b+'.'+sign('sha256',Buffer.from(h+'.'+b),{key:privateJwk,format:'jwk',dsaEncoding:'ieee-p1363'}).toString('base64url');};
const claims={iss:'http://127.0.0.1:13000/auth/v1',aud:'authenticated',role:'anon',exp:Date.now()/1000+3600};
const env=()=>({RA_RUNTIME_PROFILE:'vps-lab',RA_VPS_PROFILE:'vps-lab',RA_LAB_ORIGIN:'http://127.0.0.1:13000',RA_LAB_ISSUER:claims.iss,RA_LAB_ANON_TOKEN:issue(claims),RA_LAB_PUBLIC_JWK:JSON.stringify(publicJwk)});
const response=data=>({ok:true,status:200,json:async()=>data,text:async()=>JSON.stringify(data)});
const readyFetch=async url=>url.endsWith('/health')?response({version:'v2.196.0'}):url.endsWith('/jwks.json')?response({keys:[publicJwk]}):response({profile:'vps-lab',database:'review_activator_lab',version:'vps04-auth-api-v1',auth_schema:true});

test('VPS04 cloud default unchanged and lab explicit; unknown profile never falls back',()=>{
  assert.deepEqual(runtimeProfile({}),CLOUD_DEV);assert.equal(runtimeProfile(env()).profile,'vps-lab');
  for(const p of ['','foundation','prod','vps'])assert.throws(()=>runtimeProfile({RA_RUNTIME_PROFILE:p}));
});
test('VPS04 LAB refuses cloud URL, credentials, Vercel and wrong issuer',()=>{
  for(const override of [{RA_LAB_ORIGIN:CLOUD_DEV.url},{RA_LAB_ISSUER:CLOUD_DEV.url},{SUPABASE_URL:CLOUD_DEV.url},{SUPABASE_SERVICE_ROLE_KEY:'synthetic'},{YANDEX_SESSION_KEYS_JSON:'synthetic'},{VERCEL:'1'},{GOTRUE_JWT_SECRET:'synthetic'},{RA_LAB_PRIVATE_JWK:'synthetic'}])assert.throws(()=>readLabConfig({...env(),...override}));
});
test('VPS04 LAB config accepts verified public-only JWT, cannot hold signing material',()=>{
  const c=readLabConfig(env());assert.equal(c.profile,'vps-lab');assert.equal(c.host,'127.0.0.1');assert.equal(c.jwk.d,undefined);
  assert.throws(()=>readLabConfig({...env(),RA_LAB_PUBLIC_JWK:JSON.stringify(privateJwk)}));
});
for(const [name,value] of [['issuer',{iss:'https://cloud.invalid'}],['audience',{aud:'other'}],['role',{role:'service_role'}],['expiry',{exp:1}]])test('VPS04 config rejects '+name,()=>assert.throws(()=>readLabConfig({...env(),RA_LAB_ANON_TOKEN:issue({...claims,...value})})));
test('VPS04 config rejects modified signature and key pair',()=>{
  const e=env(),t=e.RA_LAB_ANON_TOKEN.split('.');t[2]=(t[2][0]==='a'?'b':'a')+t[2].slice(1);
  assert.throws(()=>readLabConfig({...e,RA_LAB_ANON_TOKEN:t.join('.')}));
  const other=generateKeyPairSync('ec',{namedCurve:'P-256'}).publicKey.export({format:'jwk'});
  assert.throws(()=>readLabConfig({...e,RA_LAB_PUBLIC_JWK:JSON.stringify({...publicJwk,...other})}));
});
test('VPS04 Cloud provider/crypto boundary remains closed in LAB',()=>{
  assert.throws(()=>requireCloudProfile(env()),/PROVIDER_DISABLED_IN_VPS_LAB/);assert.doesNotThrow(()=>requireCloudProfile({}));
  const crypto=readFileSync(new URL('../lib/server/yandex-session/crypto.js',import.meta.url),'utf8');
  assert.ok(crypto.includes("['ykiubttldgyjpajmsuas', 'yandex', ...Object.values(scopeOf(scope)), ACCOUNT, version]"));
});
test('VPS04 ready only with official Auth, matching JWK, API/DB migration version',async()=>{
  assert.equal((await labReadiness(readLabConfig(env()),readyFetch)).ok,true);
});
for(const stage of ['auth','api','key','migration','database'])test('VPS04 fail closed dependency '+stage,async()=>{
  const c=readLabConfig(env());const urls=[];
  const f=async url=>{urls.push(url);if((stage==='auth'&&url.endsWith('/health'))||(stage==='api'&&url.includes('/rpc/')))throw new Error('SECRET_CANARY');
    if(stage==='key'&&url.endsWith('/jwks.json'))return response({keys:[]});
    if(stage==='migration'&&url.includes('/rpc/'))return response({profile:'vps-lab',database:'review_activator_lab',version:'wrong',auth_schema:true});
    if(stage==='database'&&url.includes('/rpc/'))return response({profile:'vps-lab',database:'wrong',version:'vps04-auth-api-v1',auth_schema:true});return readyFetch(url);};
  const r=await labReadiness(c,f);assert.equal(r.ok,false);assert.equal(JSON.stringify(r).includes('CANARY'),false);assert.ok(urls.every(u=>u.startsWith('http://127.0.0.1:')));
});
async function request(app,path,body={},headers={}){return new Promise((resolve,reject)=>{
  const r=http.request({host:'127.0.0.1',port:app.server.address().port,path,method:'POST',headers:{'Content-Type':'application/json',...headers}},s=>{let data='';s.on('data',b=>data+=b);s.on('end',()=>resolve({status:s.statusCode,data:JSON.parse(data)}));});r.on('error',reject);r.end(JSON.stringify(body));
});}
test('VPS04 adapter denies all external action routes before dependency calls',async t=>{
  let calls=0;const app=createLabServer({config:readLabConfig(env()),fetchImpl:async()=>{calls++;throw Error();}});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>app.stop());
  for(const path of ['/api/internal/review-sync-worker','/api/cron/review-sync','/api/feedback','/api/reward-request','/api/promo-import','/api/admin-review-reply-draft','/auth/v1/otp','/auth/v1/recover','/auth/v1/admin/users'])assert.ok([404,503].includes((await request(app,path)).status));
  assert.equal(calls,0);
});
test('VPS04 proxy forwards JWT only; rejects identity headers/Origin and limits paths',async t=>{
  const sent=[],logs=[];const app=createLabServer({config:readLabConfig(env()),logger:l=>logs.push(l),fetchImpl:async(...a)=>{sent.push(a);return response([]);}});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');t.after(()=>app.stop());
  assert.equal((await request(app,'/rest/v1/rpc/review_admin_profile',{}, {'x-role':'service_role'})).status,403);
  assert.equal((await request(app,'/rest/v1/rpc/review_admin_profile',{}, {Origin:'https://evil.invalid'})).status,403);
  assert.equal(sent.length,0);
  assert.equal((await request(app,'/rest/v1/rpc/review_admin_profile',{}, {Authorization:'Bearer synthetic.SECRET_CANARY.jwt',Cookie:'SECRET_CANARY',apikey:'SECRET_CANARY'})).status,200);
  assert.deepEqual(Object.keys(sent[0][1].headers).sort(),['Authorization','Content-Type']);assert.equal(sent[0][1].redirect,'error');
  assert.equal(JSON.stringify(logs).includes('SECRET_CANARY'),false);
});
test('VPS04 LAB SQL denies broad privileges and scopes the existing RPC',()=>{
  const sql=readFileSync(new URL('../tools/vps04/lab-policy.sql',import.meta.url),'utf8');
  assert.match(sql,/revoke all on all functions in schema public/);assert.match(sql,/m.user_id=auth.uid\(\) and m.company_id=p_company/);
  assert.match(sql,/create policy vps04_company_admin_read/);assert.match(sql,/LAB_ISSUER_INVALID/);
  const bootstrap=readFileSync(new URL('../tools/vps04/schema-api.mjs',import.meta.url),'utf8');assert.match(bootstrap,/COMPANY_ACCESS_DENIED/);assert.match(bootstrap,/baseline.*71aa35/s);
});
test('VPS04 frontend explicit LAB config cannot fallback to Cloud or claim owner',()=>{
  const text=readFileSync(new URL('../admin.html',import.meta.url),'utf8');
  assert.match(text,/AUTH_PROFILE_REQUIRED/);assert.match(text,/isLab\?runtime.url:SUPABASE_URL/);assert.match(text,/if\(!isLab\)await client.rpc\('review_claim_initial_owner'\)/);assert.match(text,/LAB_EMAIL_FLOW_DISABLED/);
});
