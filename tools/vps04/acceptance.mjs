// Actual loopback HTTP tests, no Cloud/provider clients. Secret material stays in memory.
import {ROOT,ETC,ISSUER,run,sql,token,secretFile} from './bootstrap.mjs';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

const state=JSON.parse(readFileSync(ETC+'/bootstrap.json','utf8'));
const companies=['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002'];
const locations=['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002'];
const api=process.argv.includes('--node')?'http://127.0.0.1:13000/rest/v1':'http://127.0.0.1:13001';
const auth=process.argv.includes('--node')?'http://127.0.0.1:13000/auth/v1':'http://127.0.0.1:19999';
let users;
const reports={auth:[],api:[],rls:[]};
async function http(base,path,body,bearer,headers={},method=body===undefined?'GET':'POST') {
  assert.ok(['http://127.0.0.1:13001','http://127.0.0.1:19999','http://127.0.0.1:13000/rest/v1','http://127.0.0.1:13000/auth/v1'].includes(base));
  const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(bearer?{Authorization:'Bearer '+bearer}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(5000)});
  let bodyResult;try {bodyResult=await r.json();}catch {bodyResult=null;}
  return {status:r.status,data:bodyResult};
}
async function check(group,name,fn) {
  try {await fn();reports[group].push({name,result:'PASS'});}
  catch {reports[group].push({name,result:'FAIL'});}
}
const scoped=i=>({p_company_id:companies[i],p_location_id:locations[i],p_external_location_id:'lab-org-'+(i?'b':'a'),p_provider:'yandex'});
const rpc=(name,body,bearer,headers)=>http(api,'/rpc/'+name,body,bearer,headers);
const deny=r=>assert.ok([400,401,403,404].includes(r.status));
let stage='START';
try {
  assert.equal(process.getuid(),0);assert.equal(run('hostname',[]).trim(),'hiplet-120706');
  if(process.argv.includes('--seed')) {
    stage='SYNTHETIC_USERS';assert.equal(existsSync(ETC+'/synthetic-users.json'),false);
    users=[];
    for(const [i,name] of ['owner','nonadmin','company-b'].entries()) {
      const user={email:`${name}@vps04.invalid`,password:randomBytes(24).toString('base64url'),name};
      const result=await http('http://127.0.0.1:19999','/admin/users',{...user,name:undefined,email_confirm:true},state.service);
      assert.equal(result.status,200);assert.match(result.data.id,/^[0-9a-f-]{36}$/);
      user.id=result.data.id;users.push(user);
    }
    secretFile('synthetic-users.json',JSON.stringify(users));
    stage='SYNTHETIC_APP_ROWS';
    sql(`begin;
      insert into public.review_companies(id,slug,name) values('${companies[0]}','vps04-a','Synthetic A'),('${companies[1]}','vps04-b','Synthetic B');
      insert into public.review_locations(id,company_id,name,city,address) values('${locations[0]}','${companies[0]}','LAB A','Synthetic','No real address'),('${locations[1]}','${companies[1]}','LAB B','Synthetic','No real address');
      insert into public.review_admins(user_id,email,role,active) values('${users[0].id}','owner@vps04.invalid','owner',true),('${users[2].id}','company-b@vps04.invalid','admin',true);
      insert into vps_lab_private.memberships values('${users[0].id}','${companies[0]}'),('${users[2].id}','${companies[1]}');
      insert into public.review_external_reviews(company_id,location_id,provider,external_location_id,external_review_id,author_name,rating,review_text,published_at,observed_at) values
      ('${companies[0]}','${locations[0]}','yandex','lab-org-a','synthetic-a','Synthetic',5,'Synthetic fixture only','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
      ('${companies[1]}','${locations[1]}','yandex','lab-org-b','synthetic-b','Synthetic',2,'Synthetic fixture only','2026-01-02T00:00:00Z','2026-01-02T00:00:00Z');
      commit;`);
  }else {users=JSON.parse(readFileSync(ETC+'/synthetic-users.json','utf8'));}
  stage='HTTP_GATES';
  const sessions=[];
  for(const user of users) {
    await check('auth','password_login_'+user.name,async()=>{
      const r=await http(auth,'/token?grant_type=password',{email:user.email,password:user.password});
      assert.equal(r.status,200);assert.equal(r.data.user.id,user.id);assert.equal(r.data.token_type,'bearer');
      const claims=JSON.parse(Buffer.from(r.data.access_token.split('.')[1],'base64url').toString());
      assert.equal(claims.iss,ISSUER);assert.equal(claims.aud,'authenticated');assert.equal(claims.role,'authenticated');
      sessions.push(r.data);
    });
  }
  assert.equal(sessions.length,3);
  await check('auth','refresh_real_auth_token',async()=>{
    const r=await http(auth,'/token?grant_type=refresh_token',{refresh_token:sessions[0].refresh_token});
    assert.equal(r.status,200);assert.equal(r.data.user.id,users[0].id);sessions[0]=r.data;
  });
  await check('auth','get_user_verified',async()=>{const r=await http(auth,'/user',undefined,sessions[0].access_token);assert.equal(r.status,200);assert.equal(r.data.id,users[0].id);});
  await check('auth','wrong_password_denied',async()=>{deny(await http(auth,'/token?grant_type=password',{email:users[0].email,password:'synthetic-not-correct'}));});
  const now=Math.floor(Date.now()/1000),claims={iss:ISSUER,aud:'authenticated',sub:users[0].id,role:'authenticated',iat:now,exp:now+60};
  for(const [name,change] of [['expired',{exp:now-60}],['issuer',{iss:'http://wrong.invalid/auth/v1'}],['audience',{aud:'wrong'}],['role',{role:'postgres'}]]) {
    await check('api','jwt_'+name+'_denied',async()=>{deny(await rpc('review_admin_profile',{},token(state.jwk,{...claims,...change})));});
  }
  await check('api','modified_signature_denied',async()=>{const t=sessions[0].access_token.split('.');t[2]=(t[2][0]==='a'?'b':'a')+t[2].slice(1);deny(await rpc('review_admin_profile',{},t.join('.')));});
  await check('api','wrong_key_pair_denied',async()=>{const {generateKeyPairSync}=await import('node:crypto');const jwk=generateKeyPairSync('ec',{namedCurve:'P-256'}).privateKey.export({format:'jwk'});jwk.kid=state.jwk.kid;deny(await rpc('review_admin_profile',{},token(jwk,claims)));});
  await check('api','anon_public_rpc',async()=>{const r=await rpc('review_public_sync_status',{p_token:'vps04-no-match'},state.anon);assert.equal(r.status,200);assert.deepEqual(r.data,[]);});
  await check('api','service_role_readiness_only',async()=>{assert.equal((await rpc('vps_lab_readiness',{},state.service)).status,200);deny(await rpc('review_enqueue_due_syncs',{p_company_id:companies[0]},state.service));deny(await rpc('review_admin_reviews_scoped',scoped(0),state.service));});
  await check('rls','anon_admin_denied',async()=>{deny(await rpc('review_admin_reviews_scoped',scoped(0),state.anon));});
  await check('rls','nonadmin_denied',async()=>{deny(await rpc('review_admin_reviews_scoped',scoped(0),sessions[1].access_token));});
  await check('rls','owner_own_company_rpc',async()=>{const r=await rpc('review_admin_reviews_scoped',scoped(0),sessions[0].access_token);assert.equal(r.status,200);assert.equal(r.data.length,1);assert.equal(r.data[0].company_id,companies[0]);assert.equal('raw_payload' in r.data[0],false);});
  await check('rls','owner_cross_company_denied',async()=>{deny(await rpc('review_admin_reviews_scoped',scoped(1),sessions[0].access_token));});
  await check('rls','second_company_isolated',async()=>{const r=await rpc('review_admin_reviews_scoped',scoped(1),sessions[2].access_token);assert.equal(r.status,200);assert.equal(r.data[0].company_id,companies[1]);deny(await rpc('review_admin_reviews_scoped',scoped(0),sessions[2].access_token));});
  await check('rls','spoofed_headers_denied',async()=>{deny(await rpc('review_admin_reviews_scoped',scoped(0),sessions[1].access_token,{'x-user-id':users[0].id,'x-role':'service_role','x-company':companies[0]}));});
  await check('rls','body_identity_override_denied',async()=>{deny(await rpc('review_admin_reviews_scoped',{...scoped(0),issuer:ISSUER,ref:'lab',role:'service_role',user_id:users[0].id},sessions[1].access_token));});
  await check('rls','public_table_rls_own_rows_only',async()=>{const r=await http(api,'/review_external_reviews?select=id,company_id',undefined,sessions[0].access_token);assert.equal(r.status,200);assert.equal(r.data.length,1);assert.equal(r.data[0].company_id,companies[0]);});
  await check('rls','nonadmin_table_no_rows',async()=>{const r=await http(api,'/review_external_reviews?select=id,company_id',undefined,sessions[1].access_token);assert.equal(r.status,200);assert.deepEqual(r.data,[]);});
  await check('rls','anon_table_denied',async()=>{deny(await http(api,'/review_external_reviews?select=id',undefined,state.anon));});
  await check('rls','raw_payload_column_denied',async()=>{deny(await http(api,'/review_external_reviews?select=raw_payload',undefined,sessions[0].access_token));});
  await check('rls','admin_table_denied',async()=>{deny(await http(api,'/review_admins',undefined,sessions[0].access_token));});
  await check('rls','private_schema_unavailable',async()=>{const r=await http(api,'/yandex_sessions',undefined,sessions[0].access_token,{'Accept-Profile':'review_private'});assert.ok([400,404,406].includes(r.status));});
  await check('rls','actual_private_recovery_objects_unavailable',async()=>{
    const table=await http(api,'/yandex_contract_recoveries',undefined,state.service,{'Accept-Profile':'review_private'});
    assert.ok([404,406].includes(table.status));
    const r=await http(api,'/rpc/recover_yandex_contract_connection',{},state.service,{'Content-Profile':'review_private'});
    assert.ok([404,406].includes(r.status)); // schema not exposed: function cannot execute
  });
  await check('auth','logout_revokes_refresh',async()=>{assert.ok([200,204].includes((await http(auth,'/logout',{},sessions[0].access_token)).status));deny(await http(auth,'/token?grant_type=refresh_token',{refresh_token:sessions[0].refresh_token}));});
  const suffix=(process.argv.includes('--node')?'_NODE':'')+(process.argv.includes('--v2')?'_V2':'');
  for(const [group,tests] of Object.entries(reports)) {
    const result={path:process.argv.includes('--node')?'NODE_TO_OFFICIAL_COMPONENTS':'OFFICIAL_LOOPBACK_DIRECT',tests,pass:tests.filter(t=>t.result==='PASS').length,fail:tests.filter(t=>t.result==='FAIL').length,external_effects:0};
    const filename={auth:'VPS04_AUTH_TESTS',api:'VPS04_API_TESTS',rls:'VPS04_RLS_HTTP'}[group]+suffix+'.json';
    writeFileSync(ROOT+'/'+filename,JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o644});
    console.log(JSON.stringify({group,...result,tests:tests.filter(t=>t.result==='FAIL')}));
  }
  if(Object.values(reports).flat().some(t=>t.result==='FAIL')) process.exitCode=1;
}catch {console.log(JSON.stringify({ok:false,stage,error:'SYNTHETIC_ACCEPTANCE_STOPPED'}));process.exitCode=1;}
