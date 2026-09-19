import {ROOT,ETC,run,sql} from './bootstrap.mjs';
import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';

const tests=[];
const ready=async()=>{try {const r=await fetch('http://127.0.0.1:13000/readyz',{redirect:'error',signal:AbortSignal.timeout(5000)});return {status:r.status,data:await r.json()};}catch{return {status:0};}};
async function restored(){for(let i=0;i<30;i++){if((await ready()).status===200)return;await new Promise(r=>setTimeout(r,500));}throw new Error('RESTORE_NOT_READY');}
async function test(name,fn){try{await fn();tests.push({name,result:'PASS'});}catch{tests.push({name,result:'FAIL'});throw new Error('LAB_FAILURE_GATE_STOPPED');}}
let restoreService=null,restoreVersion=false,markerChanges=0;
try{
  assert.equal(process.getuid(),0);assert.equal(run('hostname',[]).trim(),'hiplet-120706');
  await restored();
  for(const service of ['review-lab-auth','review-lab-api','postgresql@17-main']){
    await test(service+'_unavailable_fails_closed',async()=>{
      restoreService=service;run('systemctl',['stop',service]);
      assert.equal((await ready()).status,503);
      const live=await fetch('http://127.0.0.1:13000/healthz');assert.equal(live.status,200);
      run('systemctl',['start',service]);restoreService=null;await restored();
    });
  }
  await test('migration_marker_missing_fails_closed',async()=>{
    restoreVersion=true;sql("delete from vps_lab_private.version where version='vps04-auth-api-v1';");markerChanges++;
    assert.equal((await ready()).status,503);
    sql("insert into vps_lab_private.version values('vps04-auth-api-v1');");markerChanges++;restoreVersion=false;await restored();
  });
  await test('foundation_service_restart',async()=>{run('systemctl',['restart','review-activator-foundation']);await restored();});
  await test('node_cannot_read_signer_or_service_credentials',async()=>{
    const result=run('runuser',['-u','review-activator','--','/bin/sh','-c','test ! -r /etc/review-activator-lab/bootstrap.json && test ! -r /etc/review-activator-lab/auth.env && test ! -r /etc/review-activator-lab/api.env && echo PASS']);assert.equal(result.trim(),'PASS');
  });
  await test('auth_owned_tables_and_minimal_authenticator',async()=>{
    const out=sql("select bool_and(tableowner='supabase_auth_admin') from pg_tables where schemaname='auth'; select not rolsuper and not rolbypassrls from pg_roles where rolname='ra_lab_authenticator'; select string_agg(r.rolname,',' order by r.rolname) from pg_auth_members m join pg_roles r on r.oid=m.roleid where m.member='ra_lab_authenticator'::regrole;");
    assert.ok(out.trim().endsWith('t\nt\nanon,authenticated,service_role'));
  });
  await test('no_scheduler_no_private_material',async()=>{
    const out=sql("select count(*) from cron.job; select count(*) from public.review_sync_runs; select count(*) from review_private.yandex_sessions;");assert.ok(out.trim().endsWith('0\n0\n0'));
  });
}catch{}finally{
  try{if(restoreService)run('systemctl',['start',restoreService]);if(restoreVersion)sql("insert into vps_lab_private.version values('vps04-auth-api-v1') on conflict do nothing;");await restored();}
  catch{tests.push({name:'restore_services',result:'FAIL'});}
  const report={tests,pass:tests.filter(t=>t.result==='PASS').length,fail:tests.filter(t=>t.result==='FAIL').length,skipped:8-tests.length,
    deliberate_synthetic_marker_changes:markerChanges,provider_effects:0};
  writeFileSync(ROOT+'/VPS04_FAILURE_TESTS.json',JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o644});
  console.log(JSON.stringify(report));if(report.fail||report.skipped)process.exitCode=1;
}
