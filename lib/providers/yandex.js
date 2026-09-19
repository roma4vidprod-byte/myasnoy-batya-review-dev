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

function drift(field, rule = 'field.contract', expected = 'valid contract field') {
  throw Object.assign(new Error('YANDEX_CONTRACT_DRIFT'), {code:'YANDEX_CONTRACT_DRIFT',field,rule,expected});
}

function record(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) drift(field,'record.type','object');
  return value;
}

function required(value, key, field) {
  if (!Object.hasOwn(value, key)) drift(field,'field.required','present');
  return value[key];
}

function nullableText(value, field) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') drift(field,'text.type','string|null|missing');
  return value.trim() || null;
}

function identifier(value, field) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) drift(field,'identifier.integer','nonnegative safe integer');
    return String(value);
  }
  return nullableText(value, field);
}

function integer(value, field, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) drift(field,'integer.range',minimum === 1 ? 'positive safe integer' : 'nonnegative safe integer');
  return value;
}

function timestamp(value, field) {
  if (value === null) return null; // Compatibility; owner reply source units remain unconfirmed.
  let milliseconds;
  if (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0) drift(field,'timestamp.numeric','nonnegative safe integer timestamp');
    // Asbest full dry-run 03 confirmed review time_created = numeric Unix milliseconds.
    // Preserve millisecond precision. Seconds remain an explicit compatibility format;
    // do not infer owner_comment time units from the review field's live evidence.
    milliseconds = number < 100_000_000_000 ? number * 1000 : number;
  } else if (typeof value === 'string') {
    const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
    if (!parts) drift(field,'timestamp.format','ISO timestamp with timezone');
    const [, year, month, day, hour, minute, second] = parts.map(Number);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth) drift(field,'timestamp.calendar','valid calendar date');
    if (hour > 23 || minute > 59 || second > 59) drift(field,'timestamp.clock','valid clock time');
    milliseconds = Date.parse(value);
  } else {
    drift(field,'timestamp.type','number|string|null');
  }
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) drift(field,'timestamp.range','representable date');
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
    drift('owner_comment.moderation_status','moderation.type','string|integer|null');
  }
  // Preserve the provider enum; never infer PUBLISHED/SENT from an unknown enum.
  return { text, publishedAt, moderationStatus: status };
}

