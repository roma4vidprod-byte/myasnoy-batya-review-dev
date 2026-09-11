function clean(value, max = 2000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });

  const body = req.body || {};
  const payload = {
    id: `fb_${Date.now().toString(36)}`,
    locationId: clean(body.locationId, 100) || 'dev-location',
    sourceId: clean(body.sourceId, 100) || 'dev-source',
    reason: clean(body.reason, 120),
    text: clean(body.text, 4000),
    contact: clean(body.contact, 320),
    createdAt: new Date().toISOString()
  };

  if (!payload.reason || !payload.text) {
    return res.status(400).json({ ok: false, error: 'VALIDATION_ERROR', fields: ['reason', 'text'] });
  }

  const telegramConfigured = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
  const emailConfigured = Boolean(process.env.REVIEW_EMAIL_FROM && process.env.REVIEW_EMAIL_API_KEY && process.env.NEGATIVE_REVIEW_EMAIL_TO);

  // DEV-safe foundation: persistence and external delivery are intentionally not enabled
  // until Supabase/email/Telegram credentials are connected explicitly.
  return res.status(202).json({
    ok: true,
    mode: 'dev-safe',
    feedback: payload,
    delivery: {
      telegram: telegramConfigured ? 'READY_NOT_SENT_IN_FOUNDATION' : 'NOT_CONFIGURED',
      email: emailConfigured ? 'READY_NOT_SENT_IN_FOUNDATION' : 'NOT_CONFIGURED'
    }
  });
}
