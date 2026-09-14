import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  normalizeYandexReview, parseYandexReviewsPayload, fetchYandexReviews,
  dedupeYandexReviews, toReviewExternalReview, inspectYandexReviewsPayload,
  diagnoseYandexReviewsPayload
} from '../lib/providers/yandex.js';

const location = '54309413522';
const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/yandex/${name}.json`, import.meta.url), 'utf8'));
const item = () => fixture('single-review').list.items[0];
const scope = {
  companyId: '11111111-1111-4111-8111-111111111111',
  locationId: '22222222-2222-4222-8222-222222222222',
  observedAt: '2026-09-12T10:00:00Z'
};
const errorCode = code => error => error.code === code && error.message === code;
const drift = fn => assert.throws(fn, errorCode('YANDEX_CONTRACT_DRIFT'));

test('full live shape: numeric Unix milliseconds preserve precision and public_rating stays boolean',()=>{
  for(const publicRating of [true,false]){
    const payload=fixture('live-shape-milliseconds');
    payload.list.items[0].public_rating=publicRating;
    const [review]=parseYandexReviewsPayload(payload,location).reviews;
    assert.equal(review.publishedAt,'2025-01-01T00:00:00.123Z');
    assert.equal(review.rawPayload.time_created,1735689600123);
    assert.equal(review.rawPayload.public_rating,publicRating);
    assert.equal(typeof review.rawPayload.public_rating,'boolean');
    assert.equal(review.rawPayload.id,review.rawPayload.cmnt_entity_id);
    const projected=toReviewExternalReview(review,scope);
    assert.equal(projected.published_at,review.publishedAt);
    assert.equal(projected.raw_payload.public_rating,publicRating);
  }
});

test('1 list.items item -> 1 normalized review; ID, author, rating, text, UTC time', () => {
  const parsed = parseYandexReviewsPayload(fixture('single-review'), location);
  assert.equal(parsed.reviews.length, 1);
  const [review] = parsed.reviews;
  assert.equal(review.provider, 'yandex');
  assert.equal(review.externalReviewId, 'fixture-review-001');
  assert.equal(review.externalLocationId, location);
  assert.equal(review.authorName, 'Гость 001');
  assert.equal(review.rating, 5);
  assert.equal(review.reviewText, item().full_text);
  assert.equal(review.publishedAt, '2026-09-01T10:00:00.000Z');
  assert.deepEqual(parsed.pagination, { limit: 20, offset: 0, total: 1, hasMore: false });
});

test('canonical ID is id, fallback cmnt_entity_id; preserve both and provenance', () => {
  const input = item();
  input.cmnt_entity_id = 'different-entity';
  input.externalReviewId = 'untrusted-legacy-alias';
  const normalized = normalizeYandexReview(input);
  assert.equal(normalized.externalReviewId, input.id);
  assert.equal(normalized.rawPayload.id, input.id);
  assert.equal(normalized.rawPayload.cmnt_entity_id, 'different-entity');
  assert.equal(normalized.rawPayload.external_id_source, 'id');
  delete input.id;
  const fallback = normalizeYandexReview(input);
  assert.equal(fallback.externalReviewId, 'different-entity');
  assert.equal(fallback.rawPayload.external_id_source, 'cmnt_entity_id');
  input.cmnt_entity_id = null;
  drift(() => normalizeYandexReview(input));
});

test('malformed or unsafe IDs are never coerced or replaced with an author ID', () => {
  for (const bad of [true, {}, [], Number.MAX_SAFE_INTEGER + 1]) {
    drift(() => normalizeYandexReview({ ...item(), id: bad }));
  }
  assert.equal(normalizeYandexReview({ ...item(), id: 123 }).externalReviewId, '123');
});

test('owner reply is preserved without implying a write/publish status', () => {
  const [review] = parseYandexReviewsPayload(fixture('owner-comment'), location).reviews;
  assert.deepEqual(review.ownerReply, {
    text: 'Тестовый ответ: спасибо за обратную связь.',
    publishedAt: '2026-09-02T11:00:00.000Z',
    moderationStatus: 'approved'
  });
  assert.equal(review.rawPayload.owner_comment.moderation_status, 'approved');
  assert.equal(review.rawPayload.owner_comment.time_created, '2026-09-02T11:00:00Z');
  const original = fixture('owner-comment').list.items[0];
  original.owner_comment.moderation_status = 'future-enum';
  assert.equal(normalizeYandexReview(original).ownerReply.moderationStatus, 'future-enum');
  assert.equal(Object.hasOwn(review, 'replyState'), false);
});

test('rating-only/anonymous review and explicit null timestamp are supported', () => {
  const review = normalizeYandexReview({ ...item(), full_text: null, author: { user: null }, time_created: null });
  assert.equal(review.reviewText, null);
  assert.equal(review.authorName, null);
  assert.equal(review.publishedAt, null);
  assert.equal(review.ownerReply, null);
});

test('timestamps: explicit UTC/offset, seconds, milliseconds and numeric strings; retain source type', () => {
  const milliseconds = Date.parse('2026-09-01T10:00:00Z');
  for (const value of [milliseconds / 1000, milliseconds, String(milliseconds / 1000), String(milliseconds), '2026-09-01T15:00:00+05:00']) {
    const review = normalizeYandexReview({ ...item(), time_created: value });
    assert.equal(review.publishedAt, '2026-09-01T10:00:00.000Z');
    assert.equal(review.rawPayload.time_created, value);
  }
  for (const bad of [true, {}, [], '', 'yesterday', '2026-02-30T10:00:00Z', '2026-09-01T24:00:00Z', '2026-09-01T10:00:00', -1, Infinity]) {
    drift(() => normalizeYandexReview({ ...item(), time_created: bad }));
  }
});

test('public_rating primitive types remain opaque pending type confirmation', () => {
  for (const value of [null, 5, 4.75, '5', true, false]) {
    assert.equal(normalizeYandexReview({ ...item(), public_rating: value }).rawPayload.public_rating, value);
  }
  for (const value of [{}, [], Infinity]) drift(() => normalizeYandexReview({ ...item(), public_rating: value }));
});

test('contract drift: broken/missing/legacy envelope fails instead of returning []', () => {
  for (const value of [fixture('broken-schema'), {}, null, [], '<html>login</html>', { items: [] }, { reviews: { items: [] } }, { data: fixture('empty') }]) {
    drift(() => parseYandexReviewsPayload(value, location));
  }
  const errorPayload = fixture('empty');
  errorPayload.error = 'synthetic error';
  drift(() => parseYandexReviewsPayload(errorPayload));
});

test('contract diagnostic reports safe schema and exact parser field without values', () => {
  const payload = fixture('single-review');
  payload.list.items[0].full_text = 'synthetic-secret-review-text';
  payload.list.items[0].author.user = 'synthetic-secret-author';
  const report = diagnoseYandexReviewsPayload(payload, location);
  assert.equal(report.ok, true);
  assert.deepEqual(report.parser, { code: null, failure_point: null });
  assert.deepEqual(report.pagination, { limit: 20, offset: 0, total: 1, hasMore: false });
  assert.equal(report.schema.fields['full_text'].types.string, 1);
  assert.equal(report.schema.fields['author.user'].types.string, 1);
  assert.equal(JSON.stringify(report).includes('synthetic-secret'), false);

  const broken = fixture('broken-schema');
  const driftReport = diagnoseYandexReviewsPayload(broken, location);
  assert.equal(driftReport.ok, false);
  assert.deepEqual(driftReport.parser, { code: 'YANDEX_CONTRACT_DRIFT', failure_point: 'list.items' });
  assert.deepEqual(driftReport.schema.item_keys, []);
  assert.equal(Object.hasOwn(driftReport, 'raw_payload'), false);
});

test('contract diagnostic schema counts unknown keys without exposing their names', () => {
  const payload = fixture('single-review');
  payload.extra = 'synthetic-secret-top-level';
  payload.list.items[0].unexpected = 'synthetic-secret-item';
  const schema = inspectYandexReviewsPayload(payload);
  assert.deepEqual(schema.unexpected_keys.top_level, ['UNRECOGNIZED_KEY']);
  assert.deepEqual(schema.unexpected_keys.item, ['UNRECOGNIZED_KEY']);
  assert.equal(schema.unexpected_key_counts.top_level,1);
  assert.equal(schema.unexpected_key_counts.item,1);
  assert.equal(JSON.stringify(schema).includes('synthetic-secret'), false);
});

test('required item fields and malformed owner/author shapes fail explicitly', () => {
  for (const key of ['author', 'full_text', 'rating', 'time_created']) {
    const input = item(); delete input[key];
    drift(() => normalizeYandexReview(input));
  }
  for (const author of [{}, { user: { name: 'unsupported object' } }, []]) {
    drift(() => normalizeYandexReview({ ...item(), author }));
  }
  for (const owner_comment of [{}, { text: 'partial' }, []]) {
    drift(() => normalizeYandexReview({ ...item(), owner_comment }));
  }
  const withOwner = fixture('owner-comment').list.items[0];
  for (const status of [{}, [], true, 1.5]) {
    drift(() => normalizeYandexReview({ ...withOwner, owner_comment: { ...withOwner.owner_comment, moderation_status: status } }));
  }
  for (const rating of [true, null, {}, '', 0, 6, NaN]) drift(() => normalizeYandexReview({ ...item(), rating }));
  assert.equal(normalizeYandexReview({ ...item(), rating: '5' }).rating, 5);
});

test('empty list is successful only with a valid empty pager', async () => {
  const parsed = parseYandexReviewsPayload(fixture('empty'));
  assert.deepEqual(parsed.reviews, []);
  assert.equal(parsed.pagination.hasMore, false);
  let calls = 0;
  assert.deepEqual(await fetchYandexReviews({ permanentId: location, transport: async () => { calls++; return fixture('empty'); } }), []);
  assert.equal(calls, 1);
  const truncated = fixture('empty'); truncated.list.pager.total = 67;
  drift(() => parseYandexReviewsPayload(truncated));
});

test('invalid pager fields and incomplete pages are rejected', () => {
  for (const change of [{ limit: 0 }, { offset: -1 }, { total: -1 }, { total: '1' }, { total: true }, { offset: 99 }]) {
    const input = fixture('single-review'); Object.assign(input.list.pager, change);
    drift(() => parseYandexReviewsPayload(input));
  }
  const input = fixture('page-1'); input.list.items.pop();
  drift(() => parseYandexReviewsPayload(input));
});

test('pagination uses page=1/2 and total; exact fixed read URL with no cursor', async () => {
  const calls = [];
  const reviews = await fetchYandexReviews({ permanentId: location, transport: async request => {
    calls.push(request);
    return fixture(`page-${request.page}`);
  } });
  assert.equal(reviews.length, 3);
  assert.deepEqual(calls.map(c => c.page), [1, 2]);
  for (const request of calls) {
    assert.equal(request.method, 'GET');
    assert.equal(request.permanentId, location);
    assert.equal(request.url, `https://yandex.ru/sprav/api/${location}/reviews?ranking=by_time&source=pagination&page=${request.page}`);
    assert.equal(Object.hasOwn(request, 'continueToken'), false);
  }
});

