// Explicit operator run only. Fixed Asbest DEV scope; no scheduler or Yandex writes.
import { createYandexSessionService } from '../lib/server/yandex-session/service.js';
import { createSessionStore } from '../lib/server/yandex-session/store.js';
import { keyringFromEnv } from '../lib/server/yandex-session/crypto.js';
import { createReviewPersistenceWriter } from '../lib/server/review-persistence-writer.js';

const scope = {
  organizationId: '54309413522',
  companyId: '13f3cb80-487a-4a19-96a1-fb3103200230',
  locationId: '9a95f63b-18e6-447b-a449-8530b67ddbae'
};
const replay = process.argv.length === 3 && process.argv[2] === '--replay';
if (process.argv.length !== 2 && !replay) {
  process.stdout.write(JSON.stringify({ ok: false, error: 'ARGUMENTS_FORBIDDEN' }) + '\n');
  process.exit(1);
}

try {
  const store = createSessionStore();
  const service = createYandexSessionService({
    store,
    keyring: keyringFromEnv(),
    allowRead: true,
    persistenceWriter: createReviewPersistenceWriter(),
    notify: async () => 'MOCKED_NO_DELIVERY'
  });
  const result = await service.run(scope, {
    mode: 'persist', pageBase: 1, maxPages: 4,
    persistenceExpected: replay ? 'same' : 'empty'
  });
  const persistence = result.persistenceResult;
  const expected = replay ? { inserted: 0, updated: 0, unchanged: 67, seen: 67 } :
    { inserted: 67, updated: 0, unchanged: 0, seen: 67 };
  const exact = result.ok && result.pagesFetched === 4 && result.seen === 67 && persistence &&
    persistence.inserted === expected.inserted && persistence.updated === expected.updated &&
    persistence.unchanged === expected.unchanged && persistence.seen === expected.seen;
  const safe = result.ok ? {
    ok: Boolean(exact), state: result.state, revision: result.revision,
    mode: 'persist', pagesFetched: result.pagesFetched, seen: result.seen,
    persistence: persistence ? {
      inserted: persistence.inserted, updated: persistence.updated,
      unchanged: persistence.unchanged, seen: persistence.seen,
      preexistingSameScope: persistence.preexistingSameScope
    } : null,
    scheduler: 'PAUSED', reviewPersistence: result.reviewPersistence
  } : { ok: false, state: result.state, revision: result.revision, errorCode: result.errorCode };
  process.stdout.write(JSON.stringify(safe) + '\n');
  if (!exact) process.exitCode = 1;
} catch {
  process.stdout.write(JSON.stringify({ ok: false, error: 'PERSISTENCE_RUN_STOPPED' }) + '\n');
  process.exitCode = 1;
}
