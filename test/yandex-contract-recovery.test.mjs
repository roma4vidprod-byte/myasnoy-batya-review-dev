import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {ids,fixtureSql,evidence,args,rpcSql} from './support/contract-recovery-fixture.mjs';
const migration=readFileSync(new URL('../supabase/migrations/20260914210000_yandex_contract_recovery_admin_09.sql',import.meta.url),'utf8');
const legacy=readFileSync(new URL('../supabase/migrations/20260913200000_yandex_connection_state_reconciliation_07a4b.sql',import.meta.url),'utf8');
const signature='review_private.recover_yandex_contract_connection(uuid,uuid,uuid,uuid,text,bigint,timestamptz,jsonb,timestamptz)';
const tables=['public.review_provider_connections','review_private.yandex_sessions','public.review_sync_runs',
 'public.review_external_reviews','cron.job','review_private.yandex_contract_recoveries'];
const call=async (db,a=args())=>(await db.query(rpcSql,a)).rows[0].result;
async function snap(db){
 const o={}; for(const table of tables)o[table]=(await db.query(`select to_jsonb(t) as data from ${table} t order by to_jsonb(t)::text`)).rows.map(r=>r.data); return o;
}
async function transaction(db,fn){await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}}
async function rejected(db,a,code){
 const before=await snap(db); await db.exec('savepoint recovery_attempt');
 await assert.rejects(call(db,a),e=>e.message===code&&e.code==='22023');
 await db.exec('rollback to savepoint recovery_attempt');assert.deepEqual(await snap(db),before);
}

