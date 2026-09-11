const SUPABASE_URL = 'https://ykiubttldgyjpajmsuas.supabase.co';
const SUPABASE_KEY = 'sb_publishable_JoMwOnfv-S3MQ5Kr9QKFCQ_NBgvm0fY';

export async function rpc(name, payload = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!response.ok) {
    const error = new Error((data && (data.message || data.error)) || 'SUPABASE_RPC_FAILED');
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return data;
}

export const supabaseInfo = {
  connected: true,
  projectRef: 'ykiubttldgyjpajmsuas',
  mode: 'publishable-rpc'
};
