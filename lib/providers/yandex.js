export const YANDEX_PROVIDER = 'yandex';
export const YANDEX_CONTRACT_VERSION = 'business-list-v1';
export const YANDEX_PAGE_BASE_STATUS = 'PAGE BASE LIVE CONFIRMATION PENDING';
export const YANDEX_DEFAULT_PAGE_BASE = 1;

// One configurable page-number adapter; no live inference or fallback retries.
export function createYandexPageNumbering(pageBase = YANDEX_DEFAULT_PAGE_BASE) {
  if (pageBase !== 0 && pageBase !== 1) fail('YANDEX_PAGE_BASE_INVALID');
  return Object.freeze({
    pageBase,
    status: YANDEX_PAGE_BASE_STATUS,
    pageAt(index) {
      if (!Number.isSafeInteger(index) || index < 0 || !Number.isSafeInteger(index + pageBase)) fail('YANDEX_PAGE_INDEX_INVALID');
      return pageBase + index;
    }
  });
}

function fail(code, field) {
  // Only developer-owned codes/field names; never attach input or transport errors.
  throw Object.assign(new Error(code), { code, ...(field ? { field } : {}) });
}

function drift(field) {
  fail('YANDEX_CONTRACT_DRIFT', field);
}

function record(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) drift(field);
  return value;
}

function required(value, key, field) {
  if (!Object.hasOwn(value, key)) drift(field);
  return value[key];
}

function nullableText(value, field) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') drift(field);
  return value.trim() || null;
}

function identifier(value, field) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) drift(field);
    return String(value);
  }
  return nullableText(value, field);
}

function integer(value, field, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) drift(field);
  return value;
}

function timestamp(value, field) {
  if (value === null) return null; // Compatibility; owner reply source units remain unconfirmed.
  let milliseconds;
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) drift(field);
    // Asbest full dry-run 03 confirmed review time_created = numeric Unix milliseconds.
    // Preserve millisecond precision. Seconds remain an explicit compatibility format;
    // do not infer owner_comment time units from the review field's live evidence.
    milliseconds = number < 100_000_000_000 ? number * 1000 : number;
  } else if (typeof value === 'string') {
    const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!parts) drift(field);
    const [, year, month, day, hour, minute, second] = parts.map(Number);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth) drift(field);
    if (hour > 23 || minute > 59 || second > 59) drift(field);
    milliseconds = Date.parse(value);
  } else {
    drift(field);
  }
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) drift(field);
  return date.toISOString();
}

function authorName(author) {
  if (author === null) return null;
  const user = required(record(author, 'author'), 'user', 'author.user');
  return nullableText(user, 'author.user');
}

function ownerReply(value) {
  if (value === null || value === undefined) return null;
  record(value, 'owner_comment');
  const text = nullableText(required(value, 'text', 'owner_comment.text'), 'owner_comment.text');
  const publishedAt = timestamp(required(value, 'time_created', 'owner_comment.time_created'), 'owner_comment.time_created');
  const status = required(value, 'moderation_status', 'owner_comment.moderation_status');
  if (status !== null && typeof status !== 'string' && !Number.isSafeInteger(status)) {
    drift('owner_comment.moderation_status');
  }
  // Preserve the provider enum; never infer PUBLISHED/SENT from an unknown enum.
  return { text, publishedAt, moderationStatus: status };
}

export function normalizeYandexReview(input, externalLocationId = null) {
  record(input, 'item');
  const id = identifier(input.id, 'id');
  const entityId = identifier(input.cmnt_entity_id, 'cmnt_entity_id');
  const externalReviewId = id ?? entityId;
  if (!externalReviewId) drift('id');
  const rawRating = required(input, 'rating', 'rating');
  const rating = typeof rawRating === 'string' && /^[1-5]$/.test(rawRating) ? Number(rawRating) : rawRating;
  integer(rating, 'rating', 1);
  if (rating > 5) drift('rating');

  const review = {
    provider: YANDEX_PROVIDER,
    externalReviewId,
    externalLocationId: identifier(externalLocationId, 'externalLocationId'),
    authorName: authorName(required(input, 'author', 'author')),
    rating,
    reviewText: nullableText(required(input, 'full_text', 'full_text'), 'full_text'),
    publishedAt: timestamp(required(input, 'time_created', 'time_created'), 'time_created'),
    ownerReply: ownerReply(input.owner_comment)
  };
  const commentsCount = input.comments_count == null ? null : integer(input.comments_count, 'comments_count');
  const lang = nullableText(input.lang, 'lang');
  const publicRating = input.public_rating ?? null;
  if (publicRating !== null && !['number', 'string', 'boolean'].includes(typeof publicRating)) drift('public_rating');
  if (typeof publicRating === 'number' && !Number.isFinite(publicRating)) drift('public_rating');

  // Historical field name retained, but this is an allowlisted projection, NOT raw input.
  review.rawPayload = {
    contract_version: YANDEX_CONTRACT_VERSION,
    type_confirmation: 'PENDING',
    id, cmnt_entity_id: entityId, external_id_source: id === null ? 'cmnt_entity_id' : 'id',
    author_name: review.authorName,
    full_text: review.reviewText,
    rating,
    time_created: input.time_created,
    owner_comment: review.ownerReply === null ? null : {
      text: review.ownerReply.text,
      time_created: input.owner_comment.time_created,
      moderation_status: review.ownerReply.moderationStatus
    },
    comments_count: commentsCount, lang, public_rating: publicRating
  };
  return validateYandexReview(review);
}

