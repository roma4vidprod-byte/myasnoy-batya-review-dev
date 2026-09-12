import { enqueueDueSyncs } from '../../lib/server/review-sync.js';
import { timingSafeEqual } from 'node:crypto';

function authorized(req, secret) {
  if (typeof secret !== 'string' || !secret.trim() || secret !== secret.trim()) return false;
  const authorization = req.headers?.authorization;
  if (typeof authorization !== 'string') return false;
  const actual = Buffer.from(authorization);
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Injection is for offline handler tests; no scheduler or Yandex session is provisioned here.
export function createReviewSyncHandler({
  enqueue = enqueueDueSyncs,
  getSecret = () => process.env.CRON_SECRET
} = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
    }
    if (!authorized(req, getSecret())) {
      return res.status(401).json({ ok: false, error: 'UNAUTHORIZED' });
    }

    try {
      // Scope and service credentials come from server configuration, never HTTP input.
      const queued = await enqueue();

      return res.status(200).json({
        ok: true,
        schedule: 'hourly',
        requested: Number(queued || 0),
        // Legacy response key retained. Health is now exclusively the public read endpoint;
        // its QR token scope must never be confused with the scheduler's company scope.
        providers: []
      });
    } catch {
      // Backend errors may carry headers/session data. Return a fixed public error only.
      return res.status(503).json({ ok: false, error: 'REVIEW_SYNC_FAILED' });
    }
  };
}

export default createReviewSyncHandler();
