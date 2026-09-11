export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return res.status(200).json({ ok: false, configured: false, error: 'TELEGRAM_NOT_CONFIGURED' });
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: '✅ Мясной Батя — Review Activator\nTelegram-уведомления подключены. Тестовое сообщение.',
        disable_web_page_preview: true
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      return res.status(502).json({ ok: false, configured: true, error: data.description || 'TELEGRAM_SEND_FAILED' });
    }
    return res.status(200).json({ ok: true, configured: true, sent: true, messageId: data.result?.message_id || null });
  } catch (error) {
    return res.status(502).json({ ok: false, configured: true, error: 'TELEGRAM_SEND_FAILED' });
  }
}
