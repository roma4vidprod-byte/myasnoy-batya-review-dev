import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const session=source('tools/vps08a/session.mjs');
const pg=source('tools/vps08a/pg.mjs');
const service=source('lib/server/yandex-session/service.js');
const access=source('tools/vps10/persistence-current-revision.sql');
const provider=source('tools/vps10/provider_once.py');
const timer=source('tools/vps10/review-activator-yandex-sync.timer');

test('Stage11 runtime binds persistence to the current READY revision',()=>{
  assert.match(session,/persistenceRevision:Number\(row\.revision\)/);
  assert.match(session,/expectedRevision:Number\(row\.revision\)/);
  assert.match(pg,/const revision=persist\?persistenceRevision/);
  assert.doesNotMatch(pg,/persist_call\([^\n]+,4,/);
  assert.match(service,/Number\.isSafeInteger\(expectedRevision\)/);
  assert.doesNotMatch(service,/persist\?4:3/);
});

test('Stage11 request path omits only browser-expired cookies',()=>{
  assert.match(session,/decryptSessionForRequest/);
  assert.doesNotMatch(session,/decryptSessionClassified/);
});
test('Stage11 DB capability accepts the pinned current revision and only the reply-sync trigger',()=>{
  assert.match(access,/p_expected_revision is null or p_expected_revision < 1/);
  assert.match(access,/v_revision is distinct from p_expected_revision/);
  assert.match(access,/tgname<>'review_external_reviews_sync_reply_state'/);
  assert.doesNotMatch(access,/p_expected_revision is distinct from 4/);
});

test('Stage11 scheduler remains hourly, read-only toward Yandex and revision-agnostic',()=>{
  assert.match(timer,/OnCalendar=hourly/);
  assert.match(provider,/revision = session\['revision'\]/);
  assert.match(provider,/session_revision': revision/);
  assert.doesNotMatch(provider,/SESSION_NOT_READY_REV4|session_revision': 4/);
  assert.match(provider,/yandex_writes': 0/);
});
