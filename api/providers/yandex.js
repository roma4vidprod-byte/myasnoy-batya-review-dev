export const YANDEX_PROVIDER = 'yandex';

function text(value) {
  return value == null ? '' : String(value).trim();
}

function first(...values) {
  return values.find(v => v !== undefined && v !== null && v !== '') ?? null;
}

export function normalizeYandexReview(input = {}, externalLocationId = null) {
  const author = input.author || input.user || {};
  const ratingRaw = first(input.rating, input.stars, input.score);
  const rating = ratingRaw == null ? null : Number(ratingRaw);

  return {
    provider: YANDEX_PROVIDER,
    externalReviewId: text(first(input.externalReviewId, input.id, input.reviewId, input.review_id)),
    externalLocationId: text(first(externalLocationId, input.externalLocationId, input.businessId, input.permanentId)) || null,
    authorName: text(first(input.authorName, author.name, author.displayName, input.name)) || null,
    rating: Number.isFinite(rating) ? rating : null,
    reviewText: text(first(input.reviewText, input.text, input.comment, input.body)) || null,
    publishedAt: first(input.publishedAt, input.date, input.createdAt, input.created_at),
    rawPayload: input
  };
}

export function validateYandexReview(review) {
  if (!review.externalReviewId) throw new Error('YANDEX_REVIEW_ID_REQUIRED');
  if (review.rating !== null && (review.rating < 1 || review.rating > 5)) {
    throw new Error('YANDEX_RATING_INVALID');
  }
  return review;
}

export function parseYandexReviewsPayload(payload = {}, externalLocationId = null) {
  const root = payload.data || payload.result || payload;
  const reviewsNode = root.reviews || root;
  const items = Array.isArray(reviewsNode.items)
    ? reviewsNode.items
    : Array.isArray(reviewsNode.reviews)
      ? reviewsNode.reviews
      : Array.isArray(root.items)
        ? root.items
        : [];

  const pager = reviewsNode.pager || root.pager || {};
  const nextToken = first(
    pager.continue_token,
    pager.continueToken,
    reviewsNode.continue_token,
    reviewsNode.continueToken,
    root.continue_token,
    root.continueToken
  );

  const reviews = items.map(item => validateYandexReview(normalizeYandexReview(item, externalLocationId)));
  return { reviews, nextToken: nextToken ? String(nextToken) : null };
}

export function dedupeYandexReviews(reviews = []) {
  const seen = new Set();
  return reviews.filter(review => {
    const key = review.externalReviewId;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildUrl({ baseUrl, permanentId, continueToken }) {
  const root = String(baseUrl || 'https://yandex.ru/sprav').replace(/\/$/, '');
  const url = new URL(`${root}/api/${encodeURIComponent(permanentId)}/reviews`);
  if (continueToken) url.searchParams.set('continue_token', continueToken);
  return url.toString();
}

/**
 * Authorized transport contract.
 * No credentials are accepted as function arguments and nothing is logged.
 * The caller must inject a transport that performs the authorized request.
 */
export async function fetchYandexReviews({ permanentId, transport, baseUrl, maxPages = 20 } = {}) {
  if (!permanentId) throw Object.assign(new Error('YANDEX_PERMANENT_ID_REQUIRED'), { code: 'YANDEX_PERMANENT_ID_REQUIRED' });
  if (typeof transport !== 'function') {
    throw Object.assign(new Error('YANDEX_AUTHORIZED_TRANSPORT_NOT_CONFIGURED'), { code: 'YANDEX_AUTHORIZED_TRANSPORT_NOT_CONFIGURED' });
  }

  const collected = [];
  let continueToken = null;
  const usedTokens = new Set();

  for (let page = 0; page < Math.max(1, Math.min(Number(maxPages) || 20, 100)); page += 1) {
    const url = buildUrl({ baseUrl, permanentId, continueToken });
    const payload = await transport({ url, permanentId: String(permanentId), continueToken });
    const parsed = parseYandexReviewsPayload(payload, String(permanentId));
    collected.push(...parsed.reviews);

    if (!parsed.nextToken || usedTokens.has(parsed.nextToken)) break;
    usedTokens.add(parsed.nextToken);
    continueToken = parsed.nextToken;
  }

  return dedupeYandexReviews(collected);
}
