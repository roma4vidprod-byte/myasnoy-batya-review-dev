import { rpc } from '../_supabase.js';

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.authorization === `Bearer ${secret}`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }
  if (!authorized(req)) {
    return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
  }

  try {
    const queued = await rpc('review_public_request_due_syncs', {
      p_token: 'mb-dev-main'
    });

    const status = await rpc('review_public_sync_status', {
      p_token: 'mb-dev-main'
    });

    return res.status(200).json({
      ok: true,
      schedule: 'hourly',
      requested: Number(queued || 0),
      providers: Array.isArray(status) ? status : []
    });
  } catch (error) {
    console.error('hourly review sync failed', error.details || error.message);
    return res.status(503).json({ ok: false, error: 'REVIEW_SYNC_FAILED' });
  }
}