test('explicit zero-based page mode still requires offset=0 then advances', async () => {
  const pages = [];
  const reviews = await fetchYandexReviews({ permanentId: location, pageBase: 0, transport: async ({ page }) => {
    pages.push(page); return fixture(`page-${page + 1}`);
  } });
  assert.deepEqual(pages, [0, 1]);
  assert.equal(reviews.length, 3);
});

test('duplicates across pages: first occurrence wins, paging counts raw items not uniques', async () => {
  const reviews = await fetchYandexReviews({ permanentId: location, transport: async ({ page }) => {
    if (page === 2) return fixture('duplicate-page-2');
    const first = fixture('page-1'); first.list.pager.total = 4; return first;
  } });
  assert.equal(reviews.length, 3);
  assert.equal(reviews[1].reviewText, 'Тестовая вторая запись.');
  const a = normalizeYandexReview(item(), 'location-a');
  const b = normalizeYandexReview(item(), 'location-b');
  assert.equal(dedupeYandexReviews([a, a, b]).length, 2);
});

test('repeated offset, first-page offset, changed total/limit fail without partial success', async () => {
  const first = fixture('page-1');
  await assert.rejects(fetchYandexReviews({ permanentId: location, transport: async () => first }), errorCode('YANDEX_PAGINATION_CHANGED'));
  await assert.rejects(fetchYandexReviews({ permanentId: location, transport: async () => fixture('page-2') }), errorCode('YANDEX_PAGINATION_CHANGED'));
  for (const change of [{ total: 4, limit: 1 }, { limit: 1 }]) {
    await assert.rejects(fetchYandexReviews({ permanentId: location, transport: async ({ page }) => {
      const data = fixture(`page-${page}`); if (page === 2) Object.assign(data.list.pager, change); return data;
    } }), errorCode('YANDEX_PAGINATION_CHANGED'));
  }
});

