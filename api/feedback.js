import { rpc } from './_supabase.js';

function clean(value, max = 2000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });

  const body = req.body || {};
  const token = clean(body.token || body.sourceToken, 200) || 'mb-dev-main';
  const reason = clean(body.reason, 120);
  const text = clean(body.text, 4000);
  const contact = clean(body.contact, 320);

  if (!reason || !text) {
    return res.status(400).json({ ok: false, error: 'VALIDATION_ERROR', fields: ['reason', 'text'] });
  }

  try {
    const feedbackId = await rpc('review_public_submit_feedback', {
      p_token: token,
      p_category: reason,
      p_message: text,
      p_contact: contact || null
    });

    const telegramConfigured = Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
    const emailConfigured = Boolean(process.env.REVIEW_EMAIL_FROM && process.env.REVIEW_EMAIL_API_KEY && process.env.NEGATIVE_REVIEW_EMAIL_TO);

    return res.status(201).json({
      ok: true,
      mode: 'dev-supabase',
      feedbackId,
      persisted: true,
      delivery: {
        telegram: telegramConfigured ? 'READY_NOT_SENT_YET' : 'NOT_CONFIGURED',
        email: emailConfigured ? 'READY_NOT_SENT_YET' : 'NOT_CONFIGURED'
      }
    });
  } catch (error) {
    console.error('feedback persistence failed', error.details || error.message);
    return res.status(error.status === 400 ? 400 : 503).json({
      ok: false,
      error: 'PERSISTENCE_FAILED'
    });
  }
}
