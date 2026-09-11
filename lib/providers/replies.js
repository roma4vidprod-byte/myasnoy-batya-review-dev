export const REPLY_STATUS = Object.freeze({
  DRAFT: 'DRAFT',
  QUEUED: 'QUEUED',
  SENDING: 'SENDING',
  SENT: 'SENT',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED'
});

export function validateReplyText(value) {
  const text = String(value || '').trim();
  if (!text) throw new Error('REVIEW_REPLY_TEXT_REQUIRED');
  if (text.length > 5000) throw new Error('REVIEW_REPLY_TEXT_TOO_LONG');
  return text;
}

/**
 * Provider-neutral outbound mutation boundary.
 * A reply is never sent merely because it was drafted or generated.
 * Caller must explicitly request send and provide an authorized provider transport.
 */
export async function sendReviewReply({ provider, externalReviewId, replyText, transport } = {}) {
  if (!['yandex', '2gis'].includes(provider)) throw new Error('REVIEW_REPLY_PROVIDER_INVALID');
  if (!externalReviewId) throw new Error('REVIEW_REPLY_EXTERNAL_ID_REQUIRED');
  const text = validateReplyText(replyText);
  if (typeof transport !== 'function') {
    throw Object.assign(new Error('REVIEW_REPLY_TRANSPORT_NOT_CONFIGURED'), { code: 'REVIEW_REPLY_TRANSPORT_NOT_CONFIGURED' });
  }
  return transport({ provider, externalReviewId: String(externalReviewId), replyText: text });
}