test('page limit exhaustion is explicit failure; bad options never call a transport', async () => {
  await assert.rejects(fetchYandexReviews({ permanentId: location, maxPages: 1, transport: async () => fixture('page-1') }), errorCode('YANDEX_PAGINATION_LIMIT_EXCEEDED'));
  let calls = 0;
  const transport = async () => { calls++; return fixture('empty'); };
  for (const maxPages of [0, -1, 101, '2', NaN]) {
    await assert.rejects(fetchYandexReviews({ permanentId: location, maxPages, transport }), errorCode('YANDEX_MAX_PAGES_INVALID'));
  }
  await assert.rejects(fetchYandexReviews({ permanentId: location, pageBase: 2, transport }), errorCode('YANDEX_PAGE_BASE_INVALID'));
  await assert.rejects(fetchYandexReviews({ permanentId: location }), errorCode('YANDEX_AUTHORIZED_TRANSPORT_NOT_CONFIGURED'));
  await assert.rejects(fetchYandexReviews({ transport }), errorCode('YANDEX_PERMANENT_ID_REQUIRED'));
  assert.equal(calls, 0);
});

test('drift on page 2 rejects the entire fetch rather than returning page 1', async () => {
  await assert.rejects(fetchYandexReviews({ permanentId: location, transport: async ({ page }) => fixture(page === 1 ? 'page-1' : 'broken-schema') }), errorCode('YANDEX_CONTRACT_DRIFT'));
});

