import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
const original=readFileSync(new URL('../supabase/migrations/20260913150000_yandex_hourly_sync_07.sql',import.meta.url),'utf8');
const legacy=original.match(/create or replace function public\.review_fail_sync_run\([\s\S]*?\$\$;/)[0];
const migration=readFileSync(new URL('../supabase/migrations/20260914190000_review_fail_sync_null_guard_08.sql',import.meta.url),'utf8');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',R='33333333-3333-4333-8333-333333333333';
const call=(db,company=A,run=R,error=null)=>db.query('select public.review_fail_sync_run($1,$2,$3) result',[company,run,error]);
const snapshot=async db=>(await db.query(`select to_jsonb(r) as run,to_jsonb(c) as connection from public.review_sync_runs r join public.review_provider_connections c on c.id=r.provider_connection_id`)).rows;
test('real PostgreSQL regression for NULL error code, transaction safety and grants',async t=>{
 const db=await PGlite.create();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;
 create table public.review_provider_connections(id uuid primary key,company_id uuid,provider text,status text,last_error text,updated_at timestamptz);
 create table public.review_sync_runs(id uuid primary key,provider_connection_id uuid,status text,finished_at timestamptz,error text,meta jsonb);
 insert into public.review_provider_connections values('${A}','${A}','yandex','READY',null,'2000-01-01');
 insert into public.review_sync_runs values('${R}','${A}','RUNNING',null,null,'{}');
 grant usage on schema public to service_role,anon,authenticated;
 grant select,update on all tables in schema public to service_role;`);
 await db.exec(legacy);
 await t.test('old function accepts NULL and marks a run FAILED with NULL reason',async()=>{
  await db.exec('begin');try{
   const v=(await call(db)).rows[0].result;assert.equal(v.status,'FAILED');assert.equal(v.error_code,null);
  }finally{await db.exec('rollback');}
 });
 const before=await snapshot(db);
 await db.exec(migration);
 await t.test('patch is repeatable and does not change existing rows',async()=>{
  await db.exec(migration);assert.deepEqual(await snapshot(db),before);
 });
 for(const [label,company,run,reason,expected] of [
  ['NULL error',A,R,null,'SYNC_ERROR_INVALID'],['empty error',A,R,'','SYNC_ERROR_INVALID'],
  ['unknown error',A,R,'PRIVATE_SYNTHETIC','SYNC_ERROR_INVALID'],
  ['missing company',null,R,'YANDEX_CONTRACT_DRIFT','SYNC_ERROR_INVALID'],
  ['missing run',A,null,'YANDEX_CONTRACT_DRIFT','SYNC_ERROR_INVALID'],
  ['other company',B,R,'YANDEX_CONTRACT_DRIFT','SYNC_RUN_NOT_CLAIMED']]){
  await t.test(label+' rejected without changing rows',async()=>{
   await assert.rejects(call(db,company,run,reason),{message:expected});assert.deepEqual(await snapshot(db),before);
  });
 }
 for(const role of ['anon','authenticated'])await t.test(role+' remains denied',async()=>{
  await db.exec('set role '+role);try{await assert.rejects(call(db,A,R,'YANDEX_CONTRACT_DRIFT'),{code:'42501'});}finally{await db.exec('reset role');}
  assert.deepEqual(await snapshot(db),before);
 });
 await t.test('service_role can fail exactly one claimed run with an approved code',async()=>{
  await db.exec('set role service_role');try{
   const result=(await call(db,A,R,'YANDEX_CONTRACT_DRIFT')).rows[0].result;
   assert.deepEqual(result,{status:'FAILED',error_code:'YANDEX_CONTRACT_DRIFT'});
  }finally{await db.exec('reset role');}
  const rows=await snapshot(db);assert.equal(rows[0].run.status,'FAILED');assert.equal(rows[0].connection.last_error,'YANDEX_CONTRACT_DRIFT');
  await assert.rejects(call(db,A,R,'YANDEX_CONTRACT_DRIFT'),{message:'SYNC_RUN_NOT_CLAIMED'});
  assert.deepEqual(await snapshot(db),rows);
 });
 await t.test('function remains invoker with explicit grants and empty search_path',async()=>{
  const r=(await db.query(`select prosecdef,proconfig,has_function_privilege('anon',oid,'execute') anon_exec,has_function_privilege('authenticated',oid,'execute') auth_exec,has_function_privilege('service_role',oid,'execute') server_exec from pg_proc where oid='public.review_fail_sync_run(uuid,uuid,text)'::regprocedure`)).rows[0];
  assert.equal(r.prosecdef,false);assert.equal(r.anon_exec,false);assert.equal(r.auth_exec,false);assert.equal(r.server_exec,true);
  assert.ok(r.proconfig.some(x=>x==='search_path=""'));
 });
});
