import { rpc } from './_supabase.js';

function clean(value, max = 200) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'METHOD_NOT_ALLOWED' });
  }

  const body = req.body || {};
  const token = clean(body.token || body.sourceToken, 200) || 'mb-dev-main';
  const rewardLabel = clean(body.rewardLabel, 200) || 'Соус в подарок';
  const rawCodes = Array.isArray(body.codes) ? body.codes : [];

  const unique = [];
  const seen = new Set();
  for (const item of rawCodes.slice(0, 5000)) {
    const code = clean(item, 128);
    if (!code || seen.has(code)) continue;
    seen.add(code);
    unique.push(code);
  }

  if (!unique.length) {
    return res.status(400).json({ ok: false, error: 'NO_VALID_CODES' });
  }

  try {
    const data = await rpc('review_dev_import_promos', {
      p_token: token,
      p_codes: unique,
      p_reward_label: rewardLabel
    });
    const row = Array.isArray(data) ? (data[0] || {}) : (data || {});
    return res.status(200).json({
      ok: true,
      mode: 'dev-supabase',
      result: {
        submitted: rawCodes.length,
        uniqueSubmitted: unique.length,
        found: Number(row.found || 0),
        added: Number(row.added || 0),
        duplicates: Number(row.duplicates || 0)
      }
    });
  } catch (error) {
    console.error('promo import failed', error.details || error.message);
    return res.status(503).json({ ok: false, error: 'PROMO_IMPORT_FAILED' });
  }
}
