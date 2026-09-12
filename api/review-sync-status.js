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
    const data = await rpc('review_public_sync_status', { p_token: token });
    return res.status(200).json({ ok: true, providers: Array.isArray(data) ? data : [] });
  } catch {
    return res.status(503).json({ ok: false, error: 'SYNC_STATUS_FAILED' });
  }
}
