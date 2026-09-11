import { rpc } from './_supabase.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const token = typeof req.query?.token === 'string' && req.query.token.trim()
    ? req.query.token.trim().slice(0, 200)
    : 'mb-dev-main';

  try {
    const data = await rpc('review_public_promo_stats', { p_token: token });
    const row = Array.isArray(data) ? (data[0] || {}) : (data || {});
    return res.status(200).json({
      ok: true,
      pool: {
        available: Number(row.available || 0),
        reserved: Number(row.reserved || 0),
        sent: Number(row.sent || 0),
        redeemed: Number(row.redeemed || 0)
      }
    });
  } catch (error) {
    console.error('promo stats failed', error.details || error.message);
    return res.status(503).json({ ok: false, error: 'PROMO_STATS_FAILED' });
  }
}
