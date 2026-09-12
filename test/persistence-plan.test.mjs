import assert from 'node:assert/strict';
import test from 'node:test';
import { planReviewPersistence } from '../lib/server/review-persistence-plan.js';
import { createYandexPageNumbering, YANDEX_DEFAULT_PAGE_BASE, YANDEX_PAGE_BASE_STATUS } from '../lib/providers/yandex.js';
const row = () => ({
  company_id: '11111111-1111-4111-8111-111111111111',
  location_id: '22222222-2222-4222-8222-222222222222',
  external_location_id: 'fixture-location', provider: 'yandex', external_review_id: 'same-id',
  review_text: 'first'
});
test('same scoped duplicate is deterministic and plan never enables writes', () => {
  const input = row();
  const plan = planReviewPersistence([input, { ...input, review_text: 'second' }], [input]);
  assert.equal(plan.persistenceEnabled, false);
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0].kind, 'update_same_scope');
  assert.equal(plan.operations[0].row.review_text, 'first');
  assert.notEqual(plan.operations[0].row, input);
});
test('different company/location with same provider ID fails whole plan; no cross-company mutation', () => {
  for (const field of ['company_id', 'location_id', 'external_location_id']) {
    const a = row(), b = { ...a, [field]: '33333333-3333-4333-8333-333333333333' };
    const original = structuredClone(a);
    assert.throws(() => planReviewPersistence([b], [a]), { code: 'REVIEW_SCOPE_COLLISION' });
    assert.throws(() => planReviewPersistence([a, b]), { code: 'REVIEW_SCOPE_COLLISION' });
    assert.deepEqual(a, original);
  }
});
test('different providers are distinct, never deduped together', () => {
  const plan = planReviewPersistence([row(), { ...row(), provider: '2gis' }]);
  assert.equal(plan.operations.length, 2);
  assert.equal(plan.operations.every(x => x.kind === 'insert'), true);
});
test('missing scope and contradictory existing snapshot fail closed', () => {
  assert.throws(() => planReviewPersistence(null), { code: 'REVIEW_ROWS_REQUIRED' });
  assert.throws(() => planReviewPersistence([{ ...row(), location_id: null }]), { code: 'REVIEW_SCOPE_REQUIRED' });
  assert.throws(() => planReviewPersistence([row()], [row(), row()]), { code: 'REVIEW_EXISTING_CONTRACT_DRIFT' });
});
test('page-base assumption is centralized, configurable and explicitly unconfirmed', () => {
  assert.equal(YANDEX_DEFAULT_PAGE_BASE, 1);
  assert.equal(YANDEX_PAGE_BASE_STATUS, 'PAGE BASE LIVE CONFIRMATION PENDING');
  for (const base of [0, 1]) {
    const adapter = createYandexPageNumbering(base);
    assert.equal(adapter.status, YANDEX_PAGE_BASE_STATUS);
    assert.deepEqual([0, 1, 2].map(i => adapter.pageAt(i)), [base, base + 1, base + 2]);
    assert.equal(Object.isFrozen(adapter), true);
    for (const bad of [-1, null, '0', 0.5, Infinity]) assert.throws(() => adapter.pageAt(bad), { code: 'YANDEX_PAGE_INDEX_INVALID' });
  }
  for (const bad of [-1, 2, null, '0', true]) assert.throws(() => createYandexPageNumbering(bad), { code: 'YANDEX_PAGE_BASE_INVALID' });
});
