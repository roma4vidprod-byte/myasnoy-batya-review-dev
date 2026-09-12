import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const migration=read('../supabase/migrations/20260913090000_yandex_scoped_persistence_atomic_writer_04.sql');
const idempotencyMigration=read('../supabase/migrations/20260913100000_yandex_persistence_idempotency_05a.sql');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const LA='33333333-3333-4333-8333-333333333333',LB='44444444-4444-4444-8444-444444444444';
const LA2='55555555-5555-4555-8555-555555555555';
const scope={company:A,location:LA,provider:'yandex',externalLocation:'54309413522'};
const raw=i=>({contract_version:'business-list-v1',type_confirmation:'PENDING',id:`id-${i}`,cmnt_entity_id:`id-${i}`,external_id_source:'id',author_name:`Synthetic ${i}`,full_text:`Synthetic review ${i}`,rating:(i%5)+1,time_created:1735495043063,owner_comment:null,comments_count:0,lang:'ru',public_rating:true});
const row=i=>({external_review_id:`id-${i}`,author_name:`Synthetic ${i}`,rating:(i%5)+1,review_text:`Synthetic review ${i}`,published_at:'2024-12-29T17:57:23.063Z',observed_at:'2026-09-13T00:00:00Z',owner_reply_text:i<54?`Synthetic reply ${i}`:null,owner_replied_at:i<54?'2024-12-30T17:57:23.063Z':null,raw_payload:raw(i)});
const batch=()=>Array.from({length:67},(_,i)=>row(i));
async function inRole(db,role,fn){
  await db.exec(`begin; set local role ${role}`);
  try{return await fn();}finally{await db.exec('rollback');}
}
async function setup(t){
  const db=await PGlite.create();t.after(()=>db.close());
  await db.exec(read('./fixtures/db/review-sync-baseline.sql'));
  await db.exec(`insert into public.review_companies values ('${A}'),('${B}');
    insert into public.review_locations values ('${LA}','${A}'),('${LB}','${B}'),('${LA2}','${A}');
    update cron.job set active=false;`);
  await db.exec(migration); await db.exec(idempotencyMigration);
  return db;
}
async function call(db,s=scope,rows=batch()){
  await db.exec('begin; set local role service_role');
  try{
    const value=(await db.query(`select public.review_persist_external_reviews($1,$2,$3,$4,$5::jsonb) as value`,[s.company,s.location,s.provider,s.externalLocation,JSON.stringify(rows)])).rows[0].value;
    await db.exec('commit');return value;
  }catch(error){await db.exec('rollback');throw error;}
}
test('scoped writer: 67 inserts, strict no-op replay, one provider-owned change updates one',async t=>{
  const db=await setup(t);const first=await call(db);assert.deepEqual(first,{inserted:67,updated:0,unchanged:0,seen:67,persistence_enabled:true});
  assert.equal((await db.query('select count(*)::int n from public.review_external_reviews')).rows[0].n,67);
  assert.equal((await db.query("select count(*)::int n from public.review_external_reviews where owner_reply_text is not null and reply_state='NONE'")).rows[0].n,54);
  await db.exec("update public.review_external_reviews set reply_state='DRAFT',owner_reply_external_id='local-10' where external_review_id='id-10'");
  const replay=await call(db,scope,batch().map(r=>({...r,observed_at:'2026-09-14T00:00:00Z'})));
  assert.deepEqual(replay,{inserted:0,updated:0,unchanged:67,seen:67,persistence_enabled:true});
  const changed=batch();changed[10]={...changed[10],review_text:'Synthetic changed'};
  const update=await call(db,scope,changed);assert.deepEqual(update,{inserted:0,updated:1,unchanged:66,seen:67,persistence_enabled:true});
  const preserved=(await db.query("select reply_state,owner_reply_external_id from public.review_external_reviews where external_review_id='id-10'")).rows[0];
  assert.deepEqual(preserved,{reply_state:'DRAFT',owner_reply_external_id:'local-10'});
});
test('rating, review text and owner reply changes each update exactly one row',async t=>{
  const db=await setup(t);await call(db,scope,[row(1)]);
  assert.deepEqual(await call(db,scope,[{...row(1),rating:4,observed_at:'2026-09-14T00:00:00Z'}]),{inserted:0,updated:1,unchanged:0,seen:1,persistence_enabled:true});
  assert.deepEqual(await call(db,scope,[{...row(1),rating:4,review_text:'Changed text',observed_at:'2026-09-14T00:00:01Z'}]),{inserted:0,updated:1,unchanged:0,seen:1,persistence_enabled:true});
  assert.deepEqual(await call(db,scope,[{...row(1),rating:4,review_text:'Changed text',owner_reply_text:'Changed reply',owner_replied_at:'2024-12-31T17:57:23.063Z',observed_at:'2026-09-14T00:00:02Z'}]),{inserted:0,updated:1,unchanged:0,seen:1,persistence_enabled:true});
});
test('scoped identity allows same provider ID in another company/location and isolates providers',async t=>{
  const db=await setup(t);await call(db,scope,[row(1)]);
  const other=await call(db,{company:B,location:LB,provider:'yandex',externalLocation:'other-org'},[row(1)]);
  assert.equal(other.inserted,1);
  const provider=await call(db,{company:A,location:LA,provider:'2gis',externalLocation:'2gis-org'},[row(1)]);
  assert.equal(provider.inserted,1);
  assert.equal((await db.query('select count(*)::int n from public.review_external_reviews')).rows[0].n,3);
});
test('writer rejects external scope reassignment, malformed scope and rolls back the whole batch',async t=>{
  const db=await setup(t);await call(db,scope,[row(1)]);
  await assert.rejects(call(db,scope,[{...row(1),raw_payload:{...raw(1),secret:'no'}}]),{message:'REVIEW_RAW_PAYLOAD_INVALID'});
  await assert.rejects(call(db,scope,[row(2),{...row(3),rating:9}]),{message:'REVIEW_ROW_INVALID'});
  assert.equal((await db.query('select count(*)::int n from public.review_external_reviews')).rows[0].n,1);
  await assert.rejects(call(db,{...scope,externalLocation:'different-org'},[row(1)]),{message:'REVIEW_SCOPE_COLLISION'});
  await assert.rejects(call(db,{...scope,location:LB},[row(4)]),{message:'REVIEW_SCOPE_INVALID'});
  assert.equal((await db.query("select count(*)::int n from public.review_external_reviews where external_review_id='id-2'")).rows[0].n,0);
});
test('same-scope concurrent duplicate batches are deterministic and unique',async t=>{
  const db=await setup(t);const results=await Promise.all([call(db,scope,[row(1),row(2)]),call(db,scope,[row(1),row(2)])]);
  assert.equal(results[0].inserted+results[1].inserted,2);
  assert.equal(results[0].updated+results[1].updated,0);
  assert.equal(results[0].unchanged+results[1].unchanged,2);
  assert.equal((await db.query('select count(*)::int n from public.review_external_reviews')).rows[0].n,2);
});
test('roles: only service_role can execute writer or mutate review rows directly',async t=>{
  const db=await setup(t);
  for(const role of ['anon','authenticated']){
    await assert.rejects(inRole(db,role,()=>db.query(`select public.review_persist_external_reviews('${A}','${LA}','yandex','54309413522','[]'::jsonb)`)),{code:'42501'});
    await assert.rejects(inRole(db,role,()=>db.query(`insert into public.review_external_reviews(company_id,location_id,provider,external_review_id) values ('${A}','${LA}','yandex','denied')`)),{code:'42501'});
  }
  const priv=(await db.query(`select p.prosecdef,has_function_privilege('anon',p.oid,'execute') anon_exec,has_function_privilege('authenticated',p.oid,'execute') auth_exec,has_function_privilege('service_role',p.oid,'execute') service_exec from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='review_persist_external_reviews'`)).rows[0];
  assert.deepEqual(priv,{prosecdef:false,anon_exec:false,auth_exec:false,service_exec:true});
});
test('schema identity and dependencies are hard-scoped',async t=>{
  const db=await setup(t);
  const constraints=(await db.query("select conname,pg_get_constraintdef(oid) definition from pg_constraint where conrelid='public.review_external_reviews'::regclass")).rows;
  assert.ok(constraints.some(x=>x.definition.includes('UNIQUE (company_id, location_id, provider, external_review_id)')));
  assert.equal((await db.query("select to_regclass('public.review_external_reviews_provider_external_id_uq') is null absent")).rows[0].absent,true);
  const location=(await db.query("select is_nullable from information_schema.columns where table_schema='public' and table_name='review_external_reviews' and column_name='location_id'")).rows[0];
  assert.equal(location.is_nullable,'NO');
  const fk=(await db.query("select pg_get_constraintdef(oid) definition from pg_constraint where conname='review_external_reviews_location_company_fk'")).rows[0];
  assert.match(fk.definition,/FOREIGN KEY \(location_id, company_id\)/);
});
