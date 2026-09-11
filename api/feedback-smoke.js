import { rpc } from './_supabase.js';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function sendTelegram({ reason, text, contact, feedbackId }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error('TELEGRAM_NOT_CONFIGURED');

  const message = [
    '🧪 <b>DEV TEST — негативная обратная связь</b>',
    '',
    `<b>Причина:</b> ${escapeHtml(reason)}`,
    `<b>Комментарий:</b> ${escapeHtml(text)}`,
    `<b>Контакт:</b> ${escapeHtml(contact)}`,
    `<b>ID:</b> <code>${escapeHtml(feedbackId || '')}</code>`,
    `<b>Время:</b> ${new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Yekaterinburg' })}`
  ].join('\n');

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML', disable_web_page_preview: true })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.description || 'TELEGRAM_SEND_FAILED');
  return data.result?.message_id || null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });

  try {
    const marker = `DEV-SMOKE-${Date.now()}`;
    const feedbackId = await rpc('review_public_submit_feedback', {
      p_token: 'mb-dev-main',
      p_category: 'DEV TEST',
      p_message: marker,
      p_contact: 'dev-smoke@local'
    });
    const messageId = await sendTelegram({
      reason: 'DEV TEST',
      text: marker,
      contact: 'dev-smoke@local',
      feedbackId
    });
    return res.status(200).json({ ok: true, persisted: true, telegramSent: true, feedbackId, messageId, marker });
  } catch (error) {
    console.error('feedback smoke failed', error.message);
    return res.status(502).json({ ok: false, error: error.message || 'SMOKE_FAILED' });
  }
}
