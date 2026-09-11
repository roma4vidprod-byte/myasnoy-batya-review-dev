import { supabaseInfo } from './_supabase.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    service: 'myasnoy-batya-review-activator',
    version: '0.7-supabase-foundation',
    mode: 'dev-supabase',
    integrations: {
      supabase: supabaseInfo,
      telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID),
      email: Boolean(process.env.REVIEW_EMAIL_FROM && process.env.REVIEW_EMAIL_API_KEY),
      yandexBusiness: false,
      twoGisBusiness: false
    },
    timestamp: new Date().toISOString()
  });
}
