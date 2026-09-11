import { rpc } from './_supabase.js';

function clean(value, max = 1000) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function validEmail(value) {
  return /^\S+@\S+\.\S+$/.test(value);
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });

  const body = req.body || {};
  const email = clean(body.email, 320).toLowerCase();
  const platform = clean(body.platform, 30);
  const token = clean(body.token || body.sourceToken, 200) || 'mb-dev-main';
  const allowed = new Set(['yandex', '2gis']);

  if (!validEmail(email) || !allowed.has(platform)) {
    return res.status(400).json({ ok: false, error: 'VALIDATION_ERROR' });
  }

  try {
    const sessionId = await rpc('review_public_create_session', {
      p_token: token,
      p_email: email,
      p_platform: platform
    });

    return res.status(201).json({
      ok: true,
      mode: 'dev-supabase',
      persisted: true,
      session: {
        id: sessionId,
        email,
        platform,
        status: 'WAITING_PUBLICATION',
        createdAt: new Date().toISOString()
      },
      verification: {
        provider: platform === 'yandex' ? 'YandexBusinessProvider' : 'TwoGisBusinessProvider',
        state: 'NOT_CONNECTED',
        matching: 'FOUNDATION_READY'
      }
    });
  } catch (error) {
    console.error('reward session persistence failed', error.details || error.message);
    return res.status(error.status === 400 ? 400 : 503).json({
      ok: false,
      error: 'PERSISTENCE_FAILED'
    });
  }
}
