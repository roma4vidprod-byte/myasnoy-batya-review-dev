import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const fixture = readFileSync(new URL('../scripts/sql/yandex-live-smoke-01-fixture.sql',import.meta.url),'utf8');

test('Asbest DEV fixture is atomic, minimal, isolated and refuses reuse/active scheduler', async t => {
  const db = await PGlite.create(); t.after(() => db.close());
  // Exact relevant columns/defaults/constraints from DEV catalog on 2026-09-12.
  await db.exec(`
    create schema cron;
    create table cron.job(jobname text,active boolean);
    insert into cron.job values ('review-provider-due-check-hourly',false);
    create table review_companies(
      id uuid primary key default gen_random_uuid(),slug text not null unique,name text not null,
      gift_name text,technical_email text,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
    );
    create table review_locations(
      id uuid primary key default gen_random_uuid(),company_id uuid not null references review_companies(id) on delete cascade,
      name text not null,city text not null,address text not null,phone text,yandex_review_url text,twogis_review_url text,
      active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
      unique(id,company_id)
    );
    with c as (insert into review_companies(slug,name) values ('unrelated','Existing fixture') returning id)
      insert into review_locations(company_id,name,city,address) select id,'Unrelated','Other city','Other address' from c;
  `);
  const before = (await db.query('select to_jsonb(c) company,to_jsonb(l) location from review_companies c join review_locations l on c.id=l.company_id')).rows;
  await t.test('active scheduler prevents fixture creation', async () => {
    await db.exec('update cron.job set active=true');
    await assert.rejects(db.exec(fixture), /SMOKE_REQUIRES_PAUSED_SCHEDULER/);
    await db.exec('rollback; update cron.job set active=false');
    assert.equal((await db.query('select count(*)::int n from review_companies')).rows[0].n,1);
  });
  await t.test('only one new company and inactive Asbest location; no contact/public URL guesses', async () => {
    await db.exec(fixture);
    const row = (await db.query("select c.id company_id,l.company_id location_company,l.id location_id,c.name company_name,l.name,l.city,l.address,l.active,c.gift_name,c.technical_email,l.phone,l.yandex_review_url,l.twogis_review_url from review_companies c join review_locations l on l.company_id=c.id where c.slug='review-dev-yandex-smoke-01-asbest'")).rows[0];
    assert.equal(row.company_id,row.location_company); assert.notEqual(row.company_id,row.location_id);
    assert.match(row.company_name,/DEV SYNTHETIC/); assert.match(row.name,/DEV SYNTHETIC.*54309413522/);
    assert.equal(row.city,'Асбест'); assert.equal(row.address,'Ленинградская 41А'); assert.equal(row.active,false);
    for (const key of ['gift_name','technical_email','phone','yandex_review_url','twogis_review_url']) assert.equal(row[key],null);
    assert.deepEqual((await db.query("select to_jsonb(c) company,to_jsonb(l) location from review_companies c join review_locations l on c.id=l.company_id where c.slug='unrelated'")).rows,before);
  });
  await t.test('replay refuses duplicate scope without changing original UUIDs or other company', async () => {
    const beforeReplay = (await db.query('select to_jsonb(c) company,to_jsonb(l) location from review_companies c join review_locations l on c.id=l.company_id order by c.id')).rows;
    await assert.rejects(db.exec(fixture),/ASBEST_SCOPE_ALREADY_EXISTS_REVIEW_REQUIRED/); await db.exec('rollback');
    assert.deepEqual((await db.query('select to_jsonb(c) company,to_jsonb(l) location from review_companies c join review_locations l on c.id=l.company_id order by c.id')).rows,beforeReplay);
  });
});
