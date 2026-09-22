import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {replyApprovalFingerprint} from '../lib/server/review-reply-approval.js';

const sql=readFileSync(
  new URL('../tools/vps14/reply-publish-foundation.sql',import.meta.url),
  'utf8'
);
const C='13f3cb80-487a-4a19-96a1-fb3103200230';
const L='9a95f63b-18e6-447b-a449-8530b67ddbae';
const U='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const R='11111111-1111-4111-8111-111111111111';
const A='22222222-2222-4222-8222-222222222222';

async function setup(t){
  const db=new PGlite();
  t.after(()=>db.close());
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create schema vps_lab_private;
    create table public.review_companies(id uuid primary key);
    create table public.review_locations(id uuid primary key,company_id uuid not null);
  `);
  await db.exec(`
    create table public.review_external_reviews(
      id uuid primary key,company_id uuid not null,location_id uuid,
      provider text not null,external_review_id text not null,
      external_location_id text,owner_reply_text text,
      reply_state text not null default 'NONE'
    );
    create table public.review_reply_actions(
      id uuid primary key default gen_random_uuid(),
      external_review_row_id uuid not null,company_id uuid not null,
      provider text not null,external_review_id text not null,reply_text text not null,
      status text not null default 'DRAFT',created_by text,
      attempt_count integer not null default 0,last_error text,external_reply_id text,
      created_at timestamptz not null default now(),queued_at timestamptz,
      sent_at timestamptz,updated_at timestamptz not null default now(),
      draft_source text not null default 'human',ai_model text,
      ai_generated_at timestamptz,edited_after_ai boolean not null default false
    );
    create function auth.uid() returns uuid language sql stable
      as 'select ''aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa''::uuid';
    create function public.review_is_admin() returns boolean language sql stable
      as 'select true';
  `);
  await db.exec(`
    create function vps_lab_private.has_company(uuid)
    returns boolean language sql stable
    as 'select $1=''13f3cb80-487a-4a19-96a1-fb3103200230''::uuid';

    insert into public.review_companies values('${C}');
    insert into public.review_locations values('${L}','${C}');
    insert into public.review_external_reviews(
      id,company_id,location_id,provider,external_review_id,external_location_id
    ) values(
      '${R}','${C}','${L}','yandex','external-1','54309413522'
    );
    insert into public.review_reply_actions(
      id,external_review_row_id,company_id,provider,external_review_id,
      reply_text,status,created_by
    ) values(
      '${A}','${R}','${C}','yandex','external-1',
      'Спасибо за обратную связь','DRAFT','${U}'
    );
    update public.review_external_reviews set reply_state='DRAFT' where id='${R}';
  `);
  await db.exec(`
    create function public.review_admin_prepare_reply_approval_scoped(
      uuid,uuid,uuid,uuid,text,text,integer
    ) returns table(
      action_id uuid,approval_fingerprint text,
      approval_expires_at timestamptz,reply_length integer
    ) language sql as 'select null::uuid,null::text,null::timestamptz,null::integer';
  `);
  const name=(await db.query('select current_database() n')).rows[0].n;
  await db.exec(sql.replaceAll("'review_activator_lab'",`'${name}'`));
  return db;
}
test('VPS14 SQL compiles and JS/SQL approval fingerprints match',async t=>{
  const db=await setup(t);
  const row=(await db.query(
    `select vps_lab_private.reply_approval_fingerprint(
      $1,$2,$3,$4,$5,$6
    ) fingerprint`,
    [A,'external-1','Спасибо за обратную связь',C,L,'yandex']
  )).rows[0];

  const js=replyApprovalFingerprint({
    actionId:A,reviewId:'external-1',replyText:'Спасибо за обратную связь',
    companyId:C,locationId:L,provider:'yandex'
  });
  assert.equal(row.fingerprint,js);
});

test('prepare keeps DRAFT and creates a bounded approval proposal',async t=>{
  const db=await setup(t);
  const proposal=(await db.query(
    `select * from public.review_admin_prepare_reply_approval_scoped(
      $1,$2,$3,$4,$5,$6,$7
    )`,
    [A,R,C,L,'54309413522','yandex',600]
  )).rows[0];
  assert.equal(proposal.action_id,A);
  assert.match(proposal.approval_fingerprint,/^[a-f0-9]{64}$/);
  assert.match(proposal.idempotency_key,/^[0-9a-f-]{36}$/);
  assert.equal(proposal.reply_length,'Спасибо за обратную связь'.length);

  const action=(await db.query(
    'select status,approval_fingerprint,idempotency_key from public.review_reply_actions where id=$1',
    [A]
  )).rows[0];
  assert.equal(action.status,'DRAFT');
  assert.equal(action.approval_fingerprint,proposal.approval_fingerprint);
  assert.equal(action.idempotency_key,proposal.idempotency_key);
});

test('editing exact reply text invalidates prepared approval',async t=>{
  const db=await setup(t);
  const proposal=(await db.query(
    `select * from public.review_admin_prepare_reply_approval_scoped(
      $1,$2,$3,$4,$5,$6,$7
    )`,
    [A,R,C,L,'54309413522','yandex',600]
  )).rows[0];

  await db.query(
    "update public.review_reply_actions set reply_text='Изменённый текст' where id=$1",
    [A]
  );
  const action=(await db.query(
    'select status,approval_fingerprint,approval_expires_at,idempotency_key from public.review_reply_actions where id=$1',
    [A]
  )).rows[0];
  assert.equal(action.status,'DRAFT');
  assert.equal(action.approval_fingerprint,null);
  assert.equal(action.approval_expires_at,null);
  assert.equal(action.idempotency_key,null);

  await assert.rejects(
    db.query(
      `select * from public.review_admin_approve_reply_scoped(
        $1,$2,$3,$4,$5,$6,$7
      )`,
      [A,R,C,L,'54309413522','yandex',proposal.approval_fingerprint]
    ),
    /REPLY_APPROVAL_EXPIRED/
  );
});

test('explicit approve moves only the selected action to QUEUED',async t=>{
  const db=await setup(t);
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

  assert.equal(queued.action_id,A);
  assert.equal(queued.status,'QUEUED');
  assert.equal(queued.idempotency_key,proposal.idempotency_key);

  const review=(await db.query(
    'select reply_state from public.review_external_reviews where id=$1',[R]
  )).rows[0];
  assert.equal(review.reply_state,'QUEUED');
});

test('queued action can be cancelled back to DRAFT before send',async t=>{
  const db=await setup(t);
  const proposal=(await db.query(
    `select * from public.review_admin_prepare_reply_approval_scoped(
      $1,$2,$3,$4,$5,$6,$7
    )`,
    [A,R,C,L,'54309413522','yandex',600]
  )).rows[0];
  await db.query(
    `select * from public.review_admin_approve_reply_scoped(
      $1,$2,$3,$4,$5,$6,$7
    )`,
    [A,R,C,L,'54309413522','yandex',proposal.approval_fingerprint]
  );
  const cancelled=(await db.query(
    `select public.review_admin_cancel_queued_reply_scoped(
      $1,$2,$3,$4,$5,$6
    ) ok`,
    [A,R,C,L,'54309413522','yandex']
  )).rows[0];
  assert.equal(cancelled.ok,true);

  const action=(await db.query(
    'select status,approval_fingerprint,idempotency_key from public.review_reply_actions where id=$1',
    [A]
  )).rows[0];
  assert.deepEqual(action,{
    status:'DRAFT',approval_fingerprint:null,idempotency_key:null
  });
  const review=(await db.query(
    'select reply_state from public.review_external_reviews where id=$1',[R]
  )).rows[0];
  assert.equal(review.reply_state,'DRAFT');
});
