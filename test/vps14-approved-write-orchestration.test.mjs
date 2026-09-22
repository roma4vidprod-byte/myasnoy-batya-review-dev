import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const writer=readFileSync(new URL('../tools/vps14/writer-approved-once.mjs',import.meta.url),'utf8');
const bridge=readFileSync(new URL('../tools/vps14/vdsina-reply-approved-bridge.cjs',import.meta.url),'utf8');
const starter=readFileSync(new URL('../scripts/start-yandex-approved-write.ps1',import.meta.url),'utf8');

test('stage9 writer is exact-action, exact-review and handoff bound',()=>{
  for(const value of [
    'RA_STAGE9_ACTION_ID','RA_STAGE9_REVIEW_ID','RA_STAGE9_FINGERPRINT',
    'RA_STAGE9_IDEMPOTENCY_KEY','actionId:action','assertCsrfSessionBinding',
    'claim.actionId!==action','claim.externalReviewId!==review',
    'claim.idempotencyKey!==idempotency','claim.approvalFingerprint!==fingerprint',
    "execute.op!=='execute'",'reviewId!==review'
  ]) assert.ok(writer.includes(value),value);
  assert.ok(writer.indexOf("const execute=await readJsonLine")<
    writer.indexOf('const result=await runYandexReplyOnce'));
});

test('stage9 bridge is one-shot credentialed network runtime for the exact package',()=>{
  for(const value of [
    'bd961975-5f88-44b6-b6b6-19ae626199b4',
    'pYsoi9xLPVyvlP5aiXNdI-oUAYxJI0',
    'fd3cec79843a55631abc7fb81d8fc70a33a0ae18a5ed76f78c453f02d1bfcd08',
    '703eafa5-be32-4480-9909-fd50a1a2b20b',
    'LoadCredential=yandex-session-key:/etc/review-activator-yandex/session-key.json',
    'RA_YANDEX_MODE=reply-write-one-shot','RA_YANDEX_REPLY_WRITE_ENABLED=true',
    "'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6'",'writer-approved-once.mjs'
  ]) assert.ok(bridge.includes(value),value);
  assert.equal(bridge.includes('PrivateNetwork=yes'),false);
});

test('stage9 local controller has a second explicit gate and no retry on ambiguity',()=>{
  assert.ok(starter.includes("-cne 'EXECUTE_APPROVED'"));
  assert.ok(starter.includes('$executionReleased=$true'));
  assert.ok(starter.includes('STAGE9_RESULT_UNKNOWN_NO_RETRY'));
  assert.ok(starter.includes('STAGE9_STOPPED_BEFORE_EXECUTE'));
  assert.ok(starter.includes('STAGE9_ONE_POST_CONFIRMED'));
});

test('stage9 writer fails safely before network outside writer account',()=>{
  const env={...process.env,RA_RUNTIME_PROFILE:'vps-lab',
    RA_YANDEX_MODE:'reply-write-one-shot',RA_YANDEX_REPLY_WRITE_ENABLED:'true',
    RA_STAGE9_ACTION_ID:'bd961975-5f88-44b6-b6b6-19ae626199b4',
    RA_STAGE9_REVIEW_ID:'pYsoi9xLPVyvlP5aiXNdI-oUAYxJI0',
    RA_STAGE9_FINGERPRINT:'fd3cec79843a55631abc7fb81d8fc70a33a0ae18a5ed76f78c453f02d1bfcd08',
    RA_STAGE9_IDEMPOTENCY_KEY:'703eafa5-be32-4480-9909-fd50a1a2b20b'};
  const out=spawnSync(process.execPath,
    [fileURLToPath(new URL('../tools/vps14/writer-approved-once.mjs',import.meta.url))],
    {env,encoding:'utf8',timeout:5000});
  assert.equal(out.stderr,'');
  const line=JSON.parse(out.stdout.trim());
  assert.equal(line.ok,false);
  assert.equal(line.error,'STAGE9_CONTEXT_INVALID');
});
