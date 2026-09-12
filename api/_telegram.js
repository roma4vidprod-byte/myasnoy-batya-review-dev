// Shared sender extracted from feedback flow; no raw API errors escape this boundary.
export async function sendTelegramMessage({ text, parseMode }) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return { status: 'NOT_CONFIGURED' };
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000), redirect: 'error',
      body: JSON.stringify({ chat_id: chatId, text, ...(parseMode ? { parse_mode: parseMode } : {}), disable_web_page_preview: true })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error();
    return { status: 'SENT', messageId: data.result?.message_id || null };
  } catch { throw Object.assign(new Error('TELEGRAM_SEND_FAILED'), { code: 'TELEGRAM_SEND_FAILED' }); }
}