export function normalizeYandexReview(input, externalLocationId = null) {
  record(input, 'item');
  const id = identifier(input.id, 'id');
  const entityId = identifier(input.cmnt_entity_id, 'cmnt_entity_id');
  const externalReviewId = id ?? entityId;
  if (!externalReviewId) drift('id','identifier.required','nonempty id or cmnt_entity_id');
  const rawRating = required(input, 'rating', 'rating');
  const rating = typeof rawRating === 'string' && /^[1-5]$/.test(rawRating) ? Number(rawRating) : rawRating;
  integer(rating, 'rating', 1);
  if (rating > 5) drift('rating','rating.range','integer 1..5');

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
  if (publicRating !== null && !['number', 'string', 'boolean'].includes(typeof publicRating)) drift('public_rating','public_rating.type','number|string|boolean|null');
  if (typeof publicRating === 'number' && !Number.isFinite(publicRating)) drift('public_rating','public_rating.finite','finite number');

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

export function parseYandexReviewsPayload(payload, externalLocationId = null, {
  paginationMode = 'STRICT_LEGACY', expectedOffset, expectedLimit
} = {}) {
  if (!['STRICT_LEGACY','MUTABLE_OFFSET'].includes(paginationMode)) fail('YANDEX_PAGINATION_MODE_INVALID');
  const mutable = paginationMode === 'MUTABLE_OFFSET';
  if (mutable && (!Number.isSafeInteger(expectedOffset) || expectedOffset < 0 ||
      !Number.isSafeInteger(expectedLimit) || expectedLimit < 1)) fail('YANDEX_PAGINATION_REQUEST_INVALID');
  record(payload, 'response');
  if (Object.hasOwn(payload, 'error') || Object.hasOwn(payload, 'errors')) drift('response.error','response.error.absent','missing error/errors');
  const list = record(payload.list, 'list');
  if (!Array.isArray(list.items)) drift('list.items','items.type','array');
  const inputPager = record(list.pager, 'list.pager');
  const limit = integer(inputPager.limit, 'list.pager.limit', 1);
  const offset = integer(inputPager.offset, 'list.pager.offset');
  const total = integer(inputPager.total, 'list.pager.total');
  if (mutable) {
    if (offset !== expectedOffset) drift('list.pager.offset','pager.offset.request','requested offset');
    if (limit !== expectedLimit) drift('list.pager.limit','pager.limit.request','requested limit');
    if (list.items.length > limit) drift('list.items.length','items.limit','0..requested limit');
  } else {
    if (offset > total || (total === 0 && offset !== 0)) drift('list.pager.offset','pager.offset.range','offset <= total');
    if (list.items.length !== Math.min(limit, total - offset)) drift('list.items.length','items.page_length','min(limit,total-offset)');
  }
  const identities = new Set();
  const reviews = list.items.map((item,index) => {
      try { return normalizeYandexReview(item, externalLocationId); }
      catch(error) { if(error?.code === 'YANDEX_CONTRACT_DRIFT') error.itemIndex=index; throw error; }
    });
  if (mutable) for (let index = 0; index < reviews.length; index++) {
    const id = reviews[index].externalReviewId;
    if (identities.has(id)) {
      try { drift('id','identity.unique_within_page','unique review identity within page'); }
      catch(error) { error.itemIndex=index; throw error; }
    }
    identities.add(id);
  }
  return {
    reviews,
    pagination: { limit, offset, total, hasMore: mutable ? list.items.length === limit : offset + limit < total }
  };
}

const DIAGNOSTIC_ITEM_FIELDS = Object.freeze([
  'id', 'cmnt_entity_id', 'author.user', 'full_text', 'rating', 'time_created',
  'owner_comment', 'owner_comment.text', 'owner_comment.time_created',
  'owner_comment.moderation_status', 'comments_count', 'lang', 'public_rating'
]);
const DIAGNOSTIC_ITEM_TOP_LEVEL_FIELDS = new Set([
  'id', 'cmnt_entity_id', 'author', 'full_text', 'rating', 'time_created',
  'owner_comment', 'comments_count', 'lang', 'public_rating'
]);
const DIAGNOSTIC_FAILURE_FIELDS = new Set([
  'response', 'response.error', 'list', 'list.items', 'list.pager', 'list.pager.limit',
  'list.pager.offset', 'list.pager.total', 'list.items.length', 'item', 'id',
  'cmnt_entity_id', 'author', 'author.user', 'full_text', 'rating',
  'time_created', 'owner_comment', 'owner_comment.text',
  'owner_comment.time_created', 'owner_comment.moderation_status',
  'comments_count', 'lang', 'public_rating', 'externalLocationId'
]);

const objectValue = value => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
const safeKeys = value => Object.keys(objectValue(value) ?? {}).sort();
const valueAt = (item, path) => path.split('.').reduce((value, key) => objectValue(value)?.[key], item);
const typeOf = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;

function fieldStats(items, path) {
  const stats = { present: 0, missing: 0, null: 0, types: {} };
  for (const item of items) {
    const parts = path.split('.');
    let cursor = item;
    let present = true;
    for (const part of parts) {
      if (!objectValue(cursor) || !Object.hasOwn(cursor, part)) { present = false; break; }
      cursor = cursor[part];
    }
    if (!present) { stats.missing += 1; continue; }
    stats.present += 1;
    const type = typeOf(cursor);
    if (type === 'null') stats.null += 1;
    else stats.types[type] = (stats.types[type] ?? 0) + 1;
  }
  return stats;
}

function safePagination(list, items) {
  const pager = objectValue(list?.pager);
  return {
    limit: Number.isSafeInteger(pager?.limit) ? pager.limit : null,
    offset: Number.isSafeInteger(pager?.offset) ? pager.offset : null,
    total: Number.isSafeInteger(pager?.total) ? pager.total : null,
    items: items.length
  };
}

/** Safe, value-free structural report used only for a server-side contract diagnostic. */
export function inspectYandexReviewsPayload(payload) {
  const response = objectValue(payload);
  const list = objectValue(response?.list);
  const pager = objectValue(list?.pager);
  const items = Array.isArray(list?.items) ? list.items.filter(item => objectValue(item)) : [];
  const itemKeys = [...new Set(items.flatMap(item => safeKeys(item)))].sort();
  const authorKeys = [...new Set(items.flatMap(item => safeKeys(item.author)))].sort();
  const ownerCommentKeys = [...new Set(items.flatMap(item => safeKeys(item.owner_comment)))].sort();
  const fields = Object.fromEntries(DIAGNOSTIC_ITEM_FIELDS.map(field => [field, fieldStats(items, field)]));
  const requiredFields = ['id', 'cmnt_entity_id', 'author.user', 'full_text', 'rating', 'time_created'];
  const requiredPresence = Object.fromEntries(requiredFields.map(field => [field, {
    all_present: items.length > 0 ? fields[field].present === items.length : null,
    present: fields[field].present,
    missing: fields[field].missing
  }]));
  const known = {
    top_level: new Set(['list','error','errors']), list: new Set(['items','pager']),
    pager: new Set(['limit','offset','total']), item: DIAGNOSTIC_ITEM_TOP_LEVEL_FIELDS,
    author: new Set(['user']), owner_comment: new Set(['text','time_created','moderation_status'])
  };
  const raw = {top_level:safeKeys(response),list:safeKeys(list),pager:safeKeys(pager),
    item:itemKeys,author:authorKeys,owner_comment:ownerCommentKeys};
  const unknownCounts = Object.fromEntries(Object.entries(raw).map(([group,keys]) =>
    [group, keys.filter(key => !known[group].has(key)).length]));
  const projectKeys = group => raw[group].filter(key => known[group].has(key));
  return {
    top_level_keys: projectKeys('top_level'),
    list_keys: projectKeys('list'),
    pager_keys: projectKeys('pager'),
    item_keys: projectKeys('item'),
    author_keys: projectKeys('author'),
    owner_comment_keys: projectKeys('owner_comment'),
    // Unknown key NAMES may themselves contain credentials/PII. Counts only;
    // retain an array-shaped fixed marker for existing diagnostic consumers.
    unexpected_keys: Object.fromEntries(Object.entries(unknownCounts).map(([group,count]) =>
      [group, count ? ['UNRECOGNIZED_KEY'] : []])),
    unexpected_key_counts: unknownCounts,
    item_count: Array.isArray(list?.items) ? list.items.length : null,
    fields,
    container_types: {response:typeOf(payload),list:typeOf(response?.list),items:typeOf(list?.items),pager:typeOf(list?.pager)},
    pager_types: Object.fromEntries(['limit','offset','total'].map(k=>[k,typeOf(pager?.[k])])),
    required_presence: requiredPresence,
    pagination: safePagination(list, Array.isArray(list?.items) ? list.items : [])
  };
}

/** Parse result plus a value-free failure point; never returns review data. */
export function diagnoseYandexReviewsPayload(payload, externalLocationId = null, options) {
  const schema = inspectYandexReviewsPayload(payload);
  try {
    const parsed = parseYandexReviewsPayload(payload, externalLocationId, options);
    return {
      ok: true,
      parser: { code: null, failure_point: null },
      pagination: parsed.pagination,
      schema
    };
  } catch (error) {
    const code = error?.code === 'YANDEX_CONTRACT_DRIFT' ? error.code : 'YANDEX_CONTRACT_DRIFT';
    const field=DIAGNOSTIC_FAILURE_FIELDS.has(error?.field)?error.field:'unknown';
    const index=Number.isSafeInteger(error?.itemIndex)?error.itemIndex:null;
    const target=index===null?payload:payload?.list?.items?.[index];
    const value=field==='response'?payload:field==='item'?target:
      field==='list.items.length'?payload?.list?.items?.length:valueAt(target,field);
    return {
      ok: false,
      parser: {
        code,
        failure_point: field
      },
      // These strings originate only in this parser, never in payload keys/values.
      contract_failure: {contract_rule_id:field==='unknown'?'UNKNOWN':error.rule??'field.contract',
        json_path:field==='unknown'?'UNKNOWN':index===null?`$.${field}`:`$.list.items[${index}].${field}`,
        expected_shape:field==='unknown'?'UNKNOWN':error.expected??'valid contract field',
        actual_type:typeOf(value),present:value!==undefined,item_index:index},
      pagination: schema.pagination,
      schema
    };
  }
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
export async function fetchYandexReviews({ permanentId, transport, maxPages = 20, pageBase,
  paginationMode = 'STRICT_LEGACY', requestedLimit = 20, onPaginationReport } = {}) {
  const locationId = identifier(permanentId, 'permanentId');
  if (!locationId) fail('YANDEX_PERMANENT_ID_REQUIRED');
  if (typeof transport !== 'function') fail('YANDEX_AUTHORIZED_TRANSPORT_NOT_CONFIGURED');
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 100) fail('YANDEX_MAX_PAGES_INVALID');
  if (!['STRICT_LEGACY','MUTABLE_OFFSET'].includes(paginationMode)) fail('YANDEX_PAGINATION_MODE_INVALID');
  const mutable = paginationMode === 'MUTABLE_OFFSET';
  if (mutable && (maxPages > 10 || requestedLimit !== 20)) fail('YANDEX_MAX_PAGES_INVALID');
  if (onPaginationReport !== undefined && typeof onPaginationReport !== 'function') fail('YANDEX_PAGINATION_REQUEST_INVALID');
  const numbering = createYandexPageNumbering(pageBase);

  const collected = [];
  const identities = new Set(), pages = [], totals = [];
  let rawReceived = 0;
  const publish = (classification, terminalLength) => {
    if (!mutable) return;
    onPaginationReport?.({pagination_mode:'MUTABLE_OFFSET',classification,
      raw_received:rawReceived,unique_received:identities.size,duplicates:rawReceived-identities.size,
      first_total:totals[0],last_total:totals.at(-1),min_total:Math.min(...totals),max_total:Math.max(...totals),
      total_change_count:totals.slice(1).filter((total,i)=>total!==totals[i]).length,
      provider_total_stable:totals.every(total=>total===totals[0]),total_values_observed:[...totals],
      terminal_page_length:terminalLength,terminal_page_observed:terminalLength!==null,
      pages:pages.map(page=>({...page})),duplicate_exception_applied:false});
  };
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
    const { reviews, pagination } = parseYandexReviewsPayload(payload, locationId,
      {paginationMode,expectedOffset:index*requestedLimit,expectedLimit:requestedLimit});
    if (mutable) {
      const before = identities.size;
      for (const review of reviews) {
        const key = JSON.stringify([review.provider,review.externalLocationId,review.externalReviewId]);
        if (!identities.has(key)) { identities.add(key); collected.push(review); }
      }
      totals.push(pagination.total);rawReceived+=reviews.length;
      pages.push({page,offset:pagination.offset,limit:pagination.limit,reported_total:pagination.total,
        raw_items:reviews.length,new_unique:identities.size-before,boundary_duplicates:reviews.length-(identities.size-before)});
      if (!pagination.hasMore) {
        // No tolerance and no inferred missing reviews: deduped identities must
        // fit THIS run's observed total envelope. Short pages alone are not PASS.
        const compatible = identities.size >= Math.min(...totals) && identities.size <= Math.max(...totals);
        const stable = totals.every(total=>total===totals[0]);
        publish(compatible ? stable ? 'STRICT_STABLE_COMPLETE' : 'MUTABLE_TOTAL_COMPLETE' : 'INCONSISTENT_INCOMPLETE',reviews.length);
        if (!compatible) fail('YANDEX_PAGINATION_CHANGED');
        return collected;
      }
      publish(index+1===maxPages?'NO_TERMINAL_PAGE':'IN_PROGRESS',null);
      continue;
    }
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
