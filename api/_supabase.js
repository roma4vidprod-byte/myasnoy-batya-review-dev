import { runtimeProfile } from '../lib/server/runtime-profile.js';

export async function rpc(name, payload = {}) {
  const target = runtimeProfile();
  if (target.profile === 'vps-lab' && name !== 'review_public_sync_status') throw new Error('LAB_RPC_NOT_ENABLED');
  const SUPABASE_URL=target.url, SUPABASE_KEY=target.publicKey;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    redirect: 'error',
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
  projectRef: runtimeProfile().projectRef,
  mode: 'publishable-rpc'
};