export function validateYandexReview(review) {
  record(review, 'normalizedReview');
  if (review.provider !== YANDEX_PROVIDER || !identifier(review.externalReviewId, 'externalReviewId')) drift('externalReviewId');
  integer(review.rating, 'rating', 1);
  if (review.rating > 5) drift('rating');
  timestamp(review.publishedAt, 'publishedAt');
  return review;
}

/** Pure projection onto verified DEV columns; NOT an INSERT/RPC or a location lookup. */
export function toReviewExternalReview(review, { companyId, locationId, observedAt } = {}) {
  validateYandexReview(review);
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof companyId !== 'string' || !uuid.test(companyId)) fail('YANDEX_COMPANY_SCOPE_REQUIRED');
  // DB allows NULL, but its matcher treats NULL location as a wildcard. Fail closed here.
  if (typeof locationId !== 'string' || !uuid.test(locationId) || !review.externalLocationId) fail('YANDEX_LOCATION_SCOPE_REQUIRED');
  if (observedAt === null || observedAt === undefined) fail('YANDEX_OBSERVED_AT_REQUIRED');
  return {
    company_id: companyId,
    location_id: locationId,
    provider: review.provider,
    external_review_id: review.externalReviewId,
    external_location_id: review.externalLocationId,
    author_name: review.authorName,
    rating: review.rating,
    review_text: review.reviewText,
    published_at: review.publishedAt,
    observed_at: timestamp(observedAt, 'observedAt'),
    owner_reply_text: review.ownerReply?.text ?? null,
    owner_replied_at: review.ownerReply?.publishedAt ?? null,
    raw_payload: structuredClone(review.rawPayload)
  };
}

export function parseYandexReviewsPayload(payload, externalLocationId = null) {
  record(payload, 'response');
  if (Object.hasOwn(payload, 'error') || Object.hasOwn(payload, 'errors')) drift('response.error');
  const list = record(payload.list, 'list');
  if (!Array.isArray(list.items)) drift('list.items');
  const inputPager = record(list.pager, 'list.pager');
  const limit = integer(inputPager.limit, 'list.pager.limit', 1);
  const offset = integer(inputPager.offset, 'list.pager.offset');
  const total = integer(inputPager.total, 'list.pager.total');
  if (offset > total || (total === 0 && offset !== 0)) drift('list.pager.offset');
  // A short page before the advertised end must not be mistaken for a complete sync.
  if (list.items.length !== Math.min(limit, total - offset)) drift('list.items.length');
  return {
    reviews: list.items.map(item => normalizeYandexReview(item, externalLocationId)),
    pagination: { limit, offset, total, hasMore: offset + limit < total }
  };
}

export function dedupeYandexReviews(reviews = []) {
  const seen = new Set();
  return reviews.filter(review => {
    validateYandexReview(review);
    const key = JSON.stringify([review.provider, review.externalLocationId, review.externalReviewId]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** No default network/session transport. The injected function must return a parsed JSON body. */
export async function fetchYandexReviews({ permanentId, transport, maxPages = 20, pageBase } = {}) {
  const locationId = identifier(permanentId, 'permanentId');
  if (!locationId) fail('YANDEX_PERMANENT_ID_REQUIRED');
  if (typeof transport !== 'function') fail('YANDEX_AUTHORIZED_TRANSPORT_NOT_CONFIGURED');
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 100) fail('YANDEX_MAX_PAGES_INVALID');
  const numbering = createYandexPageNumbering(pageBase);

  const collected = [];
  let firstPagination;
  for (let index = 0; index < maxPages; index += 1) {
    const page = numbering.pageAt(index);
    const url = new URL(`https://yandex.ru/sprav/api/${encodeURIComponent(locationId)}/reviews`);
    url.search = new URLSearchParams({ ranking: 'by_time', source: 'pagination', page: String(page) }).toString();
    let payload;
    try {
      payload = await transport({ method: 'GET', url: url.toString(), permanentId: locationId, page });
    } catch {
      // Transport errors can contain headers or whole response bodies. Never leak them.
      fail('YANDEX_TRANSPORT_FAILED');
    }
    const { reviews, pagination } = parseYandexReviewsPayload(payload, locationId);
    firstPagination ??= pagination;
    if (pagination.offset !== index * firstPagination.limit ||
        pagination.limit !== firstPagination.limit || pagination.total !== firstPagination.total) {
      fail('YANDEX_PAGINATION_CHANGED');
    }
    collected.push(...reviews);
    if (!pagination.hasMore) return dedupeYandexReviews(collected);
  }
  fail('YANDEX_PAGINATION_LIMIT_EXCEEDED');
}
