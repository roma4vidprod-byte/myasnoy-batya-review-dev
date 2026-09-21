import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const foundation=readFileSync(
  new URL('../tools/vps14/reply-publish-foundation.sql',import.meta.url),'utf8'
);
const sendState=readFileSync(
  new URL('../tools/vps14/reply-send-state.sql',import.meta.url),'utf8'
);
const C='13f3cb80-487a-4a19-96a1-fb3103200230';
const L='9a95f63b-18e6-447b-a449-8530b67ddbae';
const R='11111111-1111-4111-8111-111111111111';
const A='22222222-2222-4222-8222-222222222222';

async function setup(t){
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`
    create role anon;create role authenticated;create role service_role;
    create schema auth;create schema vps_lab_private;create schema vps_yandex_private;
    create table vps_lab_private.version(version text);
    insert into vps_lab_private.version values('vps04-auth-api-v1');
    create table public.review_companies(id uuid primary key);
    create table public.review_locations(id uuid primary key,company_id uuid not null);
    create table public.review_external_reviews(
      id uuid primary key,company_id uuid not null,location_id uuid,
      provider text not null,external_review_id text not null,
      external_location_id text,owner_reply_text text,owner_replied_at timestamptz,
      reply_state text not null default 'NONE'
    );
    create table public.review_reply_actions(
      id uuid primary key default gen_random_uuid(),external_review_row_id uuid not null,
      company_id uuid not null,provider text not null,external_review_id text not null,
      reply_text text not null,status text not null default 'DRAFT',created_by text,
      attempt_count integer not null default 0,last_error text,external_reply_id text,
      created_at timestamptz not null default now(),queued_at timestamptz,sent_at timestamptz,
      updated_at timestamptz not null default now(),draft_source text not null default 'human',
      ai_model text,ai_generated_at timestamptz,edited_after_ai boolean not null default false
    );
    create function auth.uid() returns uuid language sql stable
      as 'select ''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa''::uuid';
    create function public.review_is_admin() returns boolean language sql stable as 'select true';
    create function vps_lab_private.has_company(uuid) returns boolean language sql stable
      as 'select $1=''13f3cb80-487a-4a19-96a1-fb3103200230''::uuid';
    insert into public.review_companies values('${C}');
    insert into public.review_locations values('${L}','${C}');
    insert into public.review_external_reviews(
      id,company_id,location_id,provider,external_review_id,external_location_id
    ) values('${R}','${C}','${L}','yandex','external-1','54309413522');
    insert into public.review_reply_actions(
      id,external_review_row_id,company_id,provider,external_review_id,reply_text,status
    ) values('${A}','${R}','${C}','yandex','external-1','Спасибо','DRAFT');
  `);
  const name=(await db.query('select current_database() n')).rows[0].n;
  await db.exec(foundation.replaceAll("'review_activator_lab'",`'${name}'`));
  const adapted=sendState
    .replaceAll('review_activator_lab',name)
    .replaceAll("current_user <> 'postgres'","false")
    .replaceAll("session_user <> 'review-yandex-writer'","false");
  await db.exec(adapted);
  return db;
}

async function queue(db){
  const proposal=(await db.query(
    `select * from public.review_admin_prepare_reply_approval_scoped(
      $1,$2,$3,$4,$5,$6,$7
    )`,
    [A,R,C,L,'54309413522','yandex',600]
  )).rows[0];
  const queued=(await db.query(
    `select * from public.review_admin_approve_reply_scoped(
      $1,$2,$3,$4,$5,$6,$7
    )`,
    [A,R,C,L,'54309413522','yandex',proposal.approval_fingerprint]
  )).rows[0];
  return {proposal,queued};
}

test('VPS14 send-state installs claim_next + finish, not legacy call',async t=>{
  const db=await setup(t);
  const rows=(await db.query(`
    select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='vps_yandex_private'
      and proname like 'reply_worker_%'
    order by proname
  `)).rows.map(row=>row.proname);
  assert.deepEqual(rows,['reply_worker_claim_next','reply_worker_finish']);
});