test('administrative contract recovery: real SQL, atomicity, deny guards and replay',async t=>{
 const db=await PGlite.create(); t.after(()=>db.close());await db.exec(fixtureSql);await db.exec(legacy);
 const oldHash=(await db.query("select md5(pg_get_functiondef('public.review_reconcile_yandex_connection(uuid,uuid,text)'::regprocedure)) hash")).rows[0].hash;
 const beforeMigration={}; for(const table of tables.slice(0,-1))beforeMigration[table]=(await db.query(`select to_jsonb(t) d from ${table} t order by to_jsonb(t)::text`)).rows;
 await db.exec(migration);
 await t.test('migration is additive/repeatable and never changes existing business rows',async()=>{
  const before=await snap(db);await db.exec(migration);assert.deepEqual(await snap(db),before);
  for(const table of tables.slice(0,-1))assert.deepEqual((await db.query(`select to_jsonb(t) d from ${table} t order by to_jsonb(t)::text`)).rows,beforeMigration[table]);
  assert.equal((await db.query("select md5(pg_get_functiondef('public.review_reconcile_yandex_connection(uuid,uuid,text)'::regprocedure)) hash")).rows[0].hash,oldHash);
 });
 await t.test('one allowed recovery updates only connection status/error/version and inserts one audit',()=>transaction(db,async()=>{
  const before=await snap(db);const r=await call(db);assert.equal(r.outcome,'APPLIED');assert.equal(r.changed,true);assert.equal(r.session_revision,13);
  const after=await snap(db);
  for(const table of tables.slice(1,-1))assert.deepEqual(after[table],before[table]);
  const strip=v=>{const {status,last_error,updated_at,...rest}=v;return rest;};
  assert.deepEqual(after[tables[0]].map(strip),before[tables[0]].map(strip));
  assert.deepEqual(after[tables[0]].find(x=>x.id===ids.otherConnection),before[tables[0]].find(x=>x.id===ids.otherConnection));
  const conn=after[tables[0]].find(x=>x.id===ids.connection);assert.equal(conn.status,'READY');assert.equal(conn.last_error,null);
  assert.equal(after[tables.at(-1)].length,1);assert.equal(after[tables.at(-1)][0].error_before,'YANDEX_CONTRACT_DRIFT');
 }));
 await t.test('same request replay: no second update, no second audit',()=>transaction(db,async()=>{
  const a=args();await call(db,a);const before=await snap(db);const r=await call(db,a);
  assert.equal(r.changed,false);assert.equal(r.outcome,'ALREADY_APPLIED');assert.equal(r.current_status,'NOT_CHECKED');assert.deepEqual(await snap(db),before);
 }));
 await t.test('replay after a newer failure never clears the new error or claims current READY',()=>transaction(db,async()=>{
  const a=args();await call(db,a);await db.exec(`update public.review_provider_connections set status='ERROR',last_error='NEW_ERROR',updated_at=clock_timestamp() where id='${ids.connection}'`);
  const before=await snap(db);const r=await call(db,a);assert.equal(r.current_status,'NOT_CHECKED');assert.equal(r.changed,false);assert.deepEqual(await snap(db),before);
 }));
 await t.test('same request with different evidence is rejected',()=>transaction(db,async()=>{
  const a=args();await call(db,a);a[7]=JSON.stringify(evidence({artifact_sha256:'c'.repeat(64)}));await rejected(db,a,'RECOVERY_REQUEST_CONFLICT');
 }));
 await t.test('different request cannot repeat recovery of an already READY connection',()=>transaction(db,async()=>{
  await call(db);const a=args({request:ids.otherRequest});await rejected(db,a,'RECOVERY_CONNECTION_CHANGED');
 }));
 for(const [field,value,error] of [
  ['request',null,'RECOVERY_INPUT_INVALID'],['connection',null,'RECOVERY_INPUT_INVALID'],
  ['company',null,'RECOVERY_INPUT_INVALID'],['location',null,'RECOVERY_INPUT_INVALID'],
  ['org',null,'RECOVERY_INPUT_INVALID'],['org','cookie=secret','RECOVERY_INPUT_INVALID'],
  ['revision',null,'RECOVERY_INPUT_INVALID'],['revision',0,'RECOVERY_INPUT_INVALID'],
  ['revision',-1,'RECOVERY_INPUT_INVALID'],['revision','9007199254740992','RECOVERY_INPUT_INVALID'],
  ['connectionTime',null,'RECOVERY_INPUT_INVALID'],['connectionTime','infinity','RECOVERY_INPUT_INVALID'],
  ['expires',null,'RECOVERY_INPUT_INVALID'],['expires','infinity','RECOVERY_INPUT_INVALID'],
  ['expires','2000-01-01','RECOVERY_APPROVAL_INVALID'],['expires','2100-01-01','RECOVERY_APPROVAL_INVALID'],
  ['connectionTime','2020-01-01T00:00:00.000001Z','RECOVERY_CONNECTION_CHANGED'],
  ['evidence',null,'RECOVERY_EVIDENCE_INVALID'],['evidence',{},'RECOVERY_EVIDENCE_INVALID'],
  ['evidence',[],'RECOVERY_EVIDENCE_INVALID'],['evidence',true,'RECOVERY_EVIDENCE_INVALID']
 ])await t.test(`input ${field} ${JSON.stringify(value)} rejected`,()=>transaction(db,()=>rejected(db,args({[field]:value}),error)));
 for(const [key,value] of [
  ['basis','PROVIDER_SIGNED'],['artifact_sha256','not-a-sha'],['source_sha','bad'],['deployment_id','https://evil'],
  ['company_id',ids.otherCompany],['location_id',ids.otherLocation],['org_id','999'],
  ['revision',12],['revision','13'],['revision',null],['completeness','FAIL'],['validation','FAIL'],
  ['decrypt','FAIL'],['pretransport','FAIL'],['operation','health'],['provider_http_status',503],
  ['max_pages',6],['max_pages',0],['pages_fetched',0],['pages_fetched',3],['page_base',0],
  ['page_limit',0],['page_limit',1001],['received_count',70],['unique_count',68],['reported_total',0],
  ['transport_attempted',5],['transport_completed',3],['received_count',69.5],['received_count','69'],
  ['received_count',null],['received_count',-1],['received_count',1e20],['review_persistence','ON'],
  ['session_mutations','ON'],['connection_mutations','ON'],['queue_mutations','ON'],['notifications','ON'],
  ['raw_cookie','SYNTHETIC_SECRET'],['unknown_secret_key','SYNTHETIC_SECRET']
 ])await t.test(`invalid evidence ${key} rejected without writes`,()=>transaction(db,()=>rejected(db,args({evidence:evidence({[key]:value})}),'RECOVERY_EVIDENCE_INVALID')));
 await t.test('missing evidence key is not accepted as null/false',()=>transaction(db,async()=>{
  const e=evidence();delete e.completeness;await rejected(db,args({evidence:e}),'RECOVERY_EVIDENCE_INVALID');
 }));
 await t.test('zero-review full result is valid without hardcoding 69',()=>transaction(db,async()=>{
  const r=await call(db,args({evidence:evidence({pages_fetched:1,received_count:0,unique_count:0,reported_total:0,transport_attempted:1,transport_completed:1})}));assert.equal(r.outcome,'APPLIED');
 }));
 await t.test('newer valid cardinality is accepted without hardcoding 67/69',()=>transaction(db,async()=>{
  const r=await call(db,args({evidence:evidence({received_count:72,unique_count:72,reported_total:72})}));assert.equal(r.outcome,'APPLIED');
 }));
 for(const [label,sql,err] of [
  ['disabled',`update public.review_provider_connections set enabled=false where id='${ids.connection}'`,'RECOVERY_NOT_ALLOWED'],
  ['PAUSED',`update public.review_provider_connections set status='PAUSED' where id='${ids.connection}'`,'RECOVERY_NOT_ALLOWED'],
  ['READY by another action',`update public.review_provider_connections set status='READY',last_error=null where id='${ids.connection}'`,'RECOVERY_NOT_ALLOWED'],
  ['different error',`update public.review_provider_connections set last_error='SESSION_DECRYPT_FAILED' where id='${ids.connection}'`,'RECOVERY_NOT_ALLOWED'],
  ['new connection version',`update public.review_provider_connections set updated_at=clock_timestamp() where id='${ids.connection}'`,'RECOVERY_CONNECTION_CHANGED'],
  ['wrong location config',`update public.review_provider_connections set config=config||'{"location_id":"${ids.otherLocation}"}' where id='${ids.connection}'`,'RECOVERY_SCOPE_INVALID'],
  ['wrong organization config',`update public.review_provider_connections set config=config||'{"external_org_id":"1"}' where id='${ids.connection}'`,'RECOVERY_SCOPE_INVALID'],
  ['wrong provider',`update public.review_provider_connections set provider='2gis' where id='${ids.connection}'`,'RECOVERY_SCOPE_INVALID'],
  ['missing session',`delete from review_private.yandex_sessions`,'RECOVERY_SESSION_NOT_READY'],
  ['new session revision',`update review_private.yandex_sessions set revision=14`,'RECOVERY_SESSION_CHANGED'],
  ['NOT_CONFIGURED session',`update review_private.yandex_sessions set state='NOT_CONFIGURED'`,'RECOVERY_SESSION_NOT_READY'],
  ['DISABLED session',`update review_private.yandex_sessions set state='DISABLED'`,'RECOVERY_SESSION_NOT_READY'],
  ['expired access state',`update review_private.yandex_sessions set state='REAUTH_REQUIRED'`,'RECOVERY_SESSION_NOT_READY'],
  ['no material',`update review_private.yandex_sessions set envelope=null`,'RECOVERY_SESSION_NOT_READY'],
  ['no material version',`update review_private.yandex_sessions set credential_version=null`,'RECOVERY_SESSION_NOT_READY'],
  ['uncleared session error',`update review_private.yandex_sessions set last_error_code='ERR'`,'RECOVERY_SESSION_NOT_READY'],
  ['no health evidence',`update review_private.yandex_sessions set last_session_check_at=null`,'RECOVERY_SESSION_NOT_READY'],
  ['active QUEUED run',`update public.review_sync_runs set status='QUEUED' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'`,'RECOVERY_ACTIVE_RUN'],
  ['active RUNNING run',`update public.review_sync_runs set status='RUNNING' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'`,'RECOVERY_ACTIVE_RUN'],
  ['active scheduler',`update cron.job set active=true`,'RECOVERY_SCHEDULER_ACTIVE']
 ])await t.test(label+' refused',()=>transaction(db,async()=>{await db.exec(sql);await rejected(db,args(),err);}));
 await t.test('wrong company even with matching attestation cannot read/change the real connection',()=>transaction(db,()=>rejected(db,args({company:ids.otherCompany,evidence:evidence({company_id:ids.otherCompany})}),'RECOVERY_SCOPE_INVALID')));
 await t.test('recorded audit failure rolls back preceding connection update',()=>transaction(db,async()=>{
  await db.exec(`create function public.reject_test_audit() returns trigger language plpgsql as $$begin raise exception using errcode='22023',message='TEST_AUDIT_FAILURE';end;$$;
    create trigger test_reject_audit before insert on review_private.yandex_contract_recoveries for each row execute function public.reject_test_audit();`);
  await rejected(db,args(),'TEST_AUDIT_FAILURE');
 }));
 await t.test('suppressed audit insert also rolls back connection recovery',()=>transaction(db,async()=>{
  await db.exec(`create function public.suppress_test_audit() returns trigger language plpgsql as $$begin return null;end;$$;
    create trigger test_suppress_audit before insert on review_private.yandex_contract_recoveries for each row execute function public.suppress_test_audit();`);
  await rejected(db,args(),'RECOVERY_AUDIT_FAILED');
 }));
 for(const role of ['anon','authenticated','service_role'])await t.test(role+' cannot execute recovery or access private history',async()=>{
  const before=await snap(db);await db.exec('set role '+role);
  try{
   await assert.rejects(call(db),{code:'42501'});
   await assert.rejects(db.query('select * from review_private.yandex_contract_recoveries'),{code:'42501'});
  }finally{await db.exec('reset role');}
  assert.deepEqual(await snap(db),before);
 });
 await t.test('even explicit accidental EXECUTE grant does not bypass postgres-only role guard',()=>transaction(db,async()=>{
  await db.exec(`grant execute on function ${signature} to service_role;set role service_role;savepoint denied;`);
  await assert.rejects(call(db),{code:'42501',message:'RECOVERY_ADMIN_REQUIRED'});await db.exec('rollback to savepoint denied;reset role');
 }));
 for(const action of ['update review_private.yandex_contract_recoveries set status_after=\'READY\'','delete from review_private.yandex_contract_recoveries','truncate review_private.yandex_contract_recoveries']){
  await t.test('successful audit refuses '+action.split(' ')[0],()=>transaction(db,async()=>{
   await call(db);const before=await snap(db);await db.exec('savepoint immutable');
   await assert.rejects(db.exec(action),{code:'22023',message:'RECOVERY_HISTORY_IMMUTABLE'});
   await db.exec('rollback to savepoint immutable');assert.deepEqual(await snap(db),before);
  }));
 }
 await t.test('private invoker, empty search_path, no application execute, RLS forced',async()=>{
  const r=(await db.query(`select prosecdef,proconfig,has_function_privilege('service_role',oid,'execute') app_exec,has_function_privilege('anon',oid,'execute') anon_exec from pg_proc where oid=$1::regprocedure`,[signature])).rows[0];
  assert.equal(r.prosecdef,false);assert.equal(r.app_exec,false);assert.equal(r.anon_exec,false);assert.ok(r.proconfig.includes('search_path=""'));
  const c=(await db.query("select relrowsecurity,relforcerowsecurity from pg_class where oid='review_private.yandex_contract_recoveries'::regclass")).rows[0];assert.equal(c.relrowsecurity,true);assert.equal(c.relforcerowsecurity,true);
 });
 await t.test('SQL defines transaction locks and expected-state predicate (static, NOT multi-session proof)',()=>{
  assert.match(migration,/pg_advisory_xact_lock/);assert.match(migration,/for update;/i);assert.match(migration,/for share;/i);
  assert.match(migration,/pc\.updated_at=p_expected_connection_updated_at/);assert.match(migration,/clock_timestamp\(\) >= p_approval_expires_at/);
 });
});
