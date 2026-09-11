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
  const allowed = new Set(['yandex', '2gis']);

  if (!validEmail(email) || !allowed.has(platform)) {
    return res.status(400).json({ ok: false, error: 'VALIDATION_ERROR' });
  }

  const session = {
    id: `rs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    email,
    platform,
    locationId: clean(body.locationId, 100) || 'dev-location',
    sourceId: clean(body.sourceId, 100) || 'dev-source',
    status: 'WAITING_PUBLICATION',
    createdAt: new Date().toISOString()
  };

  return res.status(201).json({
    ok: true,
    mode: 'dev-safe',
    session,
    verification: {
      provider: platform === 'yandex' ? 'YandexBusinessProvider' : 'TwoGisBusinessProvider',
      state: 'NOT_CONNECTED',
      matching: 'FOUNDATION_READY'
    }
  });
}
