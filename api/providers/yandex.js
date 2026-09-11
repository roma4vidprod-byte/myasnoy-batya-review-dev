export const YANDEX_PROVIDER = 'yandex';

export function normalizeYandexReview(input = {}) {
  return {
    provider: YANDEX_PROVIDER,
    externalReviewId: String(input.externalReviewId || input.id || '').trim(),
    externalLocationId: String(input.externalLocationId || input.businessId || '').trim() || null,
    authorName: String(input.authorName || input.author || '').trim() || null,
    rating: Number.isFinite(Number(input.rating)) ? Number(input.rating) : null,
    reviewText: String(input.reviewText || input.text || '').trim() || null,
    publishedAt: input.publishedAt || input.date || null,
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

export async function fetchYandexReviews() {
  const error = new Error('YANDEX_AUTHORIZED_TRANSPORT_NOT_CONFIGURED');
  error.code = 'YANDEX_AUTHORIZED_TRANSPORT_NOT_CONFIGURED';
  throw error;
}
