function clean(value, max = 2000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });

  const body = req.body || {};
  const sessionId = clean(body.sessionId, 120);
  const externalReviewId = clean(body.externalReviewId, 200);
  const platform = clean(body.platform, 30);
  const confidence = Number(body.confidence);

  if (!sessionId || !externalReviewId || !['yandex', '2gis'].includes(platform) || !Number.isFinite(confidence)) {
    return res.status(400).json({ ok: false, error: 'VALIDATION_ERROR' });
  }

  const bounded = Math.max(0, Math.min(100, confidence));
  const status = bounded >= 90 ? 'AUTO_MATCH_ELIGIBLE' : bounded >= 60 ? 'NEEDS_REVIEW' : 'LOW_CONFIDENCE';

  return res.status(200).json({
    ok: true,
    mode: 'dev-safe',
    candidate: {
      sessionId,
      externalReviewId,
      platform,
      confidence: bounded,
      status,
      evaluatedAt: new Date().toISOString()
    },
    note: 'No promo code is issued by this foundation endpoint. Reward delivery requires verified persistence and configured backend services.'
  });
}
