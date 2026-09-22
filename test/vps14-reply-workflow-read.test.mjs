import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const sql=readFileSync(new URL('../tools/vps14/reply-workflow-read.sql',import.meta.url),'utf8');
const C='13f3cb80-487a-4a19-96a1-fb3103200230';
const L='9a95f63b-18e6-447b-a449-8530b67ddbae';
const R='11111111-1111-4111-8111-111111111111';
const A='22222222-2222-4222-8222-222222222222';

test('Stage12 workflow read is exact-scope, admin-gated and network-free',()=>{
  for(const value of [
    'review_admin_reply_workflow_scoped','review_is_admin()',
    'vps_lab_private.has_company(p_company_id)',C,L,'54309413522',
    "p_provider is distinct from 'yandex'","ra.status<>'CANCELLED'",
    'approval_fingerprint','idempotency_key','approval_expires_at','attempt_count'
  ])assert.ok(sql.includes(value),value);
  assert.doesNotMatch(sql,/https?:\/\//i);
  assert.doesNotMatch(sql,/fetch\s*\(/i);
  assert.doesNotMatch(sql,/\binsert\s+into\b|\bupdate\s+public\.|\bdelete\s+from\b/i);
});
async function setup(t){
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema vps_lab_private;
    create table public.review_locations(id uuid primary key,company_id uuid,name text);
    create table public.review_external_reviews(
      id uuid primary key,company_id uuid,location_id uuid,provider text,
      external_location_id text,external_review_id text,author_name text,rating numeric,
      review_text text,published_at timestamptz,owner_reply_text text,
      owner_replied_at timestamptz,reply_state text,observed_at timestamptz
    );
    create table public.review_reply_actions(
      id uuid primary key,external_review_row_id uuid,reply_text text,draft_source text,
      status text,approval_fingerprint text,approval_expires_at timestamptz,
      idempotency_key uuid,approved_at timestamptz,last_error text,attempt_count integer,
      sent_at timestamptz,finished_at timestamptz,updated_at timestamptz,created_at timestamptz
    );
    create function public.review_is_admin() returns boolean language sql stable as 'select true';
    create function vps_lab_private.has_company(uuid) returns boolean language sql stable as 'select true';
  `);
  return db;
}
test('Stage12 workflow read returns exact latest non-cancelled action metadata',async t=>{
  const db=await setup(t);
  await db.exec(`
    insert into public.review_locations values('9a95f63b-18e6-447b-a449-8530b67ddbae','13f3cb80-487a-4a19-96a1-fb3103200230','Асбест');
    insert into public.review_external_reviews values(
      '11111111-1111-4111-8111-111111111111','13f3cb80-487a-4a19-96a1-fb3103200230','9a95f63b-18e6-447b-a449-8530b67ddbae','yandex','54309413522','external-1','Ксения',5,
      'Отлично',now(),null,null,'QUEUED',now()
    );
    insert into public.review_reply_actions values(
      '22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','Точный ответ','human','QUEUED','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      now()+interval '10 minutes','33333333-3333-4333-8333-333333333333',
      now(),null,0,null,null,now(),now()
    );
    insert into public.review_reply_actions values(
      '44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','Старый','human','CANCELLED',
      null,null,null,null,null,0,null,null,now()+interval '1 minute',now()+interval '1 minute'
    );
  `);
  await db.exec(sql);
  const row=(await db.query(`
    select reply_action_id,reply_action_text,reply_action_status,
      approval_fingerprint,idempotency_key,total_count
    from public.review_admin_reply_workflow_scoped(
      $1,$2,$3,$4,null,null,false,20,0
    )
  `,[C,L,'54309413522','yandex'])).rows[0];
  assert.equal(row.reply_action_id,A);
  assert.equal(row.reply_action_text,'Точный ответ');
  assert.equal(row.reply_action_status,'QUEUED');
  assert.equal(row.approval_fingerprint,'a'.repeat(64));
  assert.equal(row.idempotency_key,'33333333-3333-4333-8333-333333333333');
  assert.equal(Number(row.total_count),1);
});