test('approved action is atomically claimed to SENDING once',async t=>{
  const db=await setup(t);
  const {queued}=await queue(db);
  const claim=(await db.query(
    'select vps_yandex_private.reply_worker_claim_next() result'
  )).rows[0].result;
  assert.equal(claim.status,'SENDING');
  assert.equal(claim.action_id,A);
  assert.equal(claim.external_review_id,'external-1');
  assert.equal(claim.idempotency_key,queued.idempotency_key);
  assert.equal(claim.attempt_count,1);

  const action=(await db.query(
    'select status,attempt_count from public.review_reply_actions where id=$1',[A]
  )).rows[0];
  assert.deepEqual(action,{status:'SENDING',attempt_count:1});

  const second=(await db.query(
    'select vps_yandex_private.reply_worker_claim_next() result'
  )).rows[0].result;
  assert.equal(second,null);
});

test('finish complete moves exact SENDING action to SENT',async t=>{
  const db=await setup(t);
  const {queued}=await queue(db);
  await db.query('select vps_yandex_private.reply_worker_claim_next()');
  const result=(await db.query(
    `select vps_yandex_private.reply_worker_finish(
      'complete',$1,$2,null
    ) result`,
    [A,queued.idempotency_key]
  )).rows[0].result;
  assert.equal(result.status,'SENT');

  const action=(await db.query(
    'select status,last_error from public.review_reply_actions where id=$1',[A]
  )).rows[0];
  assert.deepEqual(action,{status:'SENT',last_error:null});
  const review=(await db.query(
    'select reply_state from public.review_external_reviews where id=$1',[R]
  )).rows[0];
  assert.equal(review.reply_state,'SENT');
});

test('expired queued approval fails locally before any claim is returned',async t=>{
  const db=await setup(t);
  await queue(db);
  await db.query(
    "update public.review_reply_actions set approval_expires_at=clock_timestamp()-interval '1 second' where id=$1",
    [A]
  );
  const claim=(await db.query(
    'select vps_yandex_private.reply_worker_claim_next() result'
  )).rows[0].result;
  assert.equal(claim,null);
  const action=(await db.query(
    'select status,last_error,attempt_count from public.review_reply_actions where id=$1',[A]
  )).rows[0];
  assert.deepEqual(action,{
    status:'FAILED',last_error:'REPLY_APPROVAL_EXPIRED',attempt_count:0
  });
});

test('fingerprint drift fails locally before provider claim',async t=>{
  const db=await setup(t);
  await queue(db);
  await db.query(
    "update public.review_reply_actions set approval_fingerprint=$2 where id=$1",
    [A,'f'.repeat(64)]
  );
  const claim=(await db.query(
    'select vps_yandex_private.reply_worker_claim_next() result'
  )).rows[0].result;
  assert.equal(claim,null);
  const action=(await db.query(
    'select status,last_error,attempt_count from public.review_reply_actions where id=$1',[A]
  )).rows[0];
  assert.deepEqual(action,{
    status:'FAILED',last_error:'REPLY_APPROVAL_INVALID',attempt_count:0
  });
});

test('provider-observed owner reply becomes SYNCED_EXTERNAL',async t=>{
  const db=await setup(t);
  await db.query(
    "update public.review_external_reviews set owner_reply_text='Опубликованный ответ' where id=$1",
    [R]
  );
  const row=(await db.query(
    'select reply_state,owner_reply_text from public.review_external_reviews where id=$1',[R]
  )).rows[0];
  assert.equal(row.reply_state,'SYNCED_EXTERNAL');
  assert.equal(row.owner_reply_text,'Опубликованный ответ');
});

test('send-state source has isolated writer, SKIP LOCKED and no network',()=>{
  assert.match(sendState,/session_user <> 'review-yandex-writer'/);
  assert.match(sendState,/for update of a(?:,r)? skip locked/i);
  assert.match(sendState,/reply_worker_claim_next/);
  assert.match(sendState,/reply_worker_finish/);
  assert.match(sendState,/status='SENDING'/);
  assert.match(sendState,/status='SENT'/);
  assert.match(sendState,/status='FAILED'/);
  assert.match(sendState,/YANDEX_REPLY_RESULT_UNKNOWN/);
  assert.match(sendState,/SYNCED_EXTERNAL/);
  assert.doesNotMatch(sendState,/https?:\/\//i);
  assert.doesNotMatch(sendState,/fetch\s*\(/i);
  assert.match(sendState,/revoke all on function vps_yandex_private\.reply_worker_claim_next/);
  assert.match(sendState,/revoke all on function vps_yandex_private\.reply_worker_finish/);
  assert.match(sendState,/to "review-yandex-writer"/);
});