test('metadata allowlist drops nested credentials and envelope data; no raw logging', async t => {
  const logs = [];
  for (const name of ['log', 'warn', 'error']) t.mock.method(console, name, (...args) => logs.push(args));
  const input = item();
  input.cookies = 'synthetic-sensitive-marker';
  input.session = { authorization: 'synthetic-sensitive-marker' };
  input.author.session = 'synthetic-sensitive-marker';
  const payload = fixture('single-review'); payload.list.items = [input];
  payload.session = 'synthetic-sensitive-marker';
  const normalized = parseYandexReviewsPayload(payload, location).reviews[0];
  assert.equal(JSON.stringify(normalized).includes('synthetic-sensitive-marker'), false);
  assert.notEqual(normalized.rawPayload, input);
  assert.equal(normalized.rawPayload.contract_version, 'business-list-v1');
  await assert.rejects(fetchYandexReviews({ permanentId: location, transport: async () => {
    throw Object.assign(new Error('synthetic-sensitive-marker'), { details: input, headers: input.session });
  } }), error => {
    assert.equal(error.code, 'YANDEX_TRANSPORT_FAILED');
    assert.equal(JSON.stringify(error).includes('synthetic-sensitive-marker'), false);
    assert.equal(error.stack.includes('synthetic-sensitive-marker'), false);
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.deepEqual(logs, []);
});

test('storage projection targets verified columns, preserves reply workflow and source types', () => {
  const review = parseYandexReviewsPayload(fixture('owner-comment'), location).reviews[0];
  const row = toReviewExternalReview(review, scope);
  assert.deepEqual(Object.keys(row).sort(), [
    'company_id', 'location_id', 'provider', 'external_review_id', 'external_location_id',
    'author_name', 'rating', 'review_text', 'published_at', 'observed_at', 'owner_reply_text',
    'owner_replied_at', 'raw_payload'
  ].sort());
  assert.equal(row.company_id, scope.companyId);
  assert.equal(row.location_id, scope.locationId);
  assert.equal(row.observed_at, '2026-09-12T10:00:00.000Z');
  assert.equal(row.owner_replied_at, '2026-09-02T11:00:00.000Z');
  assert.equal(row.raw_payload.owner_comment.moderation_status, 'approved');
  assert.equal(row.raw_payload.time_created, '2026-09-01T10:00:00Z');
  assert.equal(Object.hasOwn(row, 'reply_state'), false);
  assert.equal(Object.hasOwn(row, 'owner_reply_external_id'), false);
  row.raw_payload.owner_comment.text = 'changed copy';
  assert.notEqual(row.raw_payload.owner_comment.text, review.rawPayload.owner_comment.text);
});

test('storage projection rejects missing/invalid tenant, location and observation context', () => {
  const review = normalizeYandexReview(item(), location);
  assert.throws(() => toReviewExternalReview(review), errorCode('YANDEX_COMPANY_SCOPE_REQUIRED'));
  assert.throws(() => toReviewExternalReview(review, { ...scope, locationId: null }), errorCode('YANDEX_LOCATION_SCOPE_REQUIRED'));
  assert.throws(() => toReviewExternalReview(normalizeYandexReview(item()), scope), errorCode('YANDEX_LOCATION_SCOPE_REQUIRED'));
  assert.throws(() => toReviewExternalReview(review, { ...scope, observedAt: null }), errorCode('YANDEX_OBSERVED_AT_REQUIRED'));
});
