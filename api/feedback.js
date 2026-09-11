import { rpc } from './_supabase.js';

function clean(value, max = 2000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function sendTelegram({ reason, text, contact, feedbackId }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { status: 'NOT_CONFIGURED' };

  const message = [
    '🔴 <b>Негативная обратная связь</b>',
    '',
    `<b>Причина:</b> ${escapeHtml(reason)}`,
    `<b>Комментарий:</b> ${escapeHtml(text)}`,
    `<b>Контакт:</b> ${escapeHtml(contact || 'не указан')}`,
    `<b>ID:</b> <code>${escapeHtml(feedbackId || '')}</code>`,
    `<b>Время:</b> ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Yekaterinburg' })}`
  ].join('\n');

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) {
    const error = new Error(data.description || 'TELEGRAM_SEND_FAILED');
    error.status = response.status;
    throw error;
  }

  return { status: 'SENT', messageId: data.result?.message_id || null };
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

    let telegram = { status: 'NOT_CONFIGURED' };
    try {
      telegram = await sendTelegram({ reason, text, contact, feedbackId });
    } catch (error) {
      console.error('telegram delivery failed', error.message);
      telegram = { status: 'FAILED' };
    }

    const emailConfigured = Boolean(process.env.REVIEW_EMAIL_FROM && process.env.REVIEW_EMAIL_API_KEY && process.env.NEGATIVE_REVIEW_EMAIL_TO);

    return res.status(201).json({
      ok: true,
      mode: 'dev-supabase',
      feedbackId,
      persisted: true,
      delivery: {
        telegram: telegram.status,
        telegramMessageId: telegram.messageId || null,
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
