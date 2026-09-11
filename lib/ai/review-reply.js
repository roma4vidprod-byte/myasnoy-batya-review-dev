const MAX_REVIEW = 5000;

function clean(value, max = 1000) {
  return String(value || '').trim().slice(0, max);
}

export function buildReviewReplyPrompt({ rating, reviewText, authorName, locationName } = {}) {
  const safeRating = Math.max(1, Math.min(5, Number(rating) || 0));
  return {
    system: [
      'Ты помощник сети быстрого питания «Мясной Батя».',
      'Подготовь только черновик ответа на публичный отзыв клиента.',
      'Стиль: коротко, конкретно, по-человечески. Без канцелярита.',
      'Не выдумывай факты, компенсации, возвраты, скидки, причины происшествия или действия сотрудников.',
      'Не спорь с клиентом и не обвиняй его.',
      'Для негативного отзыва: поблагодари за сигнал, признай проблему без признания неподтвержденных фактов и предложи связаться с нами, если нужен разбор.',
      'Для положительного: поблагодари естественно, без чрезмерной рекламы.',
      'Не упоминай AI, внутренние системы, промокоды или механику Review Activator.',
      'Не публикуй ответ самостоятельно. Результат — только текст черновика.',
      'Обычно 1–3 коротких предложения, максимум 700 символов.'
    ].join(' '),
    user: JSON.stringify({
      rating: safeRating || null,
      review: clean(reviewText, MAX_REVIEW),
      author: clean(authorName, 120) || null,
      location: clean(locationName, 200) || null
    })
  };
}

export function validateDraft(text) {
  const value = clean(text, 700);
  if (!value) throw new Error('AI_REPLY_EMPTY');
  return value;
}

/** Provider-independent LLM boundary. It never publishes external mutations. */
export async function generateReviewReplyDraft(input, generate) {
  if (typeof generate !== 'function') {
    throw Object.assign(new Error('AI_REPLY_PROVIDER_NOT_CONFIGURED'), { code: 'AI_REPLY_PROVIDER_NOT_CONFIGURED' });
  }
  const prompt = buildReviewReplyPrompt(input);
  const output = await generate(prompt);
  return validateDraft(typeof output === 'string' ? output : output?.text);
}
